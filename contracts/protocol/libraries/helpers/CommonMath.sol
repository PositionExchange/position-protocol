pragma solidity ^0.8.0;

library CommonMath {
    /// @dev get max number in (a, b)
    function max(uint256 a, uint256 b) internal pure returns (uint256){
        return a >= b ? a : b;
    }
    /// @dev get max number in (a, b)uint16
    function maxU16(uint16 a, uint16 b) internal pure returns (uint16){
        return a >= b ? a : b;
    }
}
