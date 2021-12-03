pragma solidity ^0.8.0;

import "./Position.sol";
import "../../../interfaces/IPositionManager.sol";
import "./PositionLimitOrder.sol";
import "../../libraries/helpers/Quantity.sol";
import "../../PositionHouse.sol";


library PositionHouseFunction {
    using PositionLimitOrder for mapping(address => mapping(address => PositionLimitOrder.Data[]));
    using Position for Position.Data;
    using Position for Position.LiquidatedData;
    using Quantity for int256;
    using Quantity for int128;


    struct OpenLimitResp {
        uint64 orderId;
        uint256 sizeOut;
    }

    // There are 4 cases could happen:
    //      1. oldPosition created by limitOrder, new marketOrder reversed it => ON = positionResp.exchangedQuoteAssetAmount
    //      2. oldPosition created by marketOrder, new marketOrder reversed it => ON = oldPosition.openNotional - positionResp.exchangedQuoteAssetAmount
    //      3. oldPosition created by both marketOrder and limitOrder, new marketOrder reversed it => ON = oldPosition.openNotional (of marketPosition only) - positionResp.exchangedQuoteAssetAmount
    //      4. oldPosition increased by limitOrder and reversed by marketOrder, new MarketOrder reversed it => ON = oldPosition.openNotional (of marketPosition only) + positionResp.exchangedQuoteAssetAmount
    function handleNotionalInOpenReverse(
        uint256 exchangedQuoteAmount,
        Position.Data memory marketPositionData,
        Position.Data memory totalPositionData
    ) internal pure returns (uint256 openNotional) {
//        int256 newPositionSide = totalPositionData.quantity < 0 ? int256(1) : int256(- 1);
        if (marketPositionData.quantity * totalPositionData.quantity < 0) {
            openNotional = marketPositionData.openNotional + exchangedQuoteAmount;
        } else {
            if (marketPositionData.openNotional > exchangedQuoteAmount) {
                openNotional = marketPositionData.openNotional - exchangedQuoteAmount;
            } else {
                openNotional = exchangedQuoteAmount - marketPositionData.openNotional;
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
        uint256 reduceMarginRequirement,
        Position.Data memory marketPositionData,
        Position.Data memory totalPositionData
    ) internal pure returns (uint256 margin) {
//        int256 newPositionSide = totalPositionData.quantity < 0 ? int256(1) : int256(- 1);
        if (marketPositionData.quantity * totalPositionData.quantity < 0) {
            margin = marketPositionData.margin + reduceMarginRequirement;
        } else {
            if (marketPositionData.margin > reduceMarginRequirement) {
                margin = marketPositionData.margin - reduceMarginRequirement;
            } else {
                margin = reduceMarginRequirement - marketPositionData.margin;
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
        uint256 exchangedQuoteAmount,
        Position.Data memory marketPositionData,
        Position.Data memory totalPositionData
    ) internal pure returns (uint256 openNotional) {
        if (marketPositionData.quantity * totalPositionData.quantity < 0) {
            if (marketPositionData.openNotional > exchangedQuoteAmount) {
                openNotional = marketPositionData.openNotional - exchangedQuoteAmount;
            } else {
                openNotional = exchangedQuoteAmount - marketPositionData.openNotional;
            }
        } else {
            openNotional = marketPositionData.openNotional + exchangedQuoteAmount;
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
        uint256 increaseMarginRequirement,
        Position.Data memory marketPositionData,
        Position.Data memory totalPositionData
    ) internal pure returns (uint256 margin) {
        if (marketPositionData.quantity * totalPositionData.quantity < 0) {
            if (marketPositionData.margin > increaseMarginRequirement) {
                margin = marketPositionData.margin - increaseMarginRequirement;
            } else {
                margin = increaseMarginRequirement - marketPositionData.margin;
            }
        } else {
            margin = marketPositionData.margin + increaseMarginRequirement;
        }
    }

    function clearAllFilledOrder(
        IPositionManager _positionManager,
        address _trader,
        PositionLimitOrder.Data[] memory listLimitOrder,
        PositionLimitOrder.Data[] memory reduceLimitOrder
    ) internal returns (PositionLimitOrder.Data[] memory subListLimitOrder, PositionLimitOrder.Data[] memory subReduceLimitOrder) {
        if (listLimitOrder.length > 0) {
            uint256 index = 0;
            for (uint256 i = 0; i < listLimitOrder.length; i++) {
                (bool isFilled,,
                ,) = _positionManager.getPendingOrderDetail(listLimitOrder[i].pip, listLimitOrder[i].orderId);
                if (isFilled != true) {
                    subListLimitOrder[index] = listLimitOrder[i];
                    _positionManager.updatePartialFilledOrder(listLimitOrder[i].pip, listLimitOrder[i].orderId);
                    index++;
                }
            }
        }
        if (reduceLimitOrder.length > 0) {
            uint256 index = 0;
            for (uint256 i = 0; i < reduceLimitOrder.length; i++) {
                (bool isFilled,,
                ,) = _positionManager.getPendingOrderDetail(reduceLimitOrder[i].pip, reduceLimitOrder[i].orderId);
                if (isFilled != true) {
                    subReduceLimitOrder[index] = reduceLimitOrder[i];
                    _positionManager.updatePartialFilledOrder(reduceLimitOrder[i].pip, reduceLimitOrder[i].orderId);
                    index++;
                }
            }
        }
    }


    function accumulateLimitOrderToPositionData(
        address addressPositionManager,
        PositionLimitOrder.Data memory limitOrder,
        Position.Data memory positionData,
        uint256 entryPrice,
        uint256 reduceQuantity) internal view returns (Position.Data memory) {

        IPositionManager _positionManager = IPositionManager(addressPositionManager);

        (bool isFilled, bool isBuy,
        uint256 quantity, uint256 partialFilled) = _positionManager.getPendingOrderDetail(limitOrder.pip, limitOrder.orderId);

        if (isFilled) {
            int256 _orderQuantity;
            if (reduceQuantity == 0 && entryPrice == 0) {
                _orderQuantity = isBuy ? int256(quantity) : - int256(quantity);
            } else if (reduceQuantity != 0 && entryPrice == 0) {
                _orderQuantity = isBuy ? int256(quantity - reduceQuantity) : - int256(quantity - reduceQuantity);
            } else {
                _orderQuantity = isBuy ? int256(reduceQuantity) : - int256(reduceQuantity);
            }
            uint256 _orderNotional = entryPrice == 0 ? (_orderQuantity.abs() * _positionManager.pipToPrice(limitOrder.pip) / _positionManager.getBaseBasisPoint()) : (_orderQuantity.abs() * entryPrice / _positionManager.getBaseBasisPoint());
            // IMPORTANT UPDATE FORMULA WITH LEVERAGE
            uint256 _orderMargin = _orderNotional / limitOrder.leverage;
            positionData = positionData.accumulateLimitOrder(_orderQuantity, _orderMargin, _orderNotional);
        }
        else if (!isFilled && partialFilled != 0) {// partial filled
            int256 _partialQuantity;
            if (reduceQuantity == 0 && entryPrice == 0) {
                _partialQuantity = isBuy ? int256(partialFilled) : - int256(partialFilled);
            } else if (reduceQuantity != 0 && entryPrice == 0) {

                int256 _partialQuantityTemp = partialFilled > reduceQuantity ? int256(partialFilled - reduceQuantity) : 0;
                _partialQuantity = isBuy ? _partialQuantityTemp : - _partialQuantityTemp;
            } else {
                int256 _partialQuantityTemp = partialFilled > reduceQuantity ? int256(reduceQuantity) : int256(partialFilled);
                _partialQuantity = isBuy ? _partialQuantityTemp : - _partialQuantityTemp;
            }
            uint256 _partialOpenNotional = entryPrice == 0 ? (_partialQuantity.abs() * _positionManager.pipToPrice(limitOrder.pip) / _positionManager.getBaseBasisPoint()) : (_partialQuantity.abs() * entryPrice / _positionManager.getBaseBasisPoint());
            // IMPORTANT UPDATE FORMULA WITH LEVERAGE
            uint256 _partialMargin = _partialOpenNotional / limitOrder.leverage;
            positionData = positionData.accumulateLimitOrder(_partialQuantity, _partialMargin, _partialOpenNotional);
        }
        positionData.leverage = positionData.leverage >= limitOrder.leverage ? positionData.leverage : limitOrder.leverage;
        return positionData;
    }


    function getListOrderPending(
        address addressPositionManager,
        address _trader,
        PositionLimitOrder.Data[] memory listLimitOrder,
        PositionLimitOrder.Data[] memory reduceLimitOrder) public view returns (PositionHouse.LimitOrderPending[] memory){

        IPositionManager _positionManager = IPositionManager(addressPositionManager);
        //                PositionHouse.LimitOrderPending[] memory listPendingOrderData = new PositionHouse.LimitOrderPending[](listLimitOrder.length + reduceLimitOrder.length);
        if (listLimitOrder.length + reduceLimitOrder.length > 0) {
            PositionHouse.LimitOrderPending[] memory listPendingOrderData = new PositionHouse.LimitOrderPending[](listLimitOrder.length + reduceLimitOrder.length + 1);
            uint256 index = 0;
            for (uint256 i = 0; i < listLimitOrder.length; i++) {

                (bool isFilled, bool isBuy,
                uint256 quantity, uint256 partialFilled) = _positionManager.getPendingOrderDetail(listLimitOrder[i].pip, listLimitOrder[i].orderId);
//                if (!isFilled && listLimitOrder[i].reduceQuantity == 0) {
                if (!isFilled ) {
                    listPendingOrderData[index] = PositionHouse.LimitOrderPending({
                    isBuy : isBuy,
                    quantity : quantity,
                    partialFilled : partialFilled,
                    pip : listLimitOrder[i].pip,
                    leverage : listLimitOrder[i].leverage,
                    blockNumber : listLimitOrder[i].blockNumber,
                    orderIdOfTrader : i,
                    orderId : listLimitOrder[i].orderId
                    });
                    index++;
                }
            }
            for (uint256 i = 0; i < reduceLimitOrder.length; i++) {
                (bool isFilled, bool isBuy,
                uint256 quantity, uint256 partialFilled) = _positionManager.getPendingOrderDetail(reduceLimitOrder[i].pip, reduceLimitOrder[i].orderId);
                if (!isFilled && reduceLimitOrder[i].reduceLimitOrderId == 0) {
                    listPendingOrderData[index] = PositionHouse.LimitOrderPending({
                    isBuy : isBuy,
                    quantity : quantity,
                    partialFilled : partialFilled,
                    pip : reduceLimitOrder[i].pip,
                    leverage : reduceLimitOrder[i].leverage,
                    blockNumber : reduceLimitOrder[i].blockNumber,
                    orderIdOfTrader : i,
                    orderId : reduceLimitOrder[i].orderId
                    });
                    index++;
                }
            }
            for (uint256 i = 0; i < listPendingOrderData.length; i++) {
                if (listPendingOrderData[i].quantity != 0) {
                    return listPendingOrderData;
                }
            }
//            PositionHouse.LimitOrderPending[] memory blankListPendingOrderData;
//            return blankListPendingOrderData;
//            if (listPendingOrderData[0].quantity == 0 && listPendingOrderData[listPendingOrderData.length - 1].quantity == 0) {
//                PositionHouse.LimitOrderPending[] memory blankListPendingOrderData;
//                return blankListPendingOrderData;
//            }
        }
//        else {
        PositionHouse.LimitOrderPending[] memory blankListPendingOrderData;
        return blankListPendingOrderData;
//        }
    }

    function getPositionNotionalAndUnrealizedPnl(
        address addressPositionManager,
        address _trader,
        PositionHouse.PnlCalcOption _pnlCalcOption,
        Position.Data memory position
    ) public view returns
    (
        uint256 positionNotional,
        int256 unrealizedPnl
    ){
        IPositionManager positionManager = IPositionManager(addressPositionManager);

        uint256 oldPositionNotional = position.openNotional;
        if (_pnlCalcOption == PositionHouse.PnlCalcOption.SPOT_PRICE) {
            positionNotional = positionManager.getPrice() * position.quantity.abs() / positionManager.getBaseBasisPoint();
        }
        else if (_pnlCalcOption == PositionHouse.PnlCalcOption.TWAP) {
            // TODO get twap price
        }
        else {
            // TODO get oracle price
        }

        if (position.side() == Position.Side.LONG) {
            unrealizedPnl = int256(positionNotional) - int256(oldPositionNotional);
        } else {
            unrealizedPnl = int256(oldPositionNotional) - int256(positionNotional);
        }

    }

    function calcMaintenanceDetail(
        Position.Data memory positionData,
        uint256 maintenanceMarginRatio,
        int256 unrealizedPnl
    ) public view returns (uint256 maintenanceMargin, int256 marginBalance, uint256 marginRatio) {

        maintenanceMargin = positionData.margin * maintenanceMarginRatio / 100;
        marginBalance = int256(positionData.margin) + unrealizedPnl;
        if (marginBalance <= 0) {
            marginRatio = 100;
        } else {
            marginRatio = maintenanceMargin * 100 / uint256(marginBalance);
        }
    }

    function getClaimAmount(
        address _positionManagerAddress,
        address _trader,
        Position.Data memory positionData,
        PositionLimitOrder.Data[] memory _limitOrders,
        PositionLimitOrder.Data[] memory _reduceOrders,
        Position.Data memory positionMapData,
        uint256 canClaimAmountInMap,
        int256 manualMarginInMap
    ) public view returns (int256 totalClaimableAmount){
        IPositionManager _positionManager = IPositionManager(_positionManagerAddress);
        uint256 indexReduce = 0;
//        if (_limitOrders.length != 0) {
            bool skipIf;
            uint256 indexLimit = 0;
            for (indexLimit; indexLimit < _limitOrders.length; indexLimit++) {
                {
                    if (_limitOrders[indexLimit].pip == 0 && _limitOrders[indexLimit].orderId == 0) continue;
                    if (_limitOrders[indexLimit].reduceQuantity != 0 || indexLimit == _limitOrders.length - 1) {
                        {
                            for (indexReduce; indexReduce < _reduceOrders.length; indexReduce++) {
                                int256 realizedPnl = int256(_reduceOrders[indexReduce].reduceQuantity * _positionManager.pipToPrice(_reduceOrders[indexReduce].pip) / _positionManager.getBaseBasisPoint())
                                - int256((positionData.openNotional != 0 ? positionData.openNotional : positionMapData.openNotional) * _reduceOrders[indexReduce].reduceQuantity / (positionData.quantity.abs() != 0 ? positionData.quantity.abs() : positionMapData.quantity.abs()));
                                // if limit order is short then return realizedPnl, else return -realizedPnl because of realizedPnl's formula
                                totalClaimableAmount += _reduceOrders[indexReduce].isBuy == 2 ? realizedPnl : (- realizedPnl);
                                positionData = accumulateLimitOrderToPositionData(_positionManagerAddress, _reduceOrders[indexReduce], positionData, _reduceOrders[indexReduce].entryPrice, _reduceOrders[indexReduce].reduceQuantity);
                                if (_reduceOrders[indexReduce].reduceLimitOrderId != 0) {
                                    indexReduce++;
                                    break;
                                }
                            }
                        }
                        positionData = accumulateLimitOrderToPositionData(_positionManagerAddress, _limitOrders[indexLimit], positionData, _limitOrders[indexLimit].entryPrice, _limitOrders[indexLimit].reduceQuantity);
                    } else {
                        positionData = accumulateLimitOrderToPositionData(_positionManagerAddress, _limitOrders[indexLimit], positionData, _limitOrders[indexLimit].entryPrice, _limitOrders[indexLimit].reduceQuantity);
                    }
                }

//                {
//                    (bool isFilled, bool isBuy,
//                    uint256 quantity, uint256 partialFilled) = _positionManager.getPendingOrderDetail(_limitOrders[indexLimit].pip, _limitOrders[indexLimit].orderId);
//                    if (!isFilled) {
//                        totalClaimableAmount -= int256((quantity - partialFilled) * _positionManager.pipToPrice(_limitOrders[indexLimit].pip) / _positionManager.getBaseBasisPoint() / _limitOrders[indexLimit].leverage);
//                    }
//                }
            }
//        }

        totalClaimableAmount = totalClaimableAmount + int256(canClaimAmountInMap) + manualMarginInMap + int256(positionMapData.margin);
        if (totalClaimableAmount <= 0) {
                totalClaimableAmount = 0;
        }
    }

//    function internalClosePosition(
//        address addressPositionManager,
//        address _trader,
//        PositionHouse.PnlCalcOption _pnlCalcOption,
//        Position.Data memory oldPosition,
//        uint256 quantity
//    ) external returns (PositionHouse.PositionResp memory positionResp) {
//
//        IPositionManager _positionManager = IPositionManager(addressPositionManager);
//        (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(addressPositionManager, _trader, _pnlCalcOption, oldPosition);
//
//        if (oldPosition.quantity > 0) {
//            // sell
//            (positionResp.exchangedPositionSize, positionResp.exchangedQuoteAssetAmount) = openMarketOrder(addressPositionManager, quantity, Position.Side.SHORT, _trader);
//        } else {
//            // buy
//            (positionResp.exchangedPositionSize, positionResp.exchangedQuoteAssetAmount) = openMarketOrder(addressPositionManager, quantity, Position.Side.LONG, _trader);
//        }
//
//        uint256 remainMargin = oldPosition.margin;
//
//        positionResp.realizedPnl = unrealizedPnl;
//        // NOTICE remainMargin can be negative
//        // unchecked: should be -(remainMargin + unrealizedPnl) and update remainMargin with fundingPayment
//        positionResp.marginToVault = - ((int256(remainMargin) + positionResp.realizedPnl) < 0 ? 0 : (int256(remainMargin) + positionResp.realizedPnl));
//        positionResp.unrealizedPnl = 0;
//    }
//
//    function openMarketOrder(
//        address addressPositionManager,
//        uint256 _quantity,
//        Position.Side _side,
//        address _trader
//    ) internal returns (int256 exchangedQuantity, uint256 openNotional) {
//        IPositionManager _positionManager = IPositionManager(addressPositionManager);
//
//        uint256 exchangedSize;
//        (exchangedSize, openNotional) = _positionManager.openMarketPosition(_quantity, _side == Position.Side.LONG);
//        require(exchangedSize == _quantity, "NELQ");
//        exchangedQuantity = _side == Position.Side.LONG ? int256(exchangedSize) : - int256(exchangedSize);
//    }

//    function clearPosition(
//        address addressPositionManager,
//        address _trader,
//        PositionLimitOrder.Data[] storage limitOrders,
//        PositionLimitOrder.Data[] storage reduceLimitOrders
//    ) internal {
//        IPositionManager _positionManager = IPositionManager(addressPositionManager);
//
////        positionMapData.clear();
////        debtPositionData.clearDebt();
//        //        PositionLimitOrder.Data[] memory listLimitOrder = limitOrders;
//        //        PositionLimitOrder.Data[] memory reduceLimitOrder = reduceLimitOrders;
//        //        (PositionLimitOrder.Data[] memory subListLimitOrder, PositionLimitOrder.Data[] memory subReduceLimitOrder) = clearAllFilledOrder(_positionManager, _trader, listLimitOrder, reduceLimitOrder);
//        (PositionLimitOrder.Data[] memory subListLimitOrder, PositionLimitOrder.Data[] memory subReduceLimitOrder) = clearAllFilledOrder(_positionManager, _trader, limitOrders, reduceLimitOrders);
//
//        if (limitOrders.length > 0) {
////            limitOrders.pop();
//            delete limitOrders[addressPositionManager][_trader];
//        }
//        for (uint256 i = 0; i < subListLimitOrder.length; i++) {
//            limitOrders.push(subListLimitOrder[i]);
//        }
//        if (reduceLimitOrders.length > 0) {
////            limitOrders.pop();
//            delete reduceLimitOrders[addressPositionManager][_trader];
//        }
//        for (uint256 i = 0; i < subReduceLimitOrder.length; i++) {
//            reduceLimitOrders.push(subReduceLimitOrder[i]);
//        }
//    }


//    function handleLimitOrderInOpenLimit(
//        OpenLimitResp memory openLimitResp,
//        PositionLimitOrder.Data memory _newOrder,
//        address addressPositionManager,
//        address _trader,
//        uint256 _quantity,
//        Position.Side _side,
//        PositionLimitOrder.Data[] storage limitOrders,
//        PositionLimitOrder.Data[] storage reduceLimitOrders,
//        Position.Data memory _oldPosition) internal returns (uint64 orderIdOfUser) {
//
//        IPositionManager _positionManager = IPositionManager(addressPositionManager);
//
//
//        if (_oldPosition.quantity == 0 || _side == (_oldPosition.quantity > 0 ? Position.Side.LONG : Position.Side.SHORT)) {
//            limitOrders.push(_newOrder);
//            orderIdOfUser = uint64(limitOrders.length - 1);
//        } else {
//            // if new limit order is smaller than old position then just reduce old position
//            if (_oldPosition.quantity.abs() > _quantity) {
//                _newOrder.reduceQuantity = _quantity - openLimitResp.sizeOut;
//                _newOrder.entryPrice = _oldPosition.openNotional * _positionManager.getBaseBasisPoint() / _oldPosition.quantity.abs();
//                reduceLimitOrders.push(_newOrder);
//                orderIdOfUser = uint64(reduceLimitOrders.length - 1);
//            }
//            // else new limit order is larger than old position then close old position and open new opposite position
//            else {
//                _newOrder.reduceQuantity = _oldPosition.quantity.abs();
//                limitOrders.push(_newOrder);
//                orderIdOfUser = uint64(limitOrders.length - 1);
//                _newOrder.entryPrice = _oldPosition.openNotional * _positionManager.getBaseBasisPoint() / _oldPosition.quantity.abs();
//                reduceLimitOrders.push(_newOrder);
//            }
//        }
//    }
}