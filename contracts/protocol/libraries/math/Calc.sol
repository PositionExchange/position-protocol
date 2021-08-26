// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";

library Calc {

    using SafeMath for uint256;

    function abs(int256 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }

    function cmp(uint256 x, uint256 y) internal pure returns (int256) {
        if (x > y) {
            return 1;
        } else if (x < y) {
            return -1;
        }
        return 0;
    }


    function sqrt(uint256 x) internal pure returns (uint256) {
        uint256 epsilon = 10000000000000;
        int256 result = 10000000000000;
        while (abs(int256(result * result - int256(x))) >= epsilon) {
            result = (int256(x) / result - result) / 2 + result;
        }
        return uint256(result);
    }

    function pow(uint256 x, uint256 times) internal pure returns (uint256) {
        if (times == 0) {
            return 1;
        } else if (times == 1) {
            return x;
        } else {
            uint256 res = pow(x, times.div(2));
            res = res.mul(res);
            if (times.mod(2) == 1) {
                res = res.mul(x);
            }
            return res;
        }
    }
    /// @notice Calculates the square root of x, rounding down.
    /// @dev Uses the Babylonian method https://en.wikipedia.org/wiki/Methods_of_computing_square_roots#Babylonian_method.
    /// @param x The uint256 number for which to calculate the square root.
    /// @return result The result as an uint256.
    function sqrt_new(uint256 x) internal pure returns (uint256 result) {
        if (x == 0) {
            return 0;
        }

        // Calculate the square root of the perfect square of a power of two that is the closest to x.
        uint256 xAux = uint256(x);
        result = 1;
        if (xAux >= 0x100000000000000000000000000000000) {
            xAux >>= 128;
            result <<= 64;
        }
        if (xAux >= 0x10000000000000000) {
            xAux >>= 64;
            result <<= 32;
        }
        if (xAux >= 0x100000000) {
            xAux >>= 32;
            result <<= 16;
        }
        if (xAux >= 0x10000) {
            xAux >>= 16;
            result <<= 8;
        }
        if (xAux >= 0x100) {
            xAux >>= 8;
            result <<= 4;
        }
        if (xAux >= 0x10) {
            xAux >>= 4;
            result <<= 2;
        }
        if (xAux >= 0x8) {
            result <<= 1;
        }

        // The operations can never overflow because the result is max 2^127 when it enters this block.
    unchecked {
        result = (result + x / result) >> 1;
        result = (result + x / result) >> 1;
        result = (result + x / result) >> 1;
        result = (result + x / result) >> 1;
        result = (result + x / result) >> 1;
        result = (result + x / result) >> 1;
        result = (result + x / result) >> 1;
        // Seven iterations should be enough
        uint256 roundedDownResult = x / result;
        return result >= roundedDownResult ? roundedDownResult : result;
    }
    }


}
