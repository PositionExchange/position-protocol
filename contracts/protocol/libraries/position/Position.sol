// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "../helpers/Quantity.sol";
import "hardhat/console.sol";
import "../../../interfaces/IPositionManager.sol";

library Position {
    using Quantity for int256;
    using Quantity for int72;
    enum Side {
        LONG,
        SHORT
    }
    struct Data {
        // Slot 1
        int72 quantity;
        uint72 openNotional;
        uint112 margin;
        // Slot 2
        int128 lastUpdatedCumulativePremiumFraction;
        uint64 blockNumber;
        uint16 leverage;
        // this slot leaves 48 bit
        // use 8 bit for this dummy
        // set __dummy to 1 when clear position
        // to avoid reinitializing a new slot
        // when open a new position
        // saved ~20,000 gas
        uint8 __dummy;
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
        _self.margin = uint112(_newMargin);
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
        _self.blockNumber = uint64(block.number);
        _self.leverage = 0;
        _self.__dummy = 1;
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
            _self.quantity.abs72();
    }

    function accumulateLimitOrder(
        Position.Data memory _self,
        int256 _quantity,
        uint256 _orderMargin,
        uint256 _orderNotional
    ) internal view returns (Position.Data memory positionData) {
        uint112 _112Margin = uint112(_orderMargin);
        uint72 _72Notional = uint72(_orderNotional);
        // same side
        if (_self.quantity * _quantity > 0) {
            positionData.margin = _self.margin + _112Margin;
            positionData.openNotional = _self.openNotional + _72Notional;
        } else {
            positionData.margin = _self.margin > _112Margin
                ? _self.margin - _112Margin
                : _112Margin - _self.margin;
            positionData.openNotional = _self.openNotional > _72Notional
                ? _self.openNotional - _72Notional
                : _72Notional - _self.openNotional;
        }
        positionData.quantity = _self.quantity + int72(_quantity);
    }
}
