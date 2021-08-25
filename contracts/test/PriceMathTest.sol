// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

import {PriceMath} from '../protocol/libraries/math/PriceMath.sol';
import {Calc} from '../protocol/libraries/math/Calc.sol';

contract PriceMathTest {

    function getQuoteAmountToTargetPrice(
        uint256 targetPrice,
        uint256 currentPrice,
        uint256 liquidity
    ) external view returns (uint256 amountCalculated) {


        amountCalculated = PriceMath.getQuoteAmountToTargetPrice(
            targetPrice,
            currentPrice,
            liquidity);

    }

    function getBaseAmountToTargetPrice(
        uint256 targetPrice,
        uint256 currentPrice,
        uint256 liquidity
    ) external view returns (uint256 amountCalculated) {


        amountCalculated = PriceMath.getBaseAmountToTargetPrice(
            targetPrice,
            currentPrice,
            liquidity);

    }

    function getNextPriceFromInput(
        uint256 currentPrice,
        uint256 amount,
        bool sideBuy,
        uint256 liquidity
    ) external view returns (uint256 nextPrice) {

        nextPrice = PriceMath.getNextPriceFromInput(currentPrice,
            amount,
            sideBuy,
            liquidity);

    }

}
