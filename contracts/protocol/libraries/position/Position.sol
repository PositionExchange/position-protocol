pragma solidity ^0.8.0;

import "../helpers/Quantity.sol";


library Position {

    using Quantity for int256;
    enum Side {LONG, SHORT}
    struct Data {
        // TODO restruct data
        Position.Side side;
        int256 quantity;
        uint256 margin;
        uint256 openNotional;
        uint256 lastUpdatedCumulativePremiumFraction;
        uint256 blockNumber;
    }

    function update(
        Position.Data storage self,
        Position.Data memory newPosition
    ) internal {
        self.side = newPosition.side;
        self.quantity = newPosition.quantity;
        self.margin = newPosition.margin;
        self.openNotional = newPosition.openNotional;
        self.lastUpdatedCumulativePremiumFraction = newPosition.lastUpdatedCumulativePremiumFraction;
        self.blockNumber = newPosition.blockNumber;
    }

    function clear(
        Position.Data storage self
    ) internal {
        self.side = Side.LONG;
        self.quantity = 0;
        self.margin = 0;
        self.openNotional = 0;
        self.lastUpdatedCumulativePremiumFraction = 0;
        // TODO get current block number
        self.blockNumber = 0;
    }

    function getEntryPrice(Position.Data memory self) internal view returns (uint256){
        return self.openNotional / self.quantity.abs();
    }

}
