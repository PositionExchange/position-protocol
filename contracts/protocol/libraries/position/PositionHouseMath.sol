// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

library PositionHouseMath {
    function entryPriceFromNotional(
        uint256 _notional,
        uint256 _quantity,
        uint256 _baseBasicPoint
    ) public pure returns (uint256) {
        return (_notional * _baseBasicPoint) / _quantity;
    }

    function calculatePartialLiquidateMargin(
        uint256 _oldMargin,
        uint256 _manualMargin,
        uint256 _liquidationFeeRatio
    ) public pure returns (uint256 liquidatedPositionMargin, uint256 liquidatedManualMargin) {
        liquidatedPositionMargin = (_oldMargin * _liquidationFeeRatio) /
            100;
        liquidatedManualMargin = (_manualMargin * _liquidationFeeRatio) /
            100;
    }
}
