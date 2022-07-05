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
import {Errors} from "./libraries/helpers/Errors.sol";
import {WhitelistManager} from "./modules/WhitelistManager.sol";

contract InsuranceFund is
    Initializable,
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    WhitelistManager
{
    using SafeERC20Upgradeable for IERC20Upgradeable;
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
        uint256 _amount
    );
    event CounterPartyTransferred(address _old, address _new);
    event PosiChanged(address _new);
    event RouterChanged(address _new);
    event FactoryChanged(address _new);
    event WhitelistManagerUpdated(address positionManager, bool isWhitelist);

    modifier onlyCounterParty() {
        require(counterParty == _msgSender(), Errors.VL_NOT_COUNTERPARTY);
        _;
    }

    function initialize() public initializer {
        __ReentrancyGuard_init();
        __Ownable_init();

        posi = IERC20Upgradeable(0x5CA42204cDaa70d5c773946e69dE942b85CA6706);
        busd = IERC20Upgradeable(0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56);
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
        totalFee += _fee;
        _token.safeTransferFrom(_trader, address(this), _amount + _fee);
        emit Deposit(address(_token), _trader, _amount + _fee);
    }

    function withdraw(
        address _positionManager,
        address _trader,
        uint256 _amount,
        uint256 _margin,
        int256 _pnl
    ) public onlyCounterParty onlyWhitelistManager(_positionManager) {
        address _token = address(
            IPositionManager(_positionManager).getQuoteAsset()
        );
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
        emit Withdraw(_token, _trader, _amount);
    }

    //******************************************************************************************************************
    // ONLY OWNER FUNCTIONS
    //******************************************************************************************************************

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

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[49] private __gap;
}
