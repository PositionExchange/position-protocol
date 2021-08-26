// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

import '../protocol/libraries/math/TickMath.sol';

contract TickMathTest {
    function getPriceAtTick(int256 tick) external view returns (uint256) {
        return TickMath.getPriceAtTick(tick);
    }

    function getGasCostOfGetPriceAtTick(int256 tick) external view returns (uint256) {
        uint256 gasBefore = gasleft();
        TickMath.getPriceAtTick(tick);
        return gasBefore - gasleft();
    }

    function getTickAtPrice(uint256 sqrtPriceX96) external view returns (int256) {
        return TickMath.getTickAtPrice(sqrtPriceX96);
    }

    function getGasCostOfGetTickAtPrice(uint256 sqrtPriceX96) external view returns (uint256) {
        uint256 gasBefore = gasleft();
        TickMath.getTickAtPrice(sqrtPriceX96);
        return gasBefore - gasleft();
    }

    function MIN_SQRT_RATIO() external pure returns (uint256) {
        return TickMath.MIN_SQRT_RATIO;
    }

    function MAX_SQRT_RATIO() external pure returns (uint256) {
        return TickMath.MAX_SQRT_RATIO;
    }

    function bitPos(uint8 bitPos) external pure returns (uint256 res){
        uint256 res = 1 << bitPos;
    }
}
