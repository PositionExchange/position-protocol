pragma solidity ^0.8.0;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./LimitOrder.sol";

//import "hardhat/console.sol";

/*
 * A library storing data and logic at a pip
 */

library TickPosition {
    using SafeMath for uint128;
    using SafeMath for uint64;
    using LimitOrder for LimitOrder.Data;
    struct Data {
        uint128 liquidity;
        uint64 filledIndex;
        uint64 currentIndex;
        // position at a certain tick
        // index => order data
        mapping(uint64 => LimitOrder.Data) orderQueue;
    }

    function insertLimitOrder(
        TickPosition.Data storage self,
        uint128 size,
        bool hasLiquidity,
        bool isBuy
    ) internal returns (uint64) {
        self.currentIndex++;
        if (!hasLiquidity && self.filledIndex != self.currentIndex && self.liquidity != 0) {
            // means it has liquidity but is not set currentIndex yet
            // reset the filledIndex to fill all
            self.filledIndex = self.currentIndex;
            self.liquidity = size;
        } else {
            self.liquidity = self.liquidity + size;
        }
        self.orderQueue[self.currentIndex].update(isBuy, size);
        return self.currentIndex;
    }

    function updateOrderWhenClose(
        TickPosition.Data storage self,
        uint64 orderId
    ) internal returns (uint256) {
        return self.orderQueue[orderId].updateWhenClose();
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
        if (self.filledIndex > orderId && size != 0) {
            isFilled = true;
        } else if (self.filledIndex < orderId) {
            isFilled = false;
        } else {
            //            isFilled = partialFilled >= 0 && partialFilled < size ? false : true;
            isFilled = partialFilled >= size && size != 0 ? true : false;
        }
    }

    function partiallyFill(
        TickPosition.Data storage self,
        uint128 amount
    ) internal {
        self.liquidity -= amount;
        unchecked {
            uint64 index = self.filledIndex;
            uint128 totalSize = 0;
            while (totalSize < amount) {
                totalSize += self.orderQueue[index].size;
                index++;
            }
            index--;
            self.filledIndex = index;
            //            self.orderQueue[index].partialFilled = totalSize - amount;
            self.orderQueue[index].updatePartialFill(uint120(totalSize - amount));
        }
    }

    function cancelLimitOrder(
        TickPosition.Data storage self,
        uint64 orderId
    ) internal returns(uint256) {
        (bool isBuy,
        uint256 size,
        uint256 partialFilled) = self.orderQueue[orderId].getData();
        self.liquidity = self.liquidity - uint128(size - partialFilled);

        self.orderQueue[orderId].update(isBuy, partialFilled);

        return size - partialFilled;
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
        if (amountClose > partialFilled) {
            uint256 amount = size - partialFilled;
            self.orderQueue[orderId].update(isBuy, amount);
            remainAmountClose = amountClose - partialFilled;
        } else {
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
