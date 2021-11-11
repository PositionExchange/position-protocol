pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract InsuranceFund {


    uint256 public totalFee;
    modifier onlyCounterParty(){
        _;
    }

    modifier onlyGovernance(){
        _;
    }




    function deposit(address token, address trader, uint256 amount) public {
        IERC20(token).transferFrom(trader, address(this), amount);
    }

    function transferFeeFromTrader(address token, address trader, uint256 amountFee) public {

        IERC20(token).transferFrom(trader, address(this), amountFee);

        totalFee += amountFee;

    }

    function withdraw(address token, address trader, uint256 amount) public onlyCounterParty {

        // TODO sold posi to pay for trader
        // if insurance fund not enough amount for trader, should sold posi and pay for trader

        IERC20(token).transfer(trader, amount);

    }


    // Buy POSI on market and burn it
    function buyBackAndBurn(address token, uint256 amount) public onlyGovernance {
        // TODO implement
    }
}