pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract InsuranceFund {

    modifier onlyCounterParty(){
        _;
    }

    modifier onlyGovernance(){
        _;
    }

    function deposit(address token, address trader, uint256 amount) public {
        IERC20(token).transferFrom(trader, address(this), amount);
    }

    function withdraw(address token, address trader, uint256 amount) public onlyCounterParty {
        IERC20(token).transfer(trader, amount);
        // TODO sold posi to pay for trader
    }

    // Buy POSI on market and burn it
    function buyBackAndBurn(address token, uint256 amount) public onlyGovernance {
        // TODO implement
    }
}