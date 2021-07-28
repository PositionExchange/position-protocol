// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

/// @title Computes the amount to swap within ticks
library ComputeAmountMath {
    /*
    @notice Computes the result of swapping some amount in or amount out
    @param currentPrice The current price of the pool
    @param targetPrice The price that cannot be exceeded, from which direction of the swap is inferred
    @param liquidity The usable liquidity
    @param amountRemaining How much input or output amount is remaining to be swapped in/out
    @return nextPrice The price after swapping the amount in/out, not to exceed the price target
    @return amountIn The amount to be swapped in, of either token0 or token1, based on the direction of the swap
    @return amountOut The amount to be received, of either token0 or token1, based on the direction of the swap
    **/
    function computeSwapStep(
        uint256 currentPrice,
        uint256 targetPrice,
        uint256 liquidity,
        uint256 amountRemaining
    )
    internal
    pure
    returns (
        uint256 nextPrice,
        uint256 quoteCalculatedAmount,
        uint256 baseCalculatedAmount
    )
    {
        // Side
        bool sideBuy = currentPrice >= targetPrice;

        if (sideBuy) {
            uint256 amountCalculated = SqrtPriceMath.getAmountToTargetPrice(targetPrice, currentPrice, liquidity);
            if (amountRemaining >= amountCalculated) nextPrice = targetPrice;
            else
            // function calculate the next price after swap an specific amount
                nextPrice = SqrtPriceMath.getNextPriceFromInput(
                    currentPrice,
                    liquidity,
                    sideBuy,
                    amountRemaining
                );
        } else {
            uint256 amountCalculated = SqrtPriceMath.getAmountToTargetPrice(targetPrice, currentPrice, liquidity);
            if (amountRemaining >= amountCalculated) nextPrice = targetPrice;
            else
            // function calculate the next price after swap an specific amount
                nextPrice = SqrtPriceMath.getNextPriceFromInput(
                    currentPrice,
                    liquidity,
                    !sideBuy,
                    amountRemaining
                );
        }

        bool max = targetPrice == nextPrice;

        // get the input/output amounts
        if (sideBuy) {
            quoteCalculatedAmount = max
            ? amountCalculated
            : amountRemaining;
            baseCalculatedAmount = max
            ? 0// function calculate base amount
            : 1;
            //function calculate base amount
        } else {
            quoteCalculatedAmount = max
            ? amountCalculated
            : amountRemaining;
            baseCalculatedAmount = max
            ? 0// function calculate base amount
            : 1;
            //function calculate base amount
        }
    }
}



