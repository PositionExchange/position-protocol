// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

import './LowGasSafeMath.sol';
import './SafeCast.sol';
import {Calc} from './Calc.sol';
import './FullMath.sol';
import './UnsafeMath.sol';
import './FixedPoint96.sol';
import "hardhat/console.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";


/// @title Functions based on Q64.96 sqrt price and liquidity
/// @notice Contains the math that uses square root of price as a Q64.96 and liquidity to compute deltas
library PriceMath {
//    using LowGasSafeMath for uint256;
    using SafeMath for uint256;
    using SafeCast for uint256;
    using Calc for uint256;

    uint256 constant powNine = 1000000000;
    uint256 constant powEighteen = 1000000000000000000;
    uint256 constant powThirtySix = 1000000000000000000000000000000000000;

    // TODO detail function
    function getQuoteAmountToTargetPrice(
        uint256 targetPrice,
        uint256 currentPrice,
        uint256 liquidity
    ) internal view returns (uint256 amountCalculated) {
        require(targetPrice >= 0 && currentPrice >= 0, "Price can not be lower or equal zero");
        liquidity = Calc.sqrt(liquidity);
        if (targetPrice > currentPrice){
            amountCalculated = (Calc.sqrt(targetPrice).sub(Calc.sqrt(currentPrice)).mul(liquidity)).div(powNine);
            console.log("price math in if");
            console.log(amountCalculated);
        } else {
            amountCalculated = (Calc.sqrt(currentPrice).sub(Calc.sqrt(targetPrice)).mul(liquidity)).div(powNine);
            console.log("price math in else");
        }
    }

    function getBaseAmountToTargetPrice(
        uint256 targetPrice,
        uint256 currentPrice,
        uint256 liquidity
    ) internal view returns (uint256 baseAmountCalculated) {
        require(targetPrice >= 0 && currentPrice >= 0, "Price can not be lower or equal zero");
        liquidity = Calc.sqrt(liquidity);
        if (targetPrice > currentPrice){
            baseAmountCalculated = ((powThirtySix.div(Calc.sqrt(currentPrice)).sub(powThirtySix.div(Calc.sqrt(targetPrice)))).mul(liquidity)).mul(powNine).div(powThirtySix);
        } else {
            baseAmountCalculated = ((powThirtySix.div(Calc.sqrt(targetPrice)).sub(powThirtySix.div(Calc.sqrt(currentPrice)))).mul(liquidity)).mul(powNine).div(powThirtySix);
        }
    }

    // TODO detail function
    function getNextPriceFromInput(
        uint256 currentPrice,
        uint256 amount,
        bool sideBuy,
        uint256 liquidity
    ) internal view returns (uint256 nextPrice) {
        liquidity = Calc.sqrt(liquidity);

        if (sideBuy) {
            nextPrice = (Calc.pow((Calc.sqrt(currentPrice.mul(powEighteen))).add((amount.mul(powEighteen)).div(liquidity)), 2)).div(powEighteen);
        } else {
            nextPrice = (Calc.pow((Calc.sqrt(currentPrice.mul(powEighteen))).sub((amount.mul(powEighteen)).div(liquidity)), 2)).div(powEighteen);
        }
    }


}
