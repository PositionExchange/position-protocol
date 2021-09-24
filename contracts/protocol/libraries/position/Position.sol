pragma solidity ^0.8.0;

library Position {
    enum Side {LONG, SHORT}
    struct Data {
        // TODO restruct data

        Position.Side side;
        uint256 size;
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
        self.size = newPosition.size;
        self.margin = newPosition.margin;
        self.openNotional = newPosition.openNotional;
        self.lastUpdatedCumulativePremiumFraction = newPosition.lastUpdatedCumulativePremiumFraction;
        self.blockNumber = newPosition.blockNumber;
    }

}
