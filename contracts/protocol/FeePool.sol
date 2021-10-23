pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../interfaces/IUniswapV2Router.sol";
import "../interfaces/IUniswapV2Factory.sol";
import "../interfaces/IUniswapV2Pair.sol";


contract FeePool is Initializable, ReentrancyGuardUpgradeable, OwnableUpgradeable {


    IERC20 public posi;
    IERC20 public busd;
    IUniswapV2Router02 public router;
    IUniswapV2Factory public factory;
    uint256 MAX_INT;


    function initialize() public initializer {
        __ReentrancyGuard_init();
        __Ownable_init();
        // MAIN NET
        posi = IERC20(0x5CA42204cDaa70d5c773946e69dE942b85CA6706);
        busd = IERC20(0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56);
        router = IUniswapV2Router02(0x10ED43C718714eb63d5aA57B78B54704E256024E);
        factory = IUniswapV2Factory(0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73);
        MAX_INT = 115792089237316195423570985008687907853269984665640564039457584007913129639935;
    }


    function buyBack(uint256 ratioBuyBack) public onlyOwner {

    }

    function burn(uint256 ratioBurn) public onlyOwner {

    }


}