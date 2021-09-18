pragma solidity ^0.8.0;

library LimitOrder {
    struct Data {
        // Type order LONG or SHORT
        uint8 isBuy;
        uint248 size;
    }

    function getData(LimitOrder.Data storage self) internal view returns (
        bool isBuy,
        uint256 size
    ){
        isBuy = self.isBuy == 1;
        size = uint256(size);
    }

    function update(
        LimitOrder.Data storage self,
        bool isBuy,
        uint256 size
    ) internal {
        self.isBuy = isBuy ? 1 : 2;
        self.size = uint248(size);
    }
}
