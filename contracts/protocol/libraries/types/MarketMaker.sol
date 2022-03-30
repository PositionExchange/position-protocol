// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

library MarketMaker {
    struct MMOrder {
        uint128 pip;
        int256 quantity;
    }
}
