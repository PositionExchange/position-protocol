// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";

library Calc {

    using SafeMath for uint256;

    function abs(int256 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }

    function sqrt(uint256 x) internal pure returns (uint256) {
        uint256 epsilon = 10000000000000;
        int256 result = 10000000000000;
        while (abs(int256(result*result - int256(x))) >= epsilon) {
            result = (int256(x) / result - result) / 2 + result;
        }
        return uint256(result);
    }

    function pow(uint256 x, uint16 times) internal pure returns (uint256) {
        uint256 res = x;
        for (uint i = 1; i < times; i ++) {
            res = res.mul(x);
        }
        return res;
    }

}
