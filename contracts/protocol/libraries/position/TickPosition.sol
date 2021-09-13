pragma solidity ^0.8.0;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./Position.sol";

library TickPosition {
    using SafeMath for uint128;
    using SafeMath for uint64;
    struct Data {
        uint128 liquidity;
        uint64 filledIndex;
        uint64 currentIndex;
        // position at a certain tick
        // index => Position.Data
        mapping(uint64 => Position.Data) positions;
    }
//
//    function insertLimit(
//        Data storage self,
//        uint256 size
//    ) internal {
//        self.liquidity = self.liquidity.add(size);
//        self.positions[self.currentIndex++] = Position.Data({
//            side: 1
//        });
//
//    }

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
