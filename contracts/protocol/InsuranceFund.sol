// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "../interfaces/IUniswapV2Pair.sol";
import "../interfaces/IUniswapV2Factory.sol";
import "../interfaces/IUniswapV2Router.sol";
import {Errors} from "./libraries/helpers/Errors.sol";

contract InsuranceFund is
    Initializable,
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable
{
    address constant public BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    uint256 public totalFee;
    uint256 public totalBurned;

    address private counterParty;

    IERC20 public posi;
    IERC20 public busd;
    IUniswapV2Router02 public router;
    IUniswapV2Factory public factory;

    event BuyBackAndBurned(address _token, uint256 _tokenAmount, uint256 _posiAmount);
    event SoldPosiForFund(uint256 _posiAmount, uint256 _tokenAmount);

    modifier onlyCounterParty() {
        require(counterParty == _msgSender(), Errors.VL_NOT_COUNTERPARTY);
        _;
    }


    function initialize() public initializer {
        __ReentrancyGuard_init();
        __Ownable_init();

        posi = IERC20(0x5CA42204cDaa70d5c773946e69dE942b85CA6706);
        busd = IERC20(0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56);
        router = IUniswapV2Router02(0x10ED43C718714eb63d5aA57B78B54704E256024E);
        factory = IUniswapV2Factory(0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73);
    }

    function deposit(
        address _token,
        address _trader,
        uint256 _amount
    ) public onlyCounterParty {
        IERC20(_token).transferFrom(_trader, address(this), _amount);
    }

    //    function transferFeeFromTrader(address token, address trader, uint256 amountFee) public {
    //
    //        IERC20(token).transferFrom(trader, address(this), amountFee);
    //
    //        totalFee += amountFee;
    //
    //    }

    function withdraw(
        address _token,
        address _trader,
        uint256 _amount
    ) public onlyCounterParty {
        // if insurance fund not enough amount for trader, should sell posi and pay for trader
        uint256 _tokenBalance = IERC20(_token).balanceOf(address(this));
        if(_tokenBalance < _amount){
            uint256 _gap = _amount - _tokenBalance;
            (uint256 _posiIn, ) = router.getAmountsIn(_gap, getPosiToTokenRoute(_token));
            router.swapExactTokensForTokensSupportingFeeOnTransferTokens(_posiIn, 0, getPosiToTokenRoute(_token), address(this), block.timestamp);
            emit SoldPosiForFund(_posiIn, _gap);
        }
        IERC20(_token).transfer(_trader, _amount);
    }

    function updateTotalFee(uint256 _fee) public onlyCounterParty {
        totalFee += _fee;
    }

    // Buy POSI on market and burn it
    function buyBackAndBurn(address _token, uint256 _amount)
        public
        onlyOwner
    {
        // buy back
        uint256 _posiBalanceBefore = posi.balanceOf(address(this));
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(_amount, 0, getTokenToPosiRoute(_token), address(this), block.timestamp);
        uint256 _posiBalanceAfter = posi.balanceOf(address(this));
        uint256 _posiAmount = _posiBalanceAfter - _posiBalanceBefore;

        // burn
        posi.transfer(BURN_ADDRESS, _posiAmount);

        totalBurned += _posiAmount;
        emit BuyBackAndBurned(_token, _amount, _posiAmount);
    }

    function setCounterParty(address _counterParty) public onlyOwner {
        require(_counterParty != address(0), Errors.VL_EMPTY_ADDRESS);
        counterParty = _counterParty;
    }


    function getTokenToPosiRoute(address token) private view returns(address[] memory paths){
        paths = new address[](2);
        paths[0] = token;
        paths[1] = address(posi);
    }

    function getPosiToTokenRoute(address token) private view returns(address[] memory paths){
        paths = new address[](2);
        paths[0] = address(posi);
        paths[1] = token;
    }

}
