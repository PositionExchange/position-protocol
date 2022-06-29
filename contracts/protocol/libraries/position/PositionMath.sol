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
        int256 _margin,
        int256 _PREMIUM_FRACTION_DENOMINATOR
    ) public pure returns (int256) {
        return _margin * _deltaPremiumFraction / _PREMIUM_FRACTION_DENOMINATOR;
    }

    function calculateLiquidationPip(
        int256 _quantity,
        uint256 _margin,
        uint256 _positionNotional,
        uint256 _maintenanceMargin,
        uint256 _basisPoint
    ) public pure returns (uint256) {
        return USDMargin.calculateLiquidationPip(
            _quantity,
            _margin,
            _positionNotional,
            _maintenanceMargin,
            _basisPoint
        );
    }
}
