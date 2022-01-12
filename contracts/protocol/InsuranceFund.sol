pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "../interfaces/IUniswapV2Pair.sol";
import "../interfaces/IUniswapV2Factory.sol";
import "../interfaces/IUniswapV2Router.sol";
import {Errors} from "./libraries/helpers/Errors.sol";

contract InsuranceFund is Initializable, ReentrancyGuardUpgradeable, OwnableUpgradeable {

    uint256 public totalFee;
    uint256 public totalBurn;
    address private counterParty;
    IERC20 public posi;
    IERC20 public busd;
    IUniswapV2Router02 public router;
    IUniswapV2Factory public factory;

    modifier onlyCounterParty(){
        require(counterParty == _msgSender(), Errors.VL_NOT_COUNTERPARTY);
        _;
    }

    modifier onlyGovernance(){
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

    function deposit(address token, address trader, uint256 amount) public {
        IERC20(token).transferFrom(trader, address(this), amount);
    }

    function withdraw(
        address token,
        address trader,
        uint256 amount
    )
        public
        onlyCounterParty
    {
        // TODO sold posi to pay for trader
        IERC20(token).transfer(trader, amount);
    }

    function updateTotalFee(uint256 fee) public onlyCounterParty {
        totalFee += fee;
    }

    // TODO Buy back and burn
    function buyBackAndBurn(address token, uint256 amount) public onlyGovernance {
        totalBurn += amount;
    }

    function setCounterParty(address _counterParty) public onlyOwner {
        require(_counterParty != address(0), Errors.VL_EMPTY_ADDRESS);
        counterParty = _counterParty;
    }
}