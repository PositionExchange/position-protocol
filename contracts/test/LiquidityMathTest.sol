// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

import {LiquidityMath} from '../protocol/libraries/math/LiquidityMath.sol';

contract LiquidityMathTest {
    function addDelta(uint256 x, int256 y) external pure returns (uint256 z) {

        z = LiquidityMath.addDelta(x, y);
    }

    function getBaseAmountByQuote(
        uint256 quoteAmount,
        bool sideBuy, uint256 liquidity,
        uint256 quoteReserveAmount,
        uint256 baseReserveAmount)
    external pure returns (uint256 baseAmount) {

        baseAmount = LiquidityMath.getBaseAmountByQuote(quoteAmount,
            sideBuy, liquidity,
            quoteReserveAmount,
            baseReserveAmount);
    }

    function getQuoteAmountByBase(
        uint256 baseAmount,
        bool sideBuy,
        uint256 liquidity,
        uint256 quoteReserveAmount,
        uint256 baseReserveAmount
    ) external pure returns (uint256 quoteAmount) {

        quoteAmount = LiquidityMath.getQuoteAmountByBase(
            baseAmount,
            sideBuy,
            liquidity,
            quoteReserveAmount,
            baseReserveAmount

        );

    }

}
