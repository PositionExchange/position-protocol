pragma solidity ^0.8.0;

import "../helpers/Quantity.sol";
import "hardhat/console.sol";


library Position {

    using Quantity for int256;
    enum Side {LONG, SHORT}
    struct Data {
        // TODO restruct data
        //        Position.Side side;
        int256 quantity;
        int256 sumQuantityLimitOrder;
        uint256 margin;
        uint256 openNotional;
        uint256 lastUpdatedCumulativePremiumFraction;
        uint256 blockNumber;
    }

    function update(
        Position.Data storage self,
        Position.Data memory newPosition
    ) internal {
        self.quantity = newPosition.quantity;
        self.margin = newPosition.margin;
        self.openNotional = newPosition.openNotional;
        self.lastUpdatedCumulativePremiumFraction = newPosition.lastUpdatedCumulativePremiumFraction;
        self.blockNumber = newPosition.blockNumber;
    }

    function clear(
        Position.Data storage self
    ) internal {
        self.quantity = 0;
        self.margin = 0;
        self.openNotional = 0;
        self.lastUpdatedCumulativePremiumFraction = 0;
        // TODO get current block number
        self.blockNumber = 0;
    }

    function side(Position.Data memory self) internal view returns (Position.Side) {
        return self.quantity > 0 ? Position.Side.LONG : Position.Side.SHORT;
    }

    function getEntryPrice(Position.Data memory self) internal view returns (uint256){
        return self.openNotional / self.quantity.abs();
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
            if (self.quantity.abs() > quantity.abs()) {
                console.log("self.margin", self.margin);
                console.log("orderMargin ", orderMargin);
                console.log("self notional", self.openNotional);
                console.log("order notional", orderNotional);
                positionData.margin = self.margin - orderMargin;
                positionData.openNotional = self.openNotional - orderNotional;
            } else {
                positionData.margin = orderMargin - positionData.margin;
                positionData.openNotional = orderNotional - positionData.openNotional;
            }
        }
        positionData.quantity = self.quantity + quantity;
    }

}
