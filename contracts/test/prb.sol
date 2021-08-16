//// SPDX-License-Identifier: agpl-3.0
//pragma solidity 0.8.0;
//
//
//import "prb-math/contracts/PRBMathSD59x18.sol";
//
//contract SignedConsumer {
//    using PRBMathSD59x18 for int256;
//
//    function signedLog2(int256 x) external pure returns (int256 result) {
//        result = x.log2();
//    }
//
//    /// @notice Calculates x*y÷1e18 while handling possible intermediary overflow.
//    /// @dev Try this with x = type(int256).max and y = 5e17.
//    function signedMul(int256 x, int256 y) external pure returns (int256 result) {
//        result = x.mul(y);
//    }
//
//    /// @dev Assuming that 1e18 = 100% and 1e16 = 1%.
//    function signedYield(int256 principal, int256 apr) external pure returns (int256 result) {
//        result = principal.mul(apr);
//    }
//
//
//    function sqrt(int256 x) external pure returns (int256 result){
//        result = x.sqrt();
//
//    }
//}
//
