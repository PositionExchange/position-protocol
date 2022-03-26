// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "../libraries/position/PositionLimitOrder.sol";

abstract contract LimitOrderManager {
    // increase orders
    mapping(address => mapping(address => PositionLimitOrder.Data[])) private limitOrders;
    // reduce orders
    mapping(address => mapping(address => PositionLimitOrder.Data[])) private reduceLimitOrders;

    function _getLimitOrderPointer(address _pmAddress, address _trader, uint8 _isReduce) internal view returns (PositionLimitOrder.Data[] storage) {
        return _isReduce == 1
        ? reduceLimitOrders[_pmAddress][_trader]
        : limitOrders[_pmAddress][_trader];
    }

    function _getLimitOrders(address _pmAddress, address _trader) internal view returns (PositionLimitOrder.Data[] memory){
        return limitOrders[_pmAddress][_trader];
    }

    function _getReduceLimitOrders(address _pmAddress, address _trader) internal view returns (PositionLimitOrder.Data[] memory){
        return reduceLimitOrders[_pmAddress][_trader];
    }

    function _pushLimit(address _pmAddress, address _trader, PositionLimitOrder.Data memory order) internal {
        limitOrders[_pmAddress][_trader].push(order);
    }

    function _pushReduceLimit(address _pmAddress, address _trader, PositionLimitOrder.Data memory order) internal {
        reduceLimitOrders[_pmAddress][_trader].push(order);
    }

    function _emptyLimitOrders(address _pmAddress, address _trader) internal {
        if (_getLimitOrders(_pmAddress, _trader).length > 0) {
            delete limitOrders[_pmAddress][_trader];
        }
    }

    function _emptyReduceLimitOrders(address _pmAddress, address _trader) internal {
        if (_getReduceLimitOrders(_pmAddress, _trader).length > 0) {
            delete reduceLimitOrders[_pmAddress][_trader];
        }
    }

    function _blankReduceLimitOrder(address _pmAddress, address _trader, uint256 index) internal {
        // blank limit order data
        // we set the deleted order to a blank data
        // because we don't want to mess with order index (orderIdx)
        PositionLimitOrder.Data memory blankLimitOrderData;
        reduceLimitOrders[_pmAddress][_trader][index] = blankLimitOrderData;
    }


}
