// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

library USDMargin {
    function calculateNotional(
        uint256 _price,
        uint256 _quantity,
        uint256 _baseBasisPoint
    ) public pure returns (uint256) {
        return _quantity * _price / _baseBasisPoint;
    }

    function calculateEntryPrice(
        uint256 _notional,
        uint256 _quantity,
        uint256 _baseBasisPoint
    ) public pure returns (uint256) {
        if (_quantity != 0) {
            return _notional * _baseBasisPoint / _quantity;
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
            return (int256(_closeNotional) - int256(_openNotional));
        }
        // SHORT position
        return (int256(_openNotional) - int256(_closeNotional));
    }

    function calculateFundingPayment(
        int256 _deltaPremiumFraction,
        int256 _quantity,
        int256 PREMIUM_FRACTION_DENOMINATOR
    ) public pure returns (int256) {
        return _quantity * _deltaPremiumFraction / PREMIUM_FRACTION_DENOMINATOR;
    }
}