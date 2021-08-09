// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

import {PriceMath} from '../protocol/libraries/math/PriceMath.sol';


contract PriceMathTest {

    function getAmountToTargetPrice(
        uint256 targetPrice,
        uint256 currentPrice,
        uint256 liquidity
    ) external pure returns (uint256 amountCalculated) {


        amountCalculated = PriceMath.getAmountToTargetPrice(
            targetPrice,
            currentPrice,
            liquidity);

    }

    function getNextPriceFromInput(
        uint256 currentPrice,
        uint256 amount,
        bool sideBuy,
        uint256 liquidity
    ) internal pure returns (uint256 nextPrice) {

        nextPrice = PriceMath.getNextPriceFromInput(currentPrice,
            amount,
            sideBuy,
            liquidity);

    }

}
