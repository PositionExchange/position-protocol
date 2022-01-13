pragma solidity ^0.8.0;

import "hardhat/console.sol";

library LimitOrder {
    struct Data {
        // Type order LONG or SHORT
        uint8 isBuy;
        uint120 size;
        // NOTICE need to add leverage
        uint120 partialFilled;
    }

    function getData(LimitOrder.Data storage self)
        internal
        view
        returns (
            bool isBuy,
            uint256 size,
            uint256 partialFilled
        )
    {
        isBuy = self.isBuy == 1;
        size = uint256(self.size);
        partialFilled = uint256(self.partialFilled);
    }

    function update(
        LimitOrder.Data storage self,
        bool isBuy,
        uint256 size
    ) internal {
        self.isBuy = isBuy ? 1 : 2;
        self.size = uint120(size);
    }

    function updatePartialFill(LimitOrder.Data storage self, uint120 remainSize)
        internal
    {
        // remainingSize should be negative
        self.partialFilled += self.size - remainSize;
    }

    function updateWhenClose(LimitOrder.Data storage self)
        internal
        returns (uint256)
    {
        self.size -= self.partialFilled;
        self.partialFilled = 0;
        return (uint256(self.size));
    }

    function getPartialFilled(LimitOrder.Data storage self)
        internal
        view
        returns (bool isPartial, uint256 remainingSize)
    {
        remainingSize = self.size - self.partialFilled;
        isPartial = remainingSize > 0;
    }
}
