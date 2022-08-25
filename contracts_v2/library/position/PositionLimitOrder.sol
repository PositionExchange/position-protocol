// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "./Position.sol";
import "../../../interfaces/IPositionManager.sol";

library PositionLimitOrder {
    enum OrderType {
        OPEN_LIMIT,
        CLOSE_LIMIT
    }
    struct Data {
        uint128 pip;
        uint64 orderId;
        uint16 leverage;
        uint8 isBuy;
        uint256 entryPrice;
        uint256 reduceLimitOrderId;
        uint256 reduceQuantity;
        uint64 blockNumber;
    }
}
