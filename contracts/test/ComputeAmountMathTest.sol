// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

import {ComputeAmountMath} from '../protocol/libraries/math/ComputeAmountMath.sol';


contract ComputeAmountMathTest {
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
        (nextPrice, quoteCalculatedAmount, baseCalculatedAmount) = ComputeAmountMath.computeSwapStep(
            currentPrice,
            targetPrice,
            liquidity,
            amountRemaining
        );
    }
}
