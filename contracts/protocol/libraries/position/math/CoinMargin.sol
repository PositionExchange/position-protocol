// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "../../helpers/Quantity.sol";

library CoinMargin {
    using Quantity for int256;

    function calculateNotional(
        uint256 _price,
        uint256 _quantity,
        uint256 _baseBasisPoint
    ) public pure returns (uint256) {
        if (_price != 0) {
            return _quantity * _baseBasisPoint / _price;
        }
        return 0;
    }

    function calculateEntryPrice(
        uint256 _notional,
        uint256 _quantity,
        uint256 _baseBasisPoint
    ) public pure returns (uint256) {
        if (_notional != 0) {
            return _quantity * _baseBasisPoint / _notional;
        }
        return 0;
    }

    function calculatePnl(
        int256 _quantity,
        uint256 _openNotional,
        uint256 _closeNotional
    ) public pure returns (int256) {
        // LONG position
        if (_quantity > 0) {
            return int256(_openNotional) - int256(_closeNotional);
        }
        // SHORT position
        return int256(_closeNotional) - int256(_openNotional);
    }

    function calculateFundingPayment(
        int256 _deltaPremiumFraction,
        int256 _quantity,
        int256 PREMIUM_FRACTION_DENOMINATOR
    ) public pure returns (int256) {
        if (_deltaPremiumFraction != 0) {
            return _quantity * PREMIUM_FRACTION_DENOMINATOR / _deltaPremiumFraction;
        }
        return 0;
    }

    function calculateLiquidationPip(
        int256 _quantity,
        uint256 _margin,
        uint256 _positionNotional,
        uint256 _maintenanceMargin,
        uint256 _basisPoint
    ) public pure returns (uint256) {
        // if position is long
        if (_quantity > 0) {
            return _quantity.abs() * _basisPoint / (_positionNotional + _margin - _maintenanceMargin);
        }
        // position is short
        return _quantity.abs() * _basisPoint / (_positionNotional + _maintenanceMargin - _margin);
    }
}