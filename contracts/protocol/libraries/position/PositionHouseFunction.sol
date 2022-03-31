// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;

import "./Position.sol";
import "../../../interfaces/IPositionManager.sol";
import "./PositionLimitOrder.sol";
import "../../libraries/helpers/Quantity.sol";
import "../../libraries/helpers/Int256Math.sol";
import "../../PositionHouse.sol";
import "../types/PositionHouseStorage.sol";
import {Errors} from "../helpers/Errors.sol";

library PositionHouseFunction {
    int256 private constant PREMIUM_FRACTION_DENOMINATOR = 10 ** 10;
    using PositionLimitOrder for mapping(address => mapping(address => PositionLimitOrder.Data[]));
    using Position for Position.Data;
    using Position for Position.LiquidatedData;
    using Quantity for int256;
    using Quantity for int128;
    using Int256Math for int256;

    function handleMarketPart(
        Position.Data memory _positionData,
        Position.Data memory _positionDataWithoutLimit,
        uint256 _newNotional,
        int256 _newQuantity,
        uint16 _leverage,
        int128 _latestCumulativePremiumFraction
    ) public view returns (Position.Data memory newData) {
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
                    _newNotional,
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
        int256 newPositionSide = _positionData.quantity < 0
            ? int256(1)
            : int256(-1);
        if (_positionDataWithoutLimit.quantity * _positionData.quantity < 0) {
            margin =
                _positionDataWithoutLimit.margin +
                _reduceMarginRequirement;
        } else {
            if (_positionDataWithoutLimit.margin > _reduceMarginRequirement) {
                margin =
                    _positionDataWithoutLimit.margin -
                    _reduceMarginRequirement;
            } else {
                margin =
                    _reduceMarginRequirement -
                    _positionDataWithoutLimit.margin;
            }
        }
        (margin, ,) = calcRemainMarginWithFundingPayment(
            _positionData,
            margin,
            _latestCumulativePremiumFraction
        );
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
        if (_positionDataWithoutLimit.quantity * _positionData.quantity < 0) {
            if (_positionDataWithoutLimit.margin > _increaseMarginRequirement) {
                margin =
                    _positionDataWithoutLimit.margin -
                    _increaseMarginRequirement;
            } else {
                margin =
                    _increaseMarginRequirement -
                    _positionDataWithoutLimit.margin;
            }
        } else {
            margin =
                _positionDataWithoutLimit.margin +
                _increaseMarginRequirement;
        }
        (margin, ,) = calcRemainMarginWithFundingPayment(
            _positionData,
            margin,
            _latestCumulativePremiumFraction
        );
    }

    function handleQuantity(int256 _oldMarketQuantity, int256 _newQuantity)
        public
        view
        returns (int256 quantity)
    {
        if (_oldMarketQuantity * _newQuantity >= 0) {
            return _oldMarketQuantity + _newQuantity;
        }
        return _oldMarketQuantity - _newQuantity;
    }

    function clearAllFilledOrder(
        IPositionManager _positionManager,
        PositionLimitOrder.Data[] memory _limitOrders,
        PositionLimitOrder.Data[] memory _reduceLimitOrders
    )
        internal
        returns (
            PositionLimitOrder.Data[] memory,
            PositionLimitOrder.Data[] memory
        )
    {
        PositionLimitOrder.Data[]
            memory subLimitOrders = new PositionLimitOrder.Data[](
                _limitOrders.length
            );
        PositionLimitOrder.Data[]
            memory subReduceLimitOrders = new PositionLimitOrder.Data[](
                _reduceLimitOrders.length
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
        if (_reduceLimitOrders.length > 0) {
            uint256 index = 0;
            for (uint256 i = 0; i < _reduceLimitOrders.length; i++) {
                (bool isFilled, , , ) = _positionManager.getPendingOrderDetail(
                    _reduceLimitOrders[i].pip,
                    _reduceLimitOrders[i].orderId
                );
                if (isFilled != true) {
                    subReduceLimitOrders[index] = _reduceLimitOrders[i];
                    _positionManager.updatePartialFilledOrder(
                        _reduceLimitOrders[i].pip,
                        _reduceLimitOrders[i].orderId
                    );
                    index++;
                }
            }
        }
        return (subLimitOrders, subReduceLimitOrders);
    }

    function calculateLimitOrder(
        address _positionManager,
        PositionLimitOrder.Data[] memory _limitOrders,
        PositionLimitOrder.Data[] memory _reduceLimitOrders,
        Position.Data memory _positionData
    ) public view returns (Position.Data memory positionData) {
        for (uint256 i = 0; i < _limitOrders.length; i++) {
            if (_limitOrders[i].pip != 0) {
                _positionData = accumulateLimitOrderToPositionData(
                    _positionManager,
                    _limitOrders[i],
                    _positionData,
                    _limitOrders[i].entryPrice,
                    _limitOrders[i].reduceQuantity
                );
            }
        }
        for (uint256 i = 0; i < _reduceLimitOrders.length; i++) {
            if (_reduceLimitOrders[i].pip != 0) {
                _positionData = accumulateLimitOrderToPositionData(
                    _positionManager,
                    _reduceLimitOrders[i],
                    _positionData,
                    _reduceLimitOrders[i].entryPrice,
                    _reduceLimitOrders[i].reduceQuantity
                );
            }
        }
        positionData = _positionData;
    }

    function accumulateLimitOrderToPositionData(
        address _pmAddress,
        PositionLimitOrder.Data memory _limitOrder,
        Position.Data memory _positionData,
        uint256 _entryPrice,
        uint256 _reduceQuantity
    ) public view returns (Position.Data memory) {
        IPositionManager _positionManager = IPositionManager(_pmAddress);

        (
            bool isFilled,
            bool isBuy,
            uint256 quantity,
            uint256 partialFilled
        ) = _positionManager.getPendingOrderDetail(
                _limitOrder.pip,
                _limitOrder.orderId
            );
        if (isFilled) {
            int256 _orderQuantity;
            if (_reduceQuantity == 0 && _entryPrice == 0) {
                _orderQuantity = isBuy ? int256(quantity) : -int256(quantity);
            } else if (_reduceQuantity != 0 && _entryPrice == 0) {
                _orderQuantity = isBuy
                    ? int256(quantity - _reduceQuantity)
                    : -int256(quantity - _reduceQuantity);
            } else {
                _orderQuantity = isBuy
                    ? int256(_reduceQuantity)
                    : -int256(_reduceQuantity);
            }
            uint256 _orderNotional = _entryPrice == 0
                ? ((_orderQuantity.abs() *
                    _positionManager.pipToPrice(_limitOrder.pip)) /
                    _positionManager.getBaseBasisPoint())
                : ((_orderQuantity.abs() * _entryPrice) /
                    _positionManager.getBaseBasisPoint());
            // IMPORTANT UPDATE FORMULA WITH LEVERAGE
            // TODO RECHECK THIS
            uint256 _orderMargin = _orderNotional / _limitOrder.leverage;
            _positionData = _positionData.accumulateLimitOrder(
                _orderQuantity,
                _orderMargin,
                _orderNotional
            );
        } else if (!isFilled && partialFilled != 0) {
            // partial filled
            int256 _partialQuantity;
            if (_reduceQuantity == 0 && _entryPrice == 0) {
                _partialQuantity = isBuy
                    ? int256(partialFilled)
                    : -int256(partialFilled);
            } else if (_reduceQuantity != 0 && _entryPrice == 0) {
                int256 _partialQuantityTemp = partialFilled > _reduceQuantity
                    ? int256(partialFilled - _reduceQuantity)
                    : int256(0);
                _partialQuantity = isBuy
                    ? _partialQuantityTemp
                    : -_partialQuantityTemp;
            } else {
                int256 _partialQuantityTemp = partialFilled > _reduceQuantity
                    ? int256(_reduceQuantity)
                    : int256(partialFilled);
                _partialQuantity = isBuy
                    ? _partialQuantityTemp
                    : -_partialQuantityTemp;
            }
            uint256 _partialOpenNotional = _entryPrice == 0
                ? ((_partialQuantity.abs() *
                    _positionManager.pipToPrice(_limitOrder.pip)) /
                    _positionManager.getBaseBasisPoint())
                : ((_partialQuantity.abs() * _entryPrice) /
                    _positionManager.getBaseBasisPoint());
            // IMPORTANT UPDATE FORMULA WITH LEVERAGE
            // TODO RECHECK THIS
            uint256 _partialMargin = _partialOpenNotional /
                _limitOrder.leverage;
            _positionData = _positionData.accumulateLimitOrder(
                _partialQuantity,
                _partialMargin,
                _partialOpenNotional
            );
        }
        _positionData.leverage = _positionData.leverage >= _limitOrder.leverage
            ? _positionData.leverage
            : _limitOrder.leverage;
        return _positionData;
    }

    function getListOrderPending(
        address _pmAddress,
        address _trader,
        PositionLimitOrder.Data[] memory _limitOrders,
        PositionLimitOrder.Data[] memory _reduceLimitOrders
    ) public view returns (PositionHouseStorage.LimitOrderPending[] memory) {
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
                if (
                    !isFilled && _reduceLimitOrders[i].reduceLimitOrderId == 0
                ) {
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
    ) public view returns (uint256 positionNotional, int256 unrealizedPnl) {
        IPositionManager positionManager = IPositionManager(_pmAddress);

        uint256 oldPositionNotional = _position.openNotional;
        if (_pnlCalcOption == PositionHouseStorage.PnlCalcOption.SPOT_PRICE) {
            positionNotional =
                (positionManager.getPrice() * _position.quantity.abs()) /
                positionManager.getBaseBasisPoint();
        } else if (_pnlCalcOption == PositionHouseStorage.PnlCalcOption.TWAP) {
            // TODO recheck this interval time
            uint256 _intervalTime = 90;
            positionNotional = (positionManager.getTwapPrice(_intervalTime) * _position.quantity.abs()) / positionManager.getBaseBasisPoint();
        } else {
            positionNotional = (positionManager.getUnderlyingPrice() * _position.quantity.abs()) / positionManager.getBaseBasisPoint();
        }

        if (_position.side() == Position.Side.LONG) {
            unrealizedPnl =
                int256(positionNotional) -
                int256(oldPositionNotional);
        } else {
            unrealizedPnl =
                int256(oldPositionNotional) -
                int256(positionNotional);
        }
    }

    function calcMaintenanceDetail(
        Position.Data memory _positionData,
        uint256 _maintenanceMarginRatio,
        int256 _unrealizedPnl
    )
        public
        view
        returns (
            uint256 maintenanceMargin,
            int256 marginBalance,
            uint256 marginRatio
        )
    {
        maintenanceMargin =
            (_positionData.margin * _maintenanceMarginRatio) /
            100;
        marginBalance = int256(_positionData.margin) + _unrealizedPnl;
        if (marginBalance <= 0) {
            marginRatio = 100;
        } else {
            marginRatio = (maintenanceMargin * 100) / uint256(marginBalance);
        }
    }

    function getClaimAmount(
        address _pmAddress,
        address _trader,
        Position.Data memory _positionData,
        Position.Data memory _positionDataWithoutLimit,
        PositionLimitOrder.Data[] memory _limitOrders,
        PositionLimitOrder.Data[] memory _reduceLimitOrders,
        uint256 _canClaimAmountInMap,
        int256 _manualMarginInMap
    ) public view returns (int256 totalClaimableAmount) {
        IPositionManager _positionManager = IPositionManager(_pmAddress);
        uint256 indexReduce;
        uint256 indexLimit;

        for (indexLimit; indexLimit < _limitOrders.length; indexLimit++) {
            {
                if (
                    _limitOrders[indexLimit].pip == 0 &&
                    _limitOrders[indexLimit].orderId == 0
                ) continue;
                if (
                    _limitOrders[indexLimit].reduceQuantity != 0 ||
                    indexLimit == _limitOrders.length - 1
                ) {
                    {
                        (
                            indexReduce,
                            totalClaimableAmount,
                            _positionData
                        ) = calculatePnlFromReduceOrder(
                            _positionManager,
                            indexReduce,
                            totalClaimableAmount,
                            _positionData,
                            _positionDataWithoutLimit,
                            _reduceLimitOrders
                        );
                    }
                    _positionData = accumulateLimitOrderToPositionData(
                        _pmAddress,
                        _limitOrders[indexLimit],
                        _positionData,
                        _limitOrders[indexLimit].entryPrice,
                        _limitOrders[indexLimit].reduceQuantity
                    );
                } else {
                    _positionData = accumulateLimitOrderToPositionData(
                        _pmAddress,
                        _limitOrders[indexLimit],
                        _positionData,
                        _limitOrders[indexLimit].entryPrice,
                        _limitOrders[indexLimit].reduceQuantity
                    );
                }
            }

            (
                bool isFilled,
                ,
                uint256 quantity,
                uint256 partialFilled
            ) = _positionManager.getPendingOrderDetail(
                    _limitOrders[indexLimit].pip,
                    _limitOrders[indexLimit].orderId
                );
            if (!isFilled) {
                totalClaimableAmount -= int256(
                    ((quantity - partialFilled) *
                        _positionManager.pipToPrice(
                            _limitOrders[indexLimit].pip
                        )) /
                        _positionManager.getBaseBasisPoint() /
                        _limitOrders[indexLimit].leverage
                );
            }
        }

        totalClaimableAmount =
            totalClaimableAmount +
            int256(_canClaimAmountInMap) +
            _manualMarginInMap +
            int256(_positionDataWithoutLimit.margin);
        if (totalClaimableAmount <= 0) {
            totalClaimableAmount = 0;
        }
    }

    function calculatePnlFromReduceOrder(
        IPositionManager _positionManager,
        uint256 _indexReduce,
        int256 _totalClaimableAmount,
        Position.Data memory _positionData,
        Position.Data memory _positionDataWithoutLimit,
        PositionLimitOrder.Data[] memory _reduceLimitOrders
    )
        public
        view
        returns (
            uint256 indexReduce,
            int256 totalClaimableAmount,
            Position.Data memory positionData
        )
    {
        for (
            _indexReduce;
            _indexReduce < _reduceLimitOrders.length;
            _indexReduce++
        ) {
            (bool isFilled, , , uint256 partialFilled) = _positionManager
                .getPendingOrderDetail(
                    _reduceLimitOrders[_indexReduce].pip,
                    _reduceLimitOrders[_indexReduce].orderId
                );
            {
                int256 realizedPnl = int256(
                    ((
                        (partialFilled <
                            _reduceLimitOrders[_indexReduce].reduceQuantity &&
                            !isFilled)
                            ? partialFilled
                            : _reduceLimitOrders[_indexReduce].reduceQuantity
                    ) *
                        _positionManager.pipToPrice(
                            _reduceLimitOrders[_indexReduce].pip
                        )) / _positionManager.getBaseBasisPoint()
                ) -
                    int256(
                        ((
                            _positionData.openNotional != 0
                                ? _positionData.openNotional
                                : _positionDataWithoutLimit.openNotional
                        ) *
                            (
                                (partialFilled <
                                    _reduceLimitOrders[_indexReduce]
                                        .reduceQuantity &&
                                    !isFilled)
                                    ? partialFilled
                                    : _reduceLimitOrders[_indexReduce]
                                        .reduceQuantity
                            )) /
                            (
                                _positionData.quantity.abs() != 0
                                    ? _positionData.quantity.abs()
                                    : _positionDataWithoutLimit.quantity.abs()
                            )
                    );
                _totalClaimableAmount += _reduceLimitOrders[_indexReduce]
                    .isBuy == 2
                    ? realizedPnl
                    : (-realizedPnl);
            }
            {
                positionData = accumulateLimitOrderToPositionData(
                    address(_positionManager),
                    _reduceLimitOrders[_indexReduce],
                    _positionData,
                    _reduceLimitOrders[_indexReduce].entryPrice,
                    _reduceLimitOrders[_indexReduce].reduceQuantity
                );
            }
            if (_reduceLimitOrders[_indexReduce].reduceLimitOrderId != 0) {
                _indexReduce++;
                break;
            }
        }
        indexReduce = _indexReduce;
        totalClaimableAmount = _totalClaimableAmount;
    }

    function openMarketOrder(
        address _pmAddress,
        uint256 _quantity,
        Position.Side _side
    ) internal returns (int256 exchangedQuantity, uint256 openNotional, uint256 entryPrice, uint256 fee) {
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
    ) public returns (PositionHouseStorage.PositionResp memory positionResp) {
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
        int128 _latestCumulativePremiumFraction
    ) public returns (PositionHouseStorage.PositionResp memory positionResp) {
        IPositionManager _positionManager = IPositionManager(_pmAddress);
        uint256 reduceMarginRequirement = (_positionData.margin *
            _quantity.abs()) / _positionData.quantity.abs();
        int256 totalQuantity = _positionDataWithoutLimit.quantity + _quantity;
        (positionResp.exchangedPositionSize,_,positionResp.entryPrice,positionResp.fee ) = openMarketOrder(
            _pmAddress,
            _quantity.abs(),
            _side
        );
        (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(
            _pmAddress,
            _trader,
            PositionHouseStorage.PnlCalcOption.SPOT_PRICE,
            _positionData
        );

        positionResp.realizedPnl =
            (unrealizedPnl * int256(positionResp.exchangedPositionSize)) /
            _positionData.quantity.absInt();
        positionResp.exchangedQuoteAssetAmount =
            (_quantity.abs() * _positionData.getEntryPrice(_pmAddress)) /
            _positionManager.getBaseBasisPoint();
        // NOTICE margin to vault can be negative
        positionResp.marginToVault = -(int256(reduceMarginRequirement) +
            positionResp.realizedPnl);
        // NOTICE calc unrealizedPnl after open reverse
        positionResp.unrealizedPnl = unrealizedPnl - positionResp.realizedPnl;
        {
            positionResp.position = Position.Data(
                totalQuantity,
                handleMarginInOpenReverse(
                    reduceMarginRequirement,
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

    function calcRemainMarginWithFundingPayment(
        Position.Data memory _oldPosition,
        uint256 _pMargin,
        int256 _latestCumulativePremiumFraction
    )
        internal
        view
        returns (
            uint256 remainMargin,
            uint256 badDebt,
            int256 fundingPayment
        )
    {
        // calculate fundingPayment
        if (_oldPosition.quantity != 0) {
            fundingPayment =
                (_latestCumulativePremiumFraction -
                    _oldPosition.lastUpdatedCumulativePremiumFraction) *
                _oldPosition.quantity / (PREMIUM_FRACTION_DENOMINATOR);
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
}
