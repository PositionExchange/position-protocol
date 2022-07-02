// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "../../helpers/Quantity.sol";

library USDMargin {
    using Quantity for int256;

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

    function calculateLiquidationPip(
        int256 _quantity,
        uint256 _margin,
        uint256 _positionNotional,
        uint256 _maintenanceMargin,
        uint256 _basisPoint
    ) public pure returns (uint256) {
        if (_quantity > 0) {
            if (_margin > _maintenanceMargin + _positionNotional) {
                return 0;
            }
            return (_maintenanceMargin + _positionNotional - _margin) * _basisPoint / _quantity.abs();
        }
        return (_margin + _positionNotional - _maintenanceMargin) * _basisPoint / _quantity.abs();
    }
}