pragma solidity ^0.8.0;

library PositionLimitOrder {
    enum OrderType {
        OPEN_LIMIT,
        CLOSE_LIMIT
    }
    struct Data {
        int128 pip;
        uint64 orderId;
        uint16 leverage;
        OrderType typeLimitOrder;
        // TODO add blockNumber open create a new struct
        uint8 isBuy;
        uint8 isSelfFilled;
    }

    function checkFilledToSelfOrders(
        mapping(address => mapping(address => PositionLimitOrder.Data[])) storage limitOrderMap,
        int128 startPip,
        int128 endPip,
        uint8 side
    ) internal {

    }

}
