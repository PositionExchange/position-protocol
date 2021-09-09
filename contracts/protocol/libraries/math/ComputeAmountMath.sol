// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

import {PriceMath} from "./PriceMath.sol";
import {Calc} from './Calc.sol';
import "hardhat/console.sol";
/// @title Computes the amount to swap within ticks
library ComputeAmountMath {
    /*
    @notice Computes the result of swapping some amount in or amount out
    @param currentPrice The current price of the pool
    @param targetPrice The price that cannot be exceeded, from which direction of the swap is inferred
    @param liquidity The usable liquidity
    @param amountQuoteRemaining How much input or output amount is remaining to be swapped in/out
    @return nextPrice The price after swapping the amount in/out, not to exceed the price target
    @return quoteCalculated The quote amount to be swapped in or out, based on the direction of the swap
    @return baseCalculated The base amount to be swapped in or out, based on the direction of the swap
    **/
    function computeSwapStep(
        uint256 currentPrice,
        uint256 targetPrice,
        uint256 liquidity,
        uint256 quoteRemainingAmount
    )
    internal
    view
    returns (
        uint256 nextPrice,
        uint256 quoteCalculatedAmount,
        uint256 baseCalculatedAmount
    )
    {
        // Side
        bool sideBuy = currentPrice >= targetPrice;
        uint256 amountCalculated;
        if (sideBuy) {
            console.log("start compute swap step");
            console.log("targetPrice: %s",targetPrice);
            console.log("currentPrice: %s",currentPrice);
            console.log("liquidity: %s",liquidity);
            amountCalculated = PriceMath.getQuoteAmountToTargetPrice(targetPrice, currentPrice, liquidity);
            console.log("amount quote calculated: %s",amountCalculated);
            console.log("amount quote remaining: %s",quoteRemainingAmount);
            console.log("end compute swap step");
            if (quoteRemainingAmount >= amountCalculated) {
                nextPrice = targetPrice;
                console.log("in if");
            }
            else {
                // function calculate the next price after swap an specific amount
                nextPrice = PriceMath.getNextPriceFromInput(
                    currentPrice,
                    quoteRemainingAmount,
                    !sideBuy,
                    liquidity
                );
                console.log("in else compute amount math");
            }
            console.log("next price", nextPrice);
        } else {
            console.log("start compute swap step");
            console.log("targetPrice: %s",targetPrice);
            console.log("currentPrice: %s",currentPrice);
            amountCalculated = PriceMath.getQuoteAmountToTargetPrice(targetPrice, currentPrice, liquidity);
            console.log("amount quote calculated: %s",amountCalculated);
            console.log("amount quote remaining: %s",quoteRemainingAmount);
            console.log("end compute swap step");
            if (quoteRemainingAmount >= amountCalculated) nextPrice = targetPrice;
            else
            // function calculate the next price after swap an specific amount
                nextPrice = PriceMath.getNextPriceFromInput(
                    currentPrice,
                    quoteRemainingAmount,
                    sideBuy,
                    liquidity
                );
        }
        bool max = targetPrice == nextPrice;
        console.log("final amount calculated", amountCalculated);
        console.log("final quote remaining amount", quoteRemainingAmount);
        // get the input/output amounts
        if (sideBuy) {
            quoteCalculatedAmount = max
            ? amountCalculated
            : quoteRemainingAmount;
            baseCalculatedAmount = max
            ? PriceMath.getBaseAmountToTargetPrice(targetPrice, currentPrice, liquidity)
            : PriceMath.getBaseAmountToTargetPrice(nextPrice, currentPrice, liquidity);
        } else {
            quoteCalculatedAmount = max
            ? amountCalculated
            : quoteRemainingAmount;
            baseCalculatedAmount = max
            ? PriceMath.getBaseAmountToTargetPrice(targetPrice, currentPrice, liquidity)
            : PriceMath.getBaseAmountToTargetPrice(nextPrice, currentPrice, liquidity);
        }
        console.log("final quote calculated amount", quoteCalculatedAmount);
    }
}



