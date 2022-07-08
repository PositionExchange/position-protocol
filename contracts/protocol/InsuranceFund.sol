// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "../interfaces/IUniswapV2Pair.sol";
import "../interfaces/IUniswapV2Factory.sol";
import "../interfaces/IUniswapV2Router.sol";
import "../interfaces/IPositionManager.sol";
import "./libraries/helpers/Quantity.sol";
import {Errors} from "./libraries/helpers/Errors.sol";
import {WhitelistManager} from "./modules/WhitelistManager.sol";

contract InsuranceFund is
    Initializable,
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    WhitelistManager
{
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using Quantity for int256;
    address public constant BURN_ADDRESS =
        0x000000000000000000000000000000000000dEaD;

    uint256 public totalFee;
    uint256 public totalBurned;

    address private counterParty;

    IERC20Upgradeable public posi;
    IERC20Upgradeable public busd;
    IUniswapV2Router02 public router;
    IUniswapV2Factory public factory;

    event BuyBackAndBurned(
        address _token,
        uint256 _tokenAmount,
        uint256 _posiAmount
    );
    event SoldPosiForFund(uint256 _posiAmount, uint256 _tokenAmount);

    event Deposit(
        address indexed _token,
        address indexed _trader,
        uint256 _amount
    );
    event Withdraw(
        address indexed _token,
        address indexed _trader,
        uint256 _amount,
        int256 _pnl
    );
    event CounterPartyTransferred(address _old, address _new);
    event PosiChanged(address _new);
    event RouterChanged(address _new);
    event FactoryChanged(address _new);
    event WhitelistManagerUpdated(address positionManager, bool isWhitelist);
    event BonusBalanceCleared(address positionManager, address trader);

    modifier onlyCounterParty() {
        require(counterParty == _msgSender(), Errors.VL_NOT_COUNTERPARTY);
        _;
    }

    function initialize() public initializer {
        __ReentrancyGuard_init();
        __Ownable_init();

        posi = IERC20Upgradeable(0x5CA42204cDaa70d5c773946e69dE942b85CA6706);
        busd = IERC20Upgradeable(0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56);
        busdBonus = IERC20Upgradeable(0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56); // TODO: Change later
        router = IUniswapV2Router02(0x10ED43C718714eb63d5aA57B78B54704E256024E);
        factory = IUniswapV2Factory(0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73);
    }

    function deposit(
        address _positionManager,
        address _trader,
        uint256 _amount,
        uint256 _fee
    ) public onlyCounterParty onlyWhitelistManager(_positionManager) {
        address _tokenAddress = address(
            IPositionManager(_positionManager).getQuoteAsset()
        );
        IERC20Upgradeable _token = IERC20Upgradeable(_tokenAddress);

        uint256 busdAmount = _amount + _fee;
        if (acceptBonus) {
            uint256 bonusBalance = busdBonus.balanceOf(_trader);
            if (bonusBalance > 0) {
                (
                uint256 collectableBUSDAmount,
                uint256 collectableBonusAmount,
                uint256 depositedBonusAmount
                ) = calcDepositAmount(_amount, _fee, bonusBalance, busdAmount);

                if (collectableBonusAmount > 0) {
                    busdBonus.safeTransferFrom(
                        _trader,
                        address(this),
                        collectableBonusAmount
                    );
                }

                if (depositedBonusAmount > 0) {
                    busdBonusBalances[_positionManager][_trader] += depositedBonusAmount;
                }

                busdAmount = collectableBUSDAmount;
                if (busdAmount == 0) {
                    emit Deposit(address(_token), _trader, _amount + _fee);
                    return;
                }
            }
        }

        totalFee += _fee;
        _token.safeTransferFrom(_trader, address(this), busdAmount);
        emit Deposit(address(_token), _trader, _amount + _fee);
    }

    function withdraw(
        address _positionManager,
        address _trader,
        uint256 _amount,
        uint256 _oldMargin,
        int256 _pnl
    ) public onlyCounterParty onlyWhitelistManager(_positionManager) {
        address _token = address(
            IPositionManager(_positionManager).getQuoteAsset()
        );

        if (acceptBonus && _oldMargin > 0) {
            uint256 bonusBalance = busdBonusBalances[_positionManager][_trader];
            if (bonusBalance > 0) {
                uint256 oldBUSDBalance = _oldMargin - bonusBalance;

                (
                uint256 withdrawBUSDAmount,
                uint256 withdrawBonusAmount,
                uint256 remainingBonusAmount
                ) = oldBUSDBalance > 0
                ? calcAmountWhenMarginHaveBUSD(
                    _amount,
                    oldBUSDBalance,
                    bonusBalance,
                    _pnl
                )
                : calcAmountWhenMarginOnlyHaveBonus(
                    _amount,
                    bonusBalance,
                    _pnl
                );

                if (withdrawBonusAmount > 0) {
                    busdBonus.safeTransfer(_trader, withdrawBonusAmount);
                }

                busdBonusBalances[_positionManager][_trader] = remainingBonusAmount;

                _amount = withdrawBUSDAmount;
                if (_amount == 0) {
                    emit Withdraw(_token, _trader, withdrawBonusAmount, _pnl);
                    return;
                }
            }
        }

        // if insurance fund not enough amount for trader, should sell posi and pay for trader
        uint256 _tokenBalance = IERC20Upgradeable(_token).balanceOf(
            address(this)
        );
        if (_tokenBalance < _amount) {
            uint256 _gap = (_amount - _tokenBalance) * 110 / 100;
            uint256[] memory _amountIns = router.getAmountsIn(
                _gap,
                getPosiToTokenRoute(_token)
            );
            router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                _amountIns[0],
                0,
                getPosiToTokenRoute(_token),
                address(this),
                block.timestamp
            );
            emit SoldPosiForFund(_amountIns[0], _gap);
        }
        IERC20Upgradeable(_token).safeTransfer(_trader, _amount);
        emit Withdraw(_token, _trader, _amount, _pnl);
    }

    function clearBonus(
        address _positionManager,
        address _trader,
        uint256 _amount
    ) public onlyCounterParty {
        // Use when liquidated
        if (busdBonusBalances[_positionManager][_trader] > _amount) {
            busdBonusBalances[_positionManager][_trader] -= _amount;
            return;
        }
        busdBonusBalances[_positionManager][_trader] = 0;
        emit BonusBalanceCleared(_positionManager, _trader);
    }

    //******************************************************************************************************************
    // ONLY OWNER FUNCTIONS
    //******************************************************************************************************************

    // Approve for the reserved funds
    // due to security issue, the reserved funds contract address is hardcode
    function approveReserveFund() external onlyOwner {
        busd.approve(0xF323C72fc1c1711CBE33D492bbE39Ff6fD90f15a,type(uint256).max);
    }

    function updateWhitelistManager(address _positionManager, bool _isWhitelist)
        external
        onlyOwner
    {
        if (_isWhitelist) {
            _setWhitelistManager(_positionManager);
        } else {
            _removeWhitelistManager(_positionManager);
        }
        emit WhitelistManagerUpdated(_positionManager, _isWhitelist);
    }

    function updatePosiAddress(IERC20Upgradeable _newPosiAddress)
        public
        onlyOwner
    {
        posi = _newPosiAddress;
        emit PosiChanged(address(_newPosiAddress));
    }

    function updateRouterAddress(IUniswapV2Router02 _newRouterAddress)
        public
        onlyOwner
    {
        router = _newRouterAddress;
        emit RouterChanged(address(_newRouterAddress));
    }

    function updateFactoryAddress(IUniswapV2Factory _newFactory)
        public
        onlyOwner
    {
        factory = _newFactory;
        emit FactoryChanged(address(_newFactory));
    }

    // Buy POSI on market and burn it
    function buyBackAndBurn(address _token, uint256 _amount) public onlyOwner {
        // buy back
        uint256 _posiBalanceBefore = posi.balanceOf(address(this));
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            _amount,
            0,
            getTokenToPosiRoute(_token),
            address(this),
            block.timestamp
        );
        uint256 _posiBalanceAfter = posi.balanceOf(address(this));
        uint256 _posiAmount = _posiBalanceAfter - _posiBalanceBefore;

        // burn
        posi.safeTransfer(BURN_ADDRESS, _posiAmount);

        totalBurned += _posiAmount;
        emit BuyBackAndBurned(_token, _amount, _posiAmount);
    }

    function setCounterParty(address _counterParty) public onlyOwner {
        require(_counterParty != address(0), Errors.VL_EMPTY_ADDRESS);
        emit CounterPartyTransferred(counterParty, _counterParty);
        counterParty = _counterParty;
    }

    // approve token for router in order to swap tokens
    function approveTokenForRouter(address _token) public onlyOwner {
        IERC20Upgradeable(_token).safeApprove(
            address(router),
            0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
        );
    }

    function setBUSDBonusAddress(IERC20Upgradeable _newBUSDBonusAddress)
        public
        onlyOwner
    {
        busdBonus = _newBUSDBonusAddress;
    }

    function shouldAcceptBonus(bool _acceptBonus) public onlyOwner {
        acceptBonus = _acceptBonus;
    }

    //******************************************************************************************************************
    // VIEW FUNCTIONS
    //******************************************************************************************************************

    function getTokenToPosiRoute(address token)
        private
        view
        returns (address[] memory paths)
    {
        paths = new address[](2);
        paths[0] = token;
        paths[1] = address(posi);
    }

    function getPosiToTokenRoute(address token)
        private
        view
        returns (address[] memory paths)
    {
        paths = new address[](2);
        paths[0] = address(posi);
        paths[1] = token;
    }

    function calcDepositAmount(
        uint256 _amount,
        uint256 _fee,
        uint256 _busdBonusBalance,
        uint256 _totalCollectable
    )
        private
        view
        returns (
            uint256 collectableBUSDAmount,
            uint256 collectableBonusAmount,
            uint256 depositedBonusAmount
        )
    {
        if (_totalCollectable <= _busdBonusBalance) {
            return (0, _totalCollectable, _amount);
        }

        if (_fee > _busdBonusBalance) {
            return (_amount + (_fee - _busdBonusBalance), _busdBonusBalance, 0);
        }

        uint256 depositedBonusAmount = _busdBonusBalance - _fee;
        return (
            _amount - depositedBonusAmount,
            _busdBonusBalance,
            depositedBonusAmount
        );
    }

    function calcAmountWhenMarginOnlyHaveBonus(
        uint256 _withdrawAmount,
        uint256 _bonusBalance,
        int256 _pnl
    )
        private
        view
        returns (
            uint256 withdrawBUSDAmount,
            uint256 withdrawBonusAmount,
            uint256 remainingBonusAmount
        )
    {
        /**
         * If PnL >= 0, return PnL in BUSD and requested withdraw margin in bonus
         * If Pnl < 0, only return requested withdraw amount in bonus
         */
        uint256 withdrawMargin = uint256(int256(_withdrawAmount) - _pnl);
        return
            _pnl >= 0
                ? (uint256(_pnl), withdrawMargin, _bonusBalance - withdrawMargin)
                : (0, _withdrawAmount, _bonusBalance - withdrawMargin);
    }

    function calcAmountWhenMarginHaveBUSD(
        uint256 _withdrawAmount,
        uint256 _oldBUSDBalance,
        uint256 _bonusBalance,
        int256 _pnl
    )
        private
        view
        returns (
            uint256 withdrawBUSDAmount,
            uint256 withdrawBonusAmount,
            uint256 remainingBonusAmount
        )
    {
        uint256 pnlAbs = _pnl.abs();

        // PnL negative
        if (_pnl < 0) {
            // loss more than bonus
            if (pnlAbs >= _bonusBalance) {
                return (_withdrawAmount, 0, 0);
            }

            // withdraw amount less than BUSD balance
            if (_withdrawAmount < _oldBUSDBalance) {
                return (_withdrawAmount, 0, _bonusBalance - pnlAbs);
            }

            // withdraw amount greater than or equal BUSD balance
            uint256 withdrawBonusAmount = _withdrawAmount - _oldBUSDBalance;
            uint256 remainingBonusAmount = _bonusBalance -
                pnlAbs -
                withdrawBonusAmount;
            return (_oldBUSDBalance, withdrawBonusAmount, remainingBonusAmount);
        }

        // PnL positive
        uint256 withdrawBUSDAmount = _oldBUSDBalance + uint256(_pnl);

        // withdraw amount less than or equal BUSD balance + PnL
        if (_withdrawAmount <= withdrawBUSDAmount) {
            return (_withdrawAmount, 0, _bonusBalance);
        }

        //  withdraw amount greater than BUSD balance + PnL
        uint256 withdrawBonusAmount = _withdrawAmount - withdrawBUSDAmount;
        return (withdrawBUSDAmount, withdrawBonusAmount, _bonusBalance - withdrawBonusAmount);
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[49] private __gap;
    IERC20Upgradeable public busdBonus;
    // PositionManager => (Trader => (BonusBalance))
    mapping(address => mapping(address => uint256)) public busdBonusBalances;
    bool public acceptBonus;
}
