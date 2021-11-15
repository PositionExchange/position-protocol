pragma solidity ^0.8.0;

library Quantity {

//   function toUint256(int256 quantity) internal pure returns(uint256){
    //       return uint256(quantity);
    //   }

    function abs(int256 quantity) internal pure returns (uint256) {
        return uint256(quantity >= 0 ? quantity : -quantity);
    }
    function abs128(int256 quantity) internal pure returns (uint128) {
        return uint128(abs(quantity));
    }

    function sumWithUnit256(int256 a, uint256 b) internal pure returns (int256) {
        return a > 0 ? a + int256(b) : a - int256(b);
    }


}