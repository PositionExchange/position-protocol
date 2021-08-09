// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

import './LowGasSafeMath.sol';
import './SafeCast.sol';
import {Calc} from './Calc.sol';
import './FullMath.sol';
import './UnsafeMath.sol';
import './FixedPoint96.sol';
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";


/// @title Functions based on Q64.96 sqrt price and liquidity
/// @notice Contains the math that uses square root of price as a Q64.96 and liquidity to compute deltas
library PriceMath {
//    using LowGasSafeMath for uint256;
    using SafeMath for uint256;
    using SafeCast for uint256;
    using Calc for uint256;

    // TODO detail function
    function getAmountToTargetPrice(
        uint256 targetPrice,
        uint256 currentPrice,
        uint256 liquidity
    ) internal pure returns (uint256 amountCalculated) {
        amountCalculated = Calc.sqrt(targetPrice).sub(Calc.sqrt(currentPrice)).mul(liquidity).abs();
    }

    // TODO detail function
    function getNextPriceFromInput(
        uint256 currentPrice,
        uint256 amount,
        bool sideBuy,
        uint256 liquidity
    ) internal pure returns (uint256 nextPrice) {
        if (sideBuy) {
            nextPrice = Calc.pow(Calc.sqrt(currentPrice).add(amount.div(liquidity)), 2);
        } else {
            nextPrice = Calc.pow(Calc.sqrt(currentPrice).sub(amount.div(liquidity)), 2);
        }
    }
}
