pragma solidity ^0.8.0;
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// To prevent risks of InsuranceFund smart contract
/// This contract is used to store the reserve funds
/// The MULTI_SIGN_OPERATOR is able to withdraw from the InsuranceFund
/// And transfer back to InsuranceFund in order to maintain the liquidity
/// Admin is a multisign address can grant or revoke the permission.
/// This design will remove once the Smart Contracts is more stable

contract PositionInsuranceReserveFunds is AccessControl {
    bytes32 public constant MULTI_SIGN_OPERATOR = keccak256("MULTI_SIGN_OPERATOR");
    bytes32 public constant SUPER_ADMIN = keccak256("SUPER_ADMIN");

    // cannot modify the insuranceFund address
    address public insuranceFund = 0x547dc7a6f196A06ACC4C883Cf17EaB047de0275a;

    event InsuranceFundChanged(address indexed old, address indexed _new);

    constructor(){
        _setRoleAdmin(DEFAULT_ADMIN_ROLE, SUPER_ADMIN);
        _setupRole(SUPER_ADMIN, msg.sender);
    }

    function secureFund(IERC20 token, uint256 amount) public onlyRole(MULTI_SIGN_OPERATOR){
        // Transfer from insuranceFund
        token.transferFrom(insuranceFund, address(this), amount);
    }

    function returnFund(IERC20 token, uint256 amount) public onlyRole(MULTI_SIGN_OPERATOR){
        // Transfer to insuranceFund
        token.transfer(insuranceFund, amount);
    }
}
