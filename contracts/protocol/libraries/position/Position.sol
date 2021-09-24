pragma solidity ^0.8.0;

library Position {
   struct Data {
      // TODO restruct data
      uint64 size;
      uint64 margin;
      uint64 openNotional;
      uint64 lastUpdatedCumulativePremiumFraction;
      uint64 blockNumber;
   }

}
