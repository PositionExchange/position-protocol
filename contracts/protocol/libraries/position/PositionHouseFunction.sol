// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;

import "./Position.sol";
import "../../../interfaces/IPositionManager.sol";
import "./PositionLimitOrder.sol";
import "../../libraries/helpers/Quantity.sol";
import "../../libraries/helpers/Int256Math.sol";
import "../../PositionHouse.sol";
import "../types/PositionHouseStorage.sol";
import "./PipConversionMath.sol";
import "../helpers/CommonMath.sol";
import {Errors} from "../helpers/Errors.sol";
import {PositionMath} from "./PositionMath.sol";

import "hardhat/console.sol";

library PositionHouseFunction {
    int256 private constant PREMIUM_FRACTION_DENOMINATOR = 10 ** 10;
    using PositionLimitOrder for mapping(address => mapping(address => PositionLimitOrder.Data[]));
    using Position for Position.Data;
    using Position for Position.LiquidatedData;
    using Quantity for int256;
    using Quantity for int128;
    using Int256Math for int256;
    using PipConversionMath for uint128;

    function handleMarketPart(
        Position.Data memory _positionData,
        Position.Data memory _positionDataWithoutLimit,
        uint256 _newNotional,
        int256 _newQuantity,
        uint16 _leverage,
        int128 _latestCumulativePremiumFraction
    ) external view returns (Position.Data memory newData) {
        if (_newQuantity * _positionData.quantity >= 0) {
            newData = Position.Data(
                _positionDataWithoutLimit.quantity + _newQuantity,
                handleMarginInIncrease(
                    _newNotional / _leverage,
                    _positionData,
                    _positionDataWithoutLimit,
                    _latestCumulativePremiumFraction
                ),
                handleNotionalInIncrease(
                    _newNotional,
                    _positionData,
                    _positionDataWithoutLimit
                ),
                _latestCumulativePremiumFraction,
                blockNumber(),
                _leverage,
                1
            );
        } else {
            newData = Position.Data(
                _positionDataWithoutLimit.quantity + _newQuantity,
                handleMarginInOpenReverse(
                    (_positionData.margin * _newQuantity.abs()) /
                        _positionData.quantity.abs(),
                    _positionData,
                    _positionDataWithoutLimit,
                    _latestCumulativePremiumFraction
                ),
                handleNotionalInOpenReverse(
                    (_positionData.openNotional * _newQuantity.abs()) /
                        _positionData.quantity.abs(),
                    _positionData,
                    _positionDataWithoutLimit
                ),
                _latestCumulativePremiumFraction,
                blockNumber(),
                _leverage,
                1
            );
        }
    }

    // There are 4 cases could happen:
    //      1. oldPosition created by limitOrder, new marketOrder reversed it => ON = positionResp.exchangedQuoteAssetAmount
    //      2. oldPosition created by marketOrder, new marketOrder reversed it => ON = oldPosition.openNotional - positionResp.exchangedQuoteAssetAmount
    //      3. oldPosition created by both marketOrder and limitOrder, new marketOrder reversed it => ON = oldPosition.openNotional (of _positionDataWithoutLimit only) - positionResp.exchangedQuoteAssetAmount
    //      4. oldPosition increased by limitOrder and reversed by marketOrder, new MarketOrder reversed it => ON = oldPosition.openNotional (of _positionDataWithoutLimit only) + positionResp.exchangedQuoteAssetAmount
    function handleNotionalInOpenReverse(
        uint256 _exchangedQuoteAmount,
        Position.Data memory _positionData,
        Position.Data memory _positionDataWithoutLimit
    ) public view returns (uint256 openNotional) {
        if (_positionDataWithoutLimit.quantity * _positionData.quantity < 0) {
            openNotional =
                _positionDataWithoutLimit.openNotional +
                _exchangedQuoteAmount;
        } else {
            if (
                _positionDataWithoutLimit.openNotional > _exchangedQuoteAmount
            ) {
                openNotional =
                    _positionDataWithoutLimit.openNotional -
                    _exchangedQuoteAmount;
            } else {
                openNotional =
                    _exchangedQuoteAmount -
                    _positionDataWithoutLimit.openNotional;
            }
        }
    }

    // There are 5 cases could happen:
    //      1. Old position created by long limit and short market, reverse position is short => margin = oldMarketMargin + reduceMarginRequirement
    //      2. Old position created by long limit and long market, reverse position is short and < old long market => margin = oldMarketMargin - reduceMarginRequirement
    //      3. Old position created by long limit and long market, reverse position is short and > old long market => margin = reduceMarginRequirement - oldMarketMargin
    //      4. Old position created by long limit and no market, reverse position is short => margin = reduceMarginRequirement - oldMarketMargin
    //      5. Old position created by short limit and long market, reverse position is short => margin = oldMarketMargin - reduceMarginRequirement
    function handleMarginInOpenReverse(
        uint256 _reduceMarginRequirement,
        Position.Data memory _positionData,
        Position.Data memory _positionDataWithoutLimit,
        int256 _latestCumulativePremiumFraction
    ) public view returns (uint256 margin) {
        (, ,int256 fundingPayment) = calcRemainMarginWithFundingPayment(
            _positionData,
            margin,
            _latestCumulativePremiumFraction
        );
        int256 newPositionSide = _positionData.quantity < 0
            ? int256(1)
            : int256(-1);
        if (_positionDataWithoutLimit.quantity * _positionData.quantity < 0) {
            margin =
                (int256(_positionDataWithoutLimit.margin +
                _reduceMarginRequirement) - fundingPayment).abs();
        } else {
            if (_positionDataWithoutLimit.margin > _reduceMarginRequirement) {
                margin =
                    (int256(_positionDataWithoutLimit.margin -
                    _reduceMarginRequirement) + fundingPayment).abs();
            } else {
                margin =
                    (int256(_reduceMarginRequirement -
                    _positionDataWithoutLimit.margin) - fundingPayment).abs();
            }
        }
    }

    // There are 5 cases could happen:
    //      1. Old position created by long limit and long market, increase position is long => notional = oldNotional + exchangedQuoteAssetAmount
    //      2. Old position created by long limit and short market, increase position is long and < old short market => notional = oldNotional - exchangedQuoteAssetAmount
    //      3. Old position created by long limit and short market, increase position is long and > old short market => notional = exchangedQuoteAssetAmount - oldNotional
    //      4. Old position created by long limit and no market, increase position is long => notional = oldNotional + exchangedQuoteAssetAmount
    //      5. Old position created by short limit and long market, increase position is long => notional = oldNotional + exchangedQuoteAssetAmount
    function handleNotionalInIncrease(
        uint256 _exchangedQuoteAmount,
        Position.Data memory _positionData,
        Position.Data memory _positionDataWithoutLimit
    ) public view returns (uint256 openNotional) {
        if (_positionDataWithoutLimit.quantity * _positionData.quantity < 0) {
            if (
                _positionDataWithoutLimit.openNotional > _exchangedQuoteAmount
            ) {
                openNotional =
                    _positionDataWithoutLimit.openNotional -
                    _exchangedQuoteAmount;
            } else {
                openNotional =
                    _exchangedQuoteAmount -
                    _positionDataWithoutLimit.openNotional;
            }
        } else {
            openNotional =
                _positionDataWithoutLimit.openNotional +
                _exchangedQuoteAmount;
        }
    }

    // There are 6 cases could happen:
    //      1. Old position created by long limit and long market, increase position is long market => margin = oldMarketMargin + increaseMarginRequirement
    //      2. Old position created by long limit and short market, increase position is long market and < old short market => margin = oldMarketMargin - increaseMarginRequirement
    //      3. Old position created by long limit and short market, increase position is long market and > old short market => margin = increaseMarginRequirement - oldMarketMargin
    //      4. Old position created by long limit and no market, increase position is long market => margin = increaseMarginRequirement - oldMarketMargin
    //      5. Old position created by short limit and long market, increase position is long market => margin = oldMarketMargin + increaseMarginRequirement
    //      6. Old position created by no limit and long market, increase position is long market => margin = oldMarketMargin + increaseMarginRequirement
    function handleMarginInIncrease(
        uint256 _increaseMarginRequirement,
        Position.Data memory _positionData,
        Position.Data memory _positionDataWithoutLimit,
        int256  _latestCumulativePremiumFraction
    ) public view returns (uint256 margin) {
        (, ,int256 fundingPayment) = calcRemainMarginWithFundingPayment(
            _positionData,
            margin,
            _latestCumulativePremiumFraction
        );
        if (_positionDataWithoutLimit.quantity * _positionData.quantity < 0) {
            if (_positionDataWithoutLimit.margin > _increaseMarginRequirement) {
                margin =
                    (int256(_positionDataWithoutLimit.margin -
                    _increaseMarginRequirement) + fundingPayment).abs();
            } else {
                margin =
                    (int256(_increaseMarginRequirement -
                    _positionDataWithoutLimit.margin) - fundingPayment).abs();
            }
        } else {
            margin =
                (int256(_positionDataWithoutLimit.margin +
                _increaseMarginRequirement) + fundingPayment).abs();
        }
    }

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
//        PositionLimitOrder.Data[]
//            memory subReduceLimitOrders = new PositionLimitOrder.Data[](
//                _reduceLimitOrders.length
//            );
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
//        if (_reduceLimitOrders.length > 0) {
//            uint256 index = 0;
//            for (uint256 i = 0; i < _reduceLimitOrders.length; i++) {
//                (bool isFilled, , , ) = _positionManager.getPendingOrderDetail(
//                    _reduceLimitOrders[i].pip,
//                    _reduceLimitOrders[i].orderId
//                );
//                if (isFilled != true) {
//                    subReduceLimitOrders[index] = _reduceLimitOrders[i];
//                    _positionManager.updatePartialFilledOrder(
//                        _reduceLimitOrders[i].pip,
//                        _reduceLimitOrders[i].orderId
//                    );
//                    index++;
//                }
//            }
//        }
//        return (subLimitOrders, subReduceLimitOrders);
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
        PositionLimitOrder.Data[] memory _limitOrder
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
        return totalMargin;
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

    // used to benefit memory pointer
    // used only in `checkPendingOrderSideAndQuantity` memory
    // please don't move me to other places
    struct CheckSideAndQuantityParam{
        PositionLimitOrder.Data[] limitOrders;
        PositionLimitOrder.Data[] reduceLimitOrders;
        Position.Side side;
        uint256 orderQuantity;
        int256 positionQuantity;
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

    function getPositionNotionalAndUnrealizedPnl(
        address _pmAddress,
        address _trader,
        PositionHouseStorage.PnlCalcOption _pnlCalcOption,
        Position.Data memory _position
    ) public view returns (uint256 positionNotional, int256 unrealizedPnl) {
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

    // used to benefit memory pointer
    // used only in `getClaimAmount` memory
    // please don't move me to other places
    struct ClaimAbleState {
        int256 amount;
        uint64 baseBasicPoint;
        uint64 basisPoint;
        uint256 totalReduceOrderFilledAmount;
        uint256 accMargin;
    }
    function getClaimAmount(
        address _pmAddress,
        int256 _manualMargin,
        Position.LiquidatedData memory _positionLiquidatedData,
        Position.Data memory _positionDataWithoutLimit,
        PositionLimitOrder.Data[] memory _limitOrders,
        PositionLimitOrder.Data[] memory _reduceLimitOrders,
        int128 _positionLatestCumulativePremiumFraction,
        int128 _latestCumulativePremiumFraction
    ) external view returns (int256 totalClaimableAmount) {
        ClaimAbleState memory state;
        IPositionManager _positionManager = IPositionManager(_pmAddress);
        // avoid multiple calls
        ( state.baseBasicPoint, state.basisPoint) = _positionManager.getBasisPointFactors();
        // position data with increase only
        Position.Data memory _pDataIncr = _positionDataWithoutLimit;
        for (uint256 i; i < _limitOrders.length; i++) {
            if (
                _limitOrders[i].pip == 0 && _limitOrders[i].orderId == 0
            ) {
                // skip
                continue;
            }
            // TODO getPendingOrderDetail here instead
            _pDataIncr = accumulateLimitOrderToPositionData(
                _pmAddress,
                _limitOrders[i],
                _pDataIncr,
                _limitOrders[i].entryPrice
            );
        }
        state.accMargin = _pDataIncr.margin;
        if(_pDataIncr.quantity == 0){
            return 0;
        }
        // copy openNotional and quantity
        Position.Data memory _cpIncrPosition;
        _cpIncrPosition.openNotional = _pDataIncr.openNotional;
        _cpIncrPosition.quantity = _pDataIncr.quantity;
        for (uint256 j; j < _reduceLimitOrders.length; j++) {
            // check is the reduce limit orders are filled
            if (_reduceLimitOrders[j].pip != 0) {
                int256 _filledAmount = _getPartialFilledAmount(_positionManager, _reduceLimitOrders[j].pip, _reduceLimitOrders[j].orderId);
                _accumulatePnLInReduceLimitOrder(state, _cpIncrPosition, _reduceLimitOrders[j].pip, _filledAmount, _reduceLimitOrders[j].entryPrice, _reduceLimitOrders[j].leverage);
            }
        }
        if (_pDataIncr.lastUpdatedCumulativePremiumFraction == 0) {
            _pDataIncr.lastUpdatedCumulativePremiumFraction = _positionLatestCumulativePremiumFraction;
        }
        (,, int256 fundingPayment) = calcRemainMarginWithFundingPayment(_pDataIncr, state.accMargin, _latestCumulativePremiumFraction);
        state.amount +=
            int256(state.accMargin) +
            fundingPayment +
            _manualMargin -
            int256(_positionLiquidatedData.margin);
        return state.amount < 0 ? int256(0) : state.amount;
    }

    function _getPartialFilledAmount(
        IPositionManager _positionManager,
        uint128 _pip,
        uint64 _orderId
    ) internal view returns (int256 _filledAmount) {
        (bool isFilled, bool isBuy, uint256 size, uint256 partialFilled) = _positionManager.getPendingOrderDetail(
            _pip,
            _orderId
        );
        _filledAmount = int256(!isFilled && partialFilled < size ? partialFilled : size);
        _filledAmount = isBuy ? _filledAmount : (-_filledAmount);
    }

    function _accumulatePnLInReduceLimitOrder(
        ClaimAbleState memory state,
        Position.Data memory _cpIncrPosition,
        uint128 _pip,
        int256 _filledAmount,
        uint256 _entryPrice,
        uint16 _leverage
    ) internal view {
        // closedNotional can be negative to calculate pnl in both Long/Short formula
        uint256 closedNotional = PositionMath.calculateNotional(_pip.toNotional(state.baseBasicPoint, state.basisPoint), _filledAmount.abs(), state.baseBasicPoint);
        // already checked if _positionData.openNotional == 0, then used _positionDataWithoutLimit before
        uint256 openNotional = PositionMath.calculateNotional(_entryPrice, _filledAmount.abs(), state.baseBasicPoint);
        state.amount += PositionMath.calculatePnl(_cpIncrPosition.quantity, openNotional, closedNotional);
        state.totalReduceOrderFilledAmount += _filledAmount.abs();

        // now position should be reduced
        // should never overflow?
        _cpIncrPosition.quantity = _cpIncrPosition.quantity.subAmount(_filledAmount.abs());
        // avoid overflow due to absolute error
        if (openNotional >= _cpIncrPosition.openNotional) {
            _cpIncrPosition.openNotional = 0;
        } else {
            _cpIncrPosition.openNotional -= openNotional;
        }
    }

    function openMarketOrder(
        address _pmAddress,
        uint256 _quantity,
        Position.Side _side
    ) public returns (int256 exchangedQuantity, uint256 openNotional, uint256 entryPrice, uint256 fee) {
        IPositionManager _positionManager = IPositionManager(_pmAddress);

        uint256 exchangedSize;
        (exchangedSize, openNotional, entryPrice, fee) = _positionManager.openMarketPosition(
            _quantity,
            _side == Position.Side.LONG
        );
        require(exchangedSize == _quantity, Errors.VL_NOT_ENOUGH_LIQUIDITY);
        exchangedQuantity = _side == Position.Side.LONG
            ? int256(exchangedSize)
            : -int256(exchangedSize);
    }

    function increasePosition(
        address _pmAddress,
        Position.Side _side,
        int256 _quantity,
        uint16 _leverage,
        address _trader,
        Position.Data memory _positionData,
        Position.Data memory _positionDataWithoutLimit,
        int128 _latestCumulativePremiumFraction
    ) external returns (PositionHouseStorage.PositionResp memory positionResp) {
        (
            positionResp.exchangedPositionSize,
            positionResp.exchangedQuoteAssetAmount,
            positionResp.entryPrice,
            positionResp.fee
        ) = openMarketOrder(_pmAddress, _quantity.abs(), _side);
        if (positionResp.exchangedPositionSize != 0) {
            int256 _newSize = _positionDataWithoutLimit.quantity +
                positionResp.exchangedPositionSize;
            uint256 increaseMarginRequirement = positionResp
                .exchangedQuoteAssetAmount / _leverage;
            // TODO update function latestCumulativePremiumFraction

            (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(
                _pmAddress,
                _trader,
                PositionHouseStorage.PnlCalcOption.SPOT_PRICE,
                _positionData
            );

            positionResp.unrealizedPnl = unrealizedPnl;
            positionResp.realizedPnl = 0;
            // checked margin to vault
            positionResp.marginToVault = int256(increaseMarginRequirement);
            positionResp.position = Position.Data(
                _newSize,
                handleMarginInIncrease(
                    increaseMarginRequirement,
                    _positionData,
                    _positionDataWithoutLimit,
                    _latestCumulativePremiumFraction
                ),
                handleNotionalInIncrease(
                    positionResp.exchangedQuoteAssetAmount,
                    _positionData,
                    _positionDataWithoutLimit
                ),
                _latestCumulativePremiumFraction,
                blockNumber(),
                _leverage,
                1
            );
        }
    }

    function openReversePosition(
        address _pmAddress,
        Position.Side _side,
        int256 _quantity,
        uint16 _leverage,
        address _trader,
        Position.Data memory _positionData,
        Position.Data memory _positionDataWithoutLimit,
        int128 _latestCumulativePremiumFraction,
        int256 _manualMargin
    ) external returns (PositionHouseStorage.PositionResp memory positionResp) {
        IPositionManager _positionManager = IPositionManager(_pmAddress);
        (
            positionResp.exchangedPositionSize, positionResp.exchangedQuoteAssetAmount, positionResp.entryPrice,
        ) = openMarketOrder(
            _pmAddress,
            _quantity.abs(),
            _side
        );
        {
            uint256 reduceMarginRequirement = (_positionData.margin *
            _quantity.abs()) / _positionData.quantity.abs();
            positionResp.realizedPnl = calculatePnlWhenClose(_positionData.quantity, positionResp.exchangedPositionSize, _positionData.openNotional, positionResp.exchangedQuoteAssetAmount);
            uint256 _baseBasisPoint = _positionManager.getBaseBasisPoint();
            uint256 _entryPrice = PositionMath.calculateEntryPrice(_positionData.openNotional, _positionData.quantity.abs(), _baseBasisPoint);
            positionResp.exchangedQuoteAssetAmount = PositionMath.calculateNotional(_entryPrice, _quantity.abs(), _baseBasisPoint);
            // NOTICE margin to vault can be negative
            positionResp.marginToVault = -(int256(reduceMarginRequirement) +
                positionResp.realizedPnl);
        }
        uint256 reduceMarginWithoutManual = ((_positionData.margin - _manualMargin.abs()) * _quantity.abs()) / _positionData.quantity.abs();
        {
            _positionData.margin = _positionData.margin - _manualMargin.abs();
            positionResp.position = Position.Data(
                _positionDataWithoutLimit.quantity + _quantity,
                handleMarginInOpenReverse(
                    reduceMarginWithoutManual,
                    _positionData,
                    _positionDataWithoutLimit,
                    _latestCumulativePremiumFraction
                ),
                handleNotionalInOpenReverse(
                    positionResp.exchangedQuoteAssetAmount,
                    _positionData,
                    _positionDataWithoutLimit
                ),
                _latestCumulativePremiumFraction,
                blockNumber(),
                _leverage,
                1
            );
        }
        return positionResp;
    }

    function calcReturnWhenOpenReverse(
        uint256 _sizeOut,
        uint256 _openNotional,
        Position.Data memory _oldPosition
    ) external view returns (int256 totalReturn) {
        int256 realizedPnl = calculatePnlWhenClose(_oldPosition.quantity, int256(_sizeOut), _oldPosition.openNotional, _openNotional);
        uint256 reduceMarginRequirement = (_oldPosition.margin * _sizeOut) / _oldPosition.quantity.abs();
        totalReturn = int256(reduceMarginRequirement) + realizedPnl;
    }

    function calcRemainMarginWithFundingPayment(
        // only use position data without manual margin
        Position.Data memory _oldPosition,
        uint256 _pMargin,
        int256 _latestCumulativePremiumFraction
    )
        public
        view
        returns (
            uint256 remainMargin,
            uint256 badDebt,
            int256 fundingPayment
        )
    {
        // calculate fundingPayment
        if (_oldPosition.quantity != 0) {
            int256 deltaPremiumFraction = _latestCumulativePremiumFraction - _oldPosition.lastUpdatedCumulativePremiumFraction;
            if (deltaPremiumFraction != 0) {
                if (_oldPosition.quantity > 0) {
                    fundingPayment = PositionMath.calculateFundingPayment(deltaPremiumFraction, -int256(_oldPosition.margin), PREMIUM_FRACTION_DENOMINATOR);
                } else {
                    fundingPayment = PositionMath.calculateFundingPayment(deltaPremiumFraction, int256(_oldPosition.margin), PREMIUM_FRACTION_DENOMINATOR);
                }
            }
        }

        // calculate remain margin, if remain margin is negative, set to zero and leave the rest to bad debt
        if (int256(_pMargin) + fundingPayment >= 0) {
            remainMargin = uint256(int256(_pMargin) + fundingPayment);
        } else {
            badDebt = uint256(-fundingPayment - int256(_pMargin));
        }
    }

    function blockNumber() internal view returns (uint64) {
        return uint64(block.number);
    }

    function _getLimitOrderQuantity(
        IPositionManager _positionManager,
        PositionLimitOrder.Data memory _limitOrder
    ) private view returns (int256 _orderQuantity) {
        (
            bool isFilled,
            bool isBuy,
            uint256 quantity,
            uint256 partialFilled
        ) = _positionManager.getPendingOrderDetail(
            _limitOrder.pip,
            _limitOrder.orderId
        );

        // if order is fulfilled
        if (isFilled) {
            _orderQuantity = isBuy ? int256(quantity) : -int256(quantity) ;
        } else if (!isFilled && partialFilled != 0) {
            // partial filled
            _orderQuantity = isBuy ? int256(partialFilled) : -int256(partialFilled);
        }
    }

    function getPartialLiquidateQuantity(
        int256 _quantity,
        uint256 _liquidationPenaltyRatio,
        uint256 _contractPrice
    ) external pure returns (int256) {
        return PositionMath.calculatePartialLiquidateQuantity(_quantity, _liquidationPenaltyRatio, _contractPrice);
    }

    function calculatePnlWhenClose(
        int256 _positionQuantity,
        int256 _closeQuantity,
        uint256 _positionNotional,
        uint256 _closeNotional
    ) public pure returns (int256 pnl) {
        uint256 percentageNotional = _positionNotional * _closeQuantity.abs() / _positionQuantity.abs();
        pnl = PositionMath.calculatePnl(_positionQuantity, percentageNotional, _closeNotional);
    }

    function calculatePartialLiquidateMargin(
        uint256 _oldMargin,
        uint256 _manualMargin,
        uint256 _liquidationFeeRatio
    ) external pure returns (uint256 liquidatedPositionMargin, uint256 liquidatedManualMargin) {
        liquidatedPositionMargin = (_oldMargin * _liquidationFeeRatio) /
        100;
        liquidatedManualMargin = (_manualMargin * _liquidationFeeRatio) /
        100;
    }
}
