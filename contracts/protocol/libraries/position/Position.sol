pragma solidity ^0.8.0;

library Position {
    enum Side {LONG, SHORT}

    struct Data {
        // Type order LONG or SHORT
        Side side;
        uint256 timestamp;
        uint256 blockNumber;
    }
}
