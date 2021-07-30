// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

//import
//
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {Calc} from "./Calc.sol";


/// @title Math library for liquidity
library LiquidityMath {
    using SafeMath for uint256;
    using Calc for uint256;
    /// @notice Add a signed liquidity delta to liquidity and revert if it overflows or underflows
    /// @param x The liquidity before change
    /// @param y The delta by which liquidity should be changed
    /// @return z The liquidity delta
    function addDelta(uint128 x, int128 y) internal pure returns (uint128 z) {
        if (y < 0) {
            require((z = x - uint128(- y)) < x, 'LS');
        } else {
            require((z = x + uint128(y)) >= x, 'LA');
        }
    }

    function getBaseAmountByQuote(
        uint256 quoteAmount,
        bool sideBuy, uint256 liquidity,
        uint256 quoteReserveAmount,
        uint256 baseReserveAmount)
    internal pure returns (uint256 baseAmount) {
        //        (uint256 liquidity, uint256 quoteReserveAmount, uint256 baseReserveAmount) = getLiquidityDetail();
        if (sideBuy) {
            baseAmount = baseReserveAmount.sub(liquidity.div(quoteReserveAmount.add(quoteAmount)));
        } else {
            baseAmount = liquidity.div(quoteReserveAmount.sub(quoteAmount)).sub(baseReserveAmount);
        }
    }

    function getQuoteAmountByBase(
        uint256 baseAmount,
        bool sideBuy,
        uint256 liquidity,
        uint256 quoteReserveAmount,
        uint256 baseReserveAmount
    ) internal pure returns (uint256 quoteAmount) {
        //        (uint256 liquidity, uint256 quoteReserveAmount, uint256 baseReserveAmount) = getLiquidityDetail();
        if (sideBuy) {
            quoteAmount = liquidity.div(baseReserveAmount.sub(baseAmount)).sub(quoteReserveAmount);
        } else {
            quoteAmount = quoteReserveAmount.sub(liquidity.div(baseReserveAmount.add(quoteAmount)));
        }
    }
}
