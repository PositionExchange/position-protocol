// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

import {Calc} from '../protocol/libraries/math/Calc.sol';

contract CalcTest {


    function abs(uint256 x) internal pure returns (uint256) {

        return Calc.abs(x);
    }

    function sqrt(uint256 x) internal pure returns (uint256) {

        return Calc.sqrt(x);

    }

    function pow(uint256 x, uint16 times) internal pure returns (uint256) {

        return Calc.pow(x, times);

    }

}
