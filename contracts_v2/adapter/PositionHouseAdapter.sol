// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;

import "./interface/IPositionManager.sol";
import "../library/position/Position.sol";
import "../library/position/PositionLimitOrder.sol";
import "../library/position/PipConversionMath.sol";
import "../library/position/PositionMath.sol";
import "../library/helper/Quantity.sol";
import "../library/helper/Int256Math.sol";
import "../library/helper/CommonMath.sol";
import "../library/helper/Errors.sol";
import "../library/type/PositionHouseStorage.sol";

library PositionManagerAdapter {
    int256 private constant PREMIUM_FRACTION_DENOMINATOR = 10 ** 10;
    using PositionLimitOrder for mapping(address => mapping(address => PositionLimitOrder.Data[]));
    using Position for Position.Data;
    using Position for Position.LiquidatedData;
    using Quantity for int256;
    using Quantity for int128;
    using Int256Math for int256;
    using PipConversionMath for uint128;

    function clearAllFilledOrder(
        IPositionManager _positionManager,
        PositionLimitOrder.Data[] memory _limitOrders
    )
    external
    returns (
        PositionLimitOrder.Data[] memory
    )
    {
        PositionLimitOrder.Data[]
        memory subLimitOrders = new PositionLimitOrder.Data[](
            _limitOrders.length
        );
        if (_limitOrders.length > 0) {
            uint256 index = 0;
            for (uint256 i = 0; i < _limitOrders.length; i++) {
                (bool isFilled, , , ) = _positionManager.getPendingOrderDetail(
                    _limitOrders[i].pip,
                    _limitOrders[i].orderId
                );
                if (isFilled != true) {
                    subLimitOrders[index] = _limitOrders[i];
                    _positionManager.updatePartialFilledOrder(
                        _limitOrders[i].pip,
                        _limitOrders[i].orderId
                    );
                    index++;
                }
            }
        }
        return subLimitOrders;
    }

    function calculateLimitOrder(
        address _positionManager,
        PositionLimitOrder.Data[] memory _limitOrders,
        PositionLimitOrder.Data[] memory _reduceLimitOrders,
        Position.Data memory _positionData
    ) external view returns (Position.Data memory positionData) {
        for (uint256 i = 0; i < _limitOrders.length; i++) {
            if (_limitOrders[i].pip != 0) {
                _positionData = accumulateLimitOrderToPositionData(
                    _positionManager,
                    _limitOrders[i],
                    _positionData,
                    _limitOrders[i].entryPrice
                );
            }
        }
        for (uint256 i = 0; i < _reduceLimitOrders.length; i++) {
            if (_reduceLimitOrders[i].pip != 0) {
                _positionData = accumulateLimitOrderToPositionData(
                    _positionManager,
                    _reduceLimitOrders[i],
                    _positionData,
                    _reduceLimitOrders[i].entryPrice
                );
            }
        }
        positionData = _positionData;
    }

    function getTotalPendingLimitOrderMargin(
        IPositionManager _positionManager,
        PositionLimitOrder.Data[] memory _limitOrder,
        PositionLimitOrder.Data[] memory _reduceOrder
    ) external returns (uint256 totalMargin) {
        for (uint i = 0; i < _limitOrder.length; i++) {
            (
            bool isFilled,
            ,
            ,
            ) = _positionManager.getPendingOrderDetail(
                _limitOrder[i].pip,
                _limitOrder[i].orderId
            );
            if (!isFilled) {
                (uint256 refundQuantity, ) = _positionManager.cancelLimitOrder(_limitOrder[i].pip, _limitOrder[i].orderId);
                (, uint256 refundMargin, ) = _positionManager.getNotionalMarginAndFee(refundQuantity, _limitOrder[i].pip, _limitOrder[i].leverage);
                totalMargin += refundMargin;
            }
        }
        for (uint i = 0; i < _reduceOrder.length; i++) {
            (
            bool isFilled,
            ,
            ,
            ) = _positionManager.getPendingOrderDetail(
                _reduceOrder[i].pip,
                _reduceOrder[i].orderId
            );
            if (!isFilled) {
                _positionManager.cancelLimitOrder(_reduceOrder[i].pip, _reduceOrder[i].orderId);
            }
        }
        return totalMargin;
    }

    function getListOrderPending(
        address _pmAddress,
        address _trader,
        PositionLimitOrder.Data[] memory _limitOrders,
        PositionLimitOrder.Data[] memory _reduceLimitOrders
    ) external view returns (PositionHouseStorage.LimitOrderPending[] memory) {
        IPositionManager _positionManager = IPositionManager(_pmAddress);
        if (_limitOrders.length + _reduceLimitOrders.length > 0) {
            PositionHouseStorage.LimitOrderPending[]
            memory listPendingOrders = new PositionHouseStorage.LimitOrderPending[](
                _limitOrders.length + _reduceLimitOrders.length + 1
            );
            uint256 index = 0;
            for (uint256 i = 0; i < _limitOrders.length; i++) {
                (
                bool isFilled,
                bool isBuy,
                uint256 quantity,
                uint256 partialFilled
                ) = _positionManager.getPendingOrderDetail(
                    _limitOrders[i].pip,
                    _limitOrders[i].orderId
                );
                if (!isFilled) {
                    listPendingOrders[index] = PositionHouseStorage
                    .LimitOrderPending({
                    isBuy: isBuy,
                    quantity: quantity,
                    partialFilled: partialFilled,
                    pip: _limitOrders[i].pip,
                    leverage: _limitOrders[i].leverage,
                    blockNumber: uint64(_limitOrders[i].blockNumber),
                    isReduce: 0,
                    orderIdx: i,
                    orderId: _limitOrders[i].orderId
                    });
                    index++;
                }
            }
            for (uint256 i = 0; i < _reduceLimitOrders.length; i++) {
                (
                bool isFilled,
                bool isBuy,
                uint256 quantity,
                uint256 partialFilled
                ) = _positionManager.getPendingOrderDetail(
                    _reduceLimitOrders[i].pip,
                    _reduceLimitOrders[i].orderId
                );
                if (!isFilled) {
                    listPendingOrders[index] = PositionHouseStorage
                    .LimitOrderPending({
                    isBuy: isBuy,
                    quantity: quantity,
                    partialFilled: partialFilled,
                    pip: _reduceLimitOrders[i].pip,
                    leverage: _reduceLimitOrders[i].leverage,
                    blockNumber: uint64(_reduceLimitOrders[i].blockNumber),
                    isReduce: 1,
                    orderIdx: i,
                    orderId: _reduceLimitOrders[i].orderId
                    });
                    index++;
                }
            }
            for (uint256 i = 0; i < listPendingOrders.length; i++) {
                if (listPendingOrders[i].quantity != 0) {
                    return listPendingOrders;
                }
            }
        }
        PositionHouseStorage.LimitOrderPending[] memory blankListPendingOrders;
        return blankListPendingOrders;
    }

    function getPositionNotionalAndUnrealizedPnl(
        address _pmAddress,
        address _trader,
        PositionHouseStorage.PnlCalcOption _pnlCalcOption,
        Position.Data memory _position
    ) external view returns (uint256 positionNotional, int256 unrealizedPnl) {
        IPositionManager positionManager = IPositionManager(_pmAddress);
        uint256 openNotional = _position.openNotional;
        uint256 baseBasisPoint = positionManager.getBaseBasisPoint();
        if (_pnlCalcOption == PositionHouseStorage.PnlCalcOption.SPOT_PRICE) {
            positionNotional = PositionMath.calculateNotional(positionManager.getPrice(), _position.quantity.abs(), baseBasisPoint);
        } else if (_pnlCalcOption == PositionHouseStorage.PnlCalcOption.TWAP) {
            // TODO recheck this interval time
            uint256 _intervalTime = 90;
            positionNotional = PositionMath.calculateNotional(positionManager.getTwapPrice(_intervalTime), _position.quantity.abs(), baseBasisPoint);
        } else {
            positionNotional = PositionMath.calculateNotional(positionManager.getUnderlyingPrice(), _position.quantity.abs(), baseBasisPoint);
        }
        unrealizedPnl = PositionMath.calculatePnl(_position.quantity, _position.openNotional, positionNotional);
    }

    enum ReturnCheckOrderSideAndQuantity {
        PASS,
        MUST_SAME_SIDE,
        MUST_SMALLER_QUANTITY
    }

    function checkPendingOrderSideAndQuantity(
        IPositionManager _positionManager,
        CheckSideAndQuantityParam memory _checkParam
    ) external view returns (ReturnCheckOrderSideAndQuantity) {
        // Get order in both increase and reduce limit order array
        bool newOrderIsBuy = _checkParam.side == Position.Side.LONG;
        bool positionIsBuy = _checkParam.positionQuantity > 0;
        uint256 totalPendingQuantity;
        bool pendingOrderIsBuy;
        // loop to check array increase limit orders
        (totalPendingQuantity, pendingOrderIsBuy) = _getTotalPendingQuantityFromLimitOrders(_positionManager, _checkParam.limitOrders);
        // if there are pending limit increase order
        if (totalPendingQuantity != 0) {
            // if new order is same side as pending order return true
            if (newOrderIsBuy == pendingOrderIsBuy) {
                return ReturnCheckOrderSideAndQuantity.PASS;
            }
            else {
                return ReturnCheckOrderSideAndQuantity.MUST_SAME_SIDE;
            }
        }
        // if there are not pending limit increase order, for loop check array limit reduce
        (totalPendingQuantity, pendingOrderIsBuy) = _getTotalPendingQuantityFromLimitOrders(_positionManager, _checkParam.reduceLimitOrders);
        // if there are pending limit reduce order
        if (totalPendingQuantity != 0) {
            uint256 totalReverseQuantity = totalPendingQuantity + _checkParam.orderQuantity;
            // if total quantity of reverse order is smaller than current position
            // and new order is same side as pending order, return true
            if (newOrderIsBuy == pendingOrderIsBuy && totalReverseQuantity <= _checkParam.positionQuantity.abs()) {
                return ReturnCheckOrderSideAndQuantity.PASS;
            } else if (newOrderIsBuy != pendingOrderIsBuy) {
                return ReturnCheckOrderSideAndQuantity.MUST_SAME_SIDE;
            } else {
                return ReturnCheckOrderSideAndQuantity.MUST_SMALLER_QUANTITY;
            }
        }
        // if user don't have position, return true
        if (_checkParam.positionQuantity == 0) return ReturnCheckOrderSideAndQuantity.PASS;
        // if user don't have pending order but new order is reverse, order quantity > position quantity, return false
        if (newOrderIsBuy != positionIsBuy && _checkParam.orderQuantity > _checkParam.positionQuantity.abs()) {
            return ReturnCheckOrderSideAndQuantity.MUST_SMALLER_QUANTITY;
        }
        return ReturnCheckOrderSideAndQuantity.PASS;
    }

    /// @dev get total pending order quantity from pending limit orders
    function _getTotalPendingQuantityFromLimitOrders(IPositionManager _positionManager, PositionLimitOrder.Data[] memory _limitOrders)
    internal
    view
    returns (uint256 totalPendingQuantity, bool _isBuy)
    {
        for (uint256 i = 0; i < _limitOrders.length; i++) {
            (
            bool isFilled,
            bool isBuy,
            uint256 quantity,
            uint256 partialFilled
            ) = _positionManager.getPendingOrderDetail(
                _limitOrders[i].pip,
                _limitOrders[i].orderId
            );
            // calculate total quantity of the pending order only (!isFilled)
            // partialFilled == quantity means the order is filled
            if (!isFilled && quantity > partialFilled) {
                totalPendingQuantity += (quantity - partialFilled);
            }
            if (quantity != 0) {
                _isBuy = isBuy;
            }
        }
    }

    /// @dev Accumulate limit order to Position Data
    /// @param _pmAddress Position Manager address
    /// @param _limitOrder can be reduce or increase limit order
    /// @param _positionData the position data to accumulate
    /// @param _entryPrice if a reduce limit order, _entryPrice will != 0
    function accumulateLimitOrderToPositionData(
        address _pmAddress,
        PositionLimitOrder.Data memory _limitOrder,
        Position.Data memory _positionData,
        uint256 _entryPrice
    ) internal view returns (Position.Data memory) {
        IPositionManager _positionManager = IPositionManager(_pmAddress);
        (uint64 _baseBasicPoint, uint64 _basisPoint) = _positionManager.getBasisPointFactors();
        int256 _orderQuantity = _getLimitOrderQuantity(_positionManager, _limitOrder);
        // if _entryPrice != 0, must calculate notional by _entryPrice (for reduce limit order)
        // if _entryPrice == 0, calculate notional by order pip (current price)
        // NOTE: _entryPrice must divide _baseBasicPoint to get the "raw entry price"
        uint256 _orderEntryPrice = _entryPrice == 0 ? _limitOrder.pip.toNotional(_baseBasicPoint, _basisPoint) : _entryPrice;
        uint256 _orderNotional = PositionMath.calculateNotional(_orderEntryPrice, _orderQuantity.abs(), _baseBasicPoint);
        uint256 _orderMargin = _orderNotional / _limitOrder.leverage;
        _positionData = _positionData.accumulateLimitOrder(
            _orderQuantity,
            _orderMargin,
            _orderNotional
        );
        _positionData.leverage = CommonMath.maxU16(_positionData.leverage, _limitOrder.leverage);
        return _positionData;
    }

}

