pragma solidity ^0.8.0;

import "../protocol/libraries/position/PositionLimitOrder.sol";

contract PositionLimitOrderTest {
    using PositionLimitOrder for mapping(address => mapping(address => PositionLimitOrder.Data[]));
    mapping(address => mapping(address => PositionLimitOrder.Data[])) public limitOrderMap;

    function mockLimitOrder(
        address _positionManager,
        uint256 _side,
        uint256 _quantity,
        int128 _pip,
        uint64 _orderId,
        uint256 _leverage,
        bool isOpenLimitOrder
    ) public {
        address _trader = msg.sender;
        limitOrderMap[_positionManager][_trader].push(PositionLimitOrder.Data({
            pip : _pip,
            orderId : _orderId,
            leverage : uint16(_leverage),
            typeLimitOrder : isOpenLimitOrder ? PositionLimitOrder.OrderType.OPEN_LIMIT : PositionLimitOrder.OrderType.CLOSE_LIMIT,
            isBuy: uint8(_side),
            isSelfFilled: 0
        }));
    }

    function checkFilledToSelfOrders(int128 startPip, int128 endPip, uint8 side) public {
        limitOrderMap.checkFilledToSelfOrders(startPip, endPip, side);
    }

}
