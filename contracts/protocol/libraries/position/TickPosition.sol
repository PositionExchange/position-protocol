pragma solidity ^0.8.0;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./LimitOrder.sol";

import "hardhat/console.sol";

/*
 * A library storing data and logic at a pip
 */

library TickPosition {
    using SafeMath for uint128;
    using SafeMath for uint64;
    using LimitOrder for LimitOrder.Data;
    struct Data {
        // IMPORTANT declare liquidity by uint120
        uint120 liquidity;
        uint64 filledIndex;
        uint64 currentIndex;
        // IMPORTANT can change bool to uint8
        uint8 isFullBuy;
        // position at a certain tick
        // index => order data
        mapping(uint64 => LimitOrder.Data) orderQueue;
    }

    function insertLimitOrder(
        TickPosition.Data storage self,
        uint120 size,
        bool hasLiquidity,
        bool isBuy
    ) internal returns (uint64) {
        self.currentIndex++;
        if (!hasLiquidity && self.filledIndex != self.currentIndex && self.liquidity != 0) {
            // means it has liquidity but is not set currentIndex yet
            // reset the filledIndex to fill all
            self.filledIndex = self.currentIndex;
            self.liquidity = size;
            // NEW UPDATE
            self.isFullBuy = isBuy ? 1 : 0;
            self.orderQueue[self.currentIndex].update(isBuy, size);
        }
        // NEW UPDATE
        else {
            if (!hasLiquidity && self.liquidity == 0) {
                self.liquidity = self.liquidity + size;
                self.isFullBuy = isBuy ? 1 : 0;
                self.orderQueue[self.currentIndex].update(isBuy, size);

            }
            else if (isBuy == (self.isFullBuy == 1)) {
                self.liquidity = self.liquidity + size;
                self.orderQueue[self.currentIndex].update(isBuy, size);

            } else {
                if (self.liquidity > size) {
                    partiallyFill(self, size);
                    self.orderQueue[self.currentIndex].update(isBuy, 0);
                    self.orderQueue[self.currentIndex].updatePartialFill(0);
                    // TODO update current orderId size to 0
                } else if (self.liquidity < size) {
                    self.filledIndex = self.currentIndex;
                    self.liquidity = size - self.liquidity;
                    self.isFullBuy = isBuy ? 1 : 0;
                    self.orderQueue[self.currentIndex].update(isBuy, size);
                    console.log(uint256(size), uint256(self.liquidity));
                    self.orderQueue[self.currentIndex].updatePartialFill(size - self.liquidity);
                    updateIsFullBuy(self, isBuy);
                    // TODO update current orderId partiallyFill amount to size - self.liquidity
                } else {
                    self.filledIndex = self.currentIndex;
                    self.liquidity = 0;
                    self.orderQueue[self.currentIndex].update(isBuy, size);
                    self.orderQueue[self.currentIndex].updatePartialFill(0);
                    // TODO update current orderId to fulfill
                }
            }
        }
        return self.currentIndex;
    }

    function updateIsFullBuy(
        TickPosition.Data storage self,
        bool isFullBuyParam
    ) internal {
        self.isFullBuy = isFullBuyParam ? 1 : 0;
    }

    function getQueueOrder(
        TickPosition.Data storage self,
        uint64 orderId
    ) internal view returns (
        bool isFilled,
        bool isBuy,
        uint256 size,
        uint256 partialFilled
    ) {
        (isBuy, size, partialFilled) = self.orderQueue[orderId].getData();
        console.log(">> TickPosition partialFilled", partialFilled);
        if (self.filledIndex > orderId && size != 0) {
            isFilled = true;
        } else if (self.filledIndex < orderId) {
            isFilled = false;
        } else {
            // filledIndex == currentIndex
            isFilled = partialFilled > 0 && partialFilled < size ? false : true;
        }
    }

    function partiallyFill(
        TickPosition.Data storage self,
        uint120 amount
    ) internal {
        self.liquidity -= amount;
        unchecked {
        uint64 index = self.filledIndex;
        uint120 totalSize = 0;
        while (totalSize < amount) {
            totalSize += self.orderQueue[index].size;
            index++;
        }
        index--;
        self.filledIndex = index;
        //            self.orderQueue[index].partialFilled = totalSize - amount;
        self.orderQueue[index].updatePartialFill(totalSize - amount);
    }
}

    function cancelLimitOrder(
        TickPosition.Data storage self,
        uint64 orderId
) internal {
(bool isBuy,
uint256 size,
uint256 partialFilled) = self.orderQueue[orderId].getData();
self.liquidity = self.liquidity - uint120(size - partialFilled);

self.orderQueue[orderId].update(isBuy, partialFilled);
}
function closeLimitOrder(
TickPosition.Data storage self,
uint64 orderId,
uint256 amountClose
) internal returns (uint256 remainAmountClose) {

(bool isBuy,
uint256 size,
uint256 partialFilled) = self.orderQueue[orderId].getData();

uint256 amount = amountClose > partialFilled ? 0 : amountClose;
if (amountClose > partialFilled){
uint256 amount = size - partialFilled;
self.orderQueue[orderId].update(isBuy, amount);
remainAmountClose = amountClose - partialFilled;
}else {
uint256 amount = partialFilled - amountClose;
self.orderQueue[orderId].update(isBuy, amount);
remainAmountClose = 0;
}


}
//    function executeOrder(Data storage self, uint256 size, bool isLong)
//    internal returns
//    (
//        uint256 remainingAmount
//    ) {
//        if(self.liquidity > size){
//            self.liquidity = self.liquidity.sub(size);
//            // safe to increase by plus 1
//            //TODO determine index to plus
////            self.filledIndex += 1;
//            remainingAmount = 0;
//        }else{
//            // fill all liquidity
//            // safe to use with out safemath to avoid gas wasting?
//            remainingAmount = size.sub(self.liquidity);
//            self.liquidity = 0;
//            self.filledIndex = self.currentIndex;
//        }
//    }

}
