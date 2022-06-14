// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import {USDMargin} from "./math/USDMargin.sol";

library PositionMath {
    function calculateNotional(
        uint256 _price,
        uint256 _quantity,
        uint256 _baseBasisPoint
    ) public pure returns (uint256) {
        return USDMargin.calculateNotional(_price, _quantity, _baseBasisPoint);
    }

    function calculateEntryPrice(
        uint256 _notional,
        uint256 _quantity,
        uint256 _baseBasisPoint
    ) public pure returns (uint256) {
        return USDMargin.calculateEntryPrice(_notional, _quantity, _baseBasisPoint);
    }

    function calculatePnl(
        int256 _quantity,
        uint256 _openNotional,
        uint256 _closeNotional
    ) public pure returns (int256) {
        return USDMargin.calculatePnl(_quantity, _openNotional, _closeNotional);
    }

    function calculateFundingPayment(
        int256 _deltaPremiumFraction,
        int256 _quantity,
        int256 PREMIUM_FRACTION_DENOMINATOR
    ) public pure returns (int256) {
        return USDMargin.calculateFundingPayment(_deltaPremiumFraction, _quantity, PREMIUM_FRACTION_DENOMINATOR);
    }
}
