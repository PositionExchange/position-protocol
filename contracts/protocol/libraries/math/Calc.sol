// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";

library Calc {

    using SafeMath for uint256;

    function abs(uint256 memory x) internal pure returns (uint256 memory) {
        return x >= 0 ? x : - x;
    }

    function sqrt(uint256 memory x) internal pure returns (uint256 memory) {
        uint256 epsilon = 10000000000;
        uint256 result;
        while (abs(result.mul(result) - x) >= epsilon) {
            result = (x.div(result).sub(result).div(2)).add(result);
        }
        return result;
    }

    function pow(uint256 x, uint16 times) internal pure returns (uint256 memory) {
        uint256 memory res = x;
        for (uint i = 1; i < times; i ++) {
            res = res.mul(x);
        }
        return res;
    }

}
