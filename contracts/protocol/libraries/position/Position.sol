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
        Position.LiquidatedData storage self,
        int256 _quantity,
        uint256 _margin,
        uint256 _notional
    ) internal {
        self.quantity += _quantity;
        self.margin += _margin;
        self.notional += _notional;
    }

    function update(
        Position.Data storage self,
        Position.Data memory newPosition
    ) internal {
        self.quantity = newPosition.quantity;
        self.margin = newPosition.margin;
        self.openNotional = newPosition.openNotional;
        self.lastUpdatedCumulativePremiumFraction = newPosition
            .lastUpdatedCumulativePremiumFraction;
        self.blockNumber = newPosition.blockNumber;
        self.leverage = newPosition.leverage;
    }

    function updateMargin(Position.Data storage self, uint256 newMargin)
        internal
    {
        self.margin = newMargin;
    }

    function updatePartialLiquidate(
        Position.Data storage self,
        Position.Data memory newPosition
    ) internal {
        self.quantity += newPosition.quantity;
        self.margin -= newPosition.margin;
        self.openNotional -= newPosition.openNotional;
        self.lastUpdatedCumulativePremiumFraction += newPosition
            .lastUpdatedCumulativePremiumFraction;
        self.blockNumber += newPosition.blockNumber;
        self.leverage = self.leverage;
    }

    function clearDebt(Position.LiquidatedData storage self) internal {
        self.quantity = 0;
        self.margin = 0;
        self.notional = 0;
    }

    function clear(Position.Data storage self) internal {
        self.quantity = 0;
        self.margin = 0;
        self.openNotional = 0;
        self.lastUpdatedCumulativePremiumFraction = 0;
        self.blockNumber = block.number;
        self.leverage = 0;
    }

    function side(Position.Data memory self)
        internal
        view
        returns (Position.Side)
    {
        return self.quantity > 0 ? Position.Side.LONG : Position.Side.SHORT;
    }

    function getEntryPrice(
        Position.Data memory self,
        address addressPositionManager
    ) internal view returns (uint256) {
        IPositionManager _positionManager = IPositionManager(
            addressPositionManager
        );
        return
            (self.openNotional * _positionManager.getBaseBasisPoint()) /
            self.quantity.abs();
    }

    function accumulateLimitOrder(
        Position.Data memory self,
        int256 quantity,
        uint256 orderMargin,
        uint256 orderNotional
    ) internal view returns (Position.Data memory positionData) {
        // same side
        if (self.quantity * quantity > 0) {
            positionData.margin = self.margin + orderMargin;
            positionData.openNotional = self.openNotional + orderNotional;
        } else {
            positionData.margin = self.margin > orderMargin
                ? self.margin - orderMargin
                : orderMargin - self.margin;
            positionData.openNotional = self.openNotional > orderNotional
                ? self.openNotional - orderNotional
                : orderNotional - self.openNotional;
        }
        positionData.quantity = self.quantity + quantity;
    }
}
