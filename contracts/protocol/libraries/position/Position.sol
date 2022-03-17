// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "../helpers/Quantity.sol";
import "hardhat/console.sol";
import "../../../interfaces/IPositionManager.sol";

library Position {
    using Quantity for int256;
    enum Side {
        LONG,
        SHORT
    }
    struct Data {
        // TODO restruct data
        int256 quantity;
        uint256 margin;
        uint256 openNotional;
        int256 lastUpdatedCumulativePremiumFraction;
        uint256 blockNumber;
        uint256 leverage;
    }

    struct LiquidatedData {
        int256 quantity;
        uint256 margin;
        uint256 notional;
    }

    function updateDebt(
        Position.LiquidatedData storage _self,
        int256 _quantity,
        uint256 _margin,
        uint256 _notional
    ) internal {
        _self.quantity += _quantity;
        _self.margin += _margin;
        _self.notional += _notional;
    }

    function update(
        Position.Data storage _self,
        Position.Data memory _newPosition
    ) internal {
        _self.quantity = _newPosition.quantity;
        _self.margin = _newPosition.margin;
        _self.openNotional = _newPosition.openNotional;
        _self.lastUpdatedCumulativePremiumFraction = _newPosition
            .lastUpdatedCumulativePremiumFraction;
        _self.blockNumber = _newPosition.blockNumber;
        _self.leverage = _newPosition.leverage;
    }

    function updateMargin(Position.Data storage _self, uint256 _newMargin)
        internal
    {
        _self.margin = _newMargin;
    }

    function updatePartialLiquidate(
        Position.Data storage _self,
        Position.Data memory _newPosition
    ) internal {
        _self.quantity += _newPosition.quantity;
        _self.margin -= _newPosition.margin;
        _self.openNotional -= _newPosition.openNotional;
        _self.lastUpdatedCumulativePremiumFraction += _newPosition
            .lastUpdatedCumulativePremiumFraction;
        _self.blockNumber += _newPosition.blockNumber;
        _self.leverage = _self.leverage;
    }

    function clearDebt(Position.LiquidatedData storage _self) internal {
        _self.quantity = 0;
        _self.margin = 0;
        _self.notional = 0;
    }

    function clear(Position.Data storage _self) internal {
        _self.quantity = 0;
        _self.margin = 0;
        _self.openNotional = 0;
        _self.lastUpdatedCumulativePremiumFraction = 0;
        _self.blockNumber = block.number;
        _self.leverage = 0;
    }

    function side(Position.Data memory _self)
        internal
        view
        returns (Position.Side)
    {
        return _self.quantity > 0 ? Position.Side.LONG : Position.Side.SHORT;
    }

    function getEntryPrice(
        Position.Data memory _self,
        address _addressPositionManager
    ) internal view returns (uint256) {
        IPositionManager _positionManager = IPositionManager(
            _addressPositionManager
        );
        return
            (_self.openNotional * _positionManager.getBaseBasisPoint()) /
            _self.quantity.abs();
    }

    function accumulateLimitOrder(
        Position.Data memory _self,
        int256 _quantity,
        uint256 _orderMargin,
        uint256 _orderNotional
    ) internal view returns (Position.Data memory positionData) {
        // same side
        if (_self.quantity * _quantity > 0) {
            positionData.margin = _self.margin + _orderMargin;
            positionData.openNotional = _self.openNotional + _orderNotional;
        } else {
            positionData.margin = _self.margin > _orderMargin
                ? _self.margin - _orderMargin
                : _orderMargin - _self.margin;
            positionData.openNotional = _self.openNotional > _orderNotional
                ? _self.openNotional - _orderNotional
                : _orderNotional - _self.openNotional;
        }
        positionData.quantity = _self.quantity + _quantity;
    }
}
