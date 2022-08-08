// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;

import "../protocol/libraries/position/math/CoinMargin.sol";

contract CoinMarginTest {
    function calculateNotional(
        uint256 _price,
        uint256 _quantity,
        uint256 _baseBasisPoint
    ) public pure returns (uint256) {
        return CoinMargin.calculateNotional(
            _price,
            _quantity,
            _baseBasisPoint
        );
    }

    function calculateEntryPrice(
        uint256 _notional,
        uint256 _quantity,
        uint256 _baseBasisPoint
    ) public pure returns (uint256) {
        return CoinMargin.calculateEntryPrice(
            _notional,
            _quantity,
            _baseBasisPoint
        );
    }

    function calculatePnl(
        int256 _quantity,
        uint256 _openNotional,
        uint256 _closeNotional
    ) public pure returns (int256) {
        return CoinMargin.calculatePnl(
            _quantity,
            _openNotional,
            _closeNotional
        );
    }
}