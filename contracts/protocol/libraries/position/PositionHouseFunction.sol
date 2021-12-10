pragma solidity ^0.8.0;

import "./Position.sol";
import "../../../interfaces/IPositionManager.sol";
import "./PositionLimitOrder.sol";
import "../../libraries/helpers/Quantity.sol";
import "../../PositionHouse.sol";
import "../types/PositionHouseStorage.sol";


library PositionHouseFunction {
    using PositionLimitOrder for mapping(address => mapping(address => PositionLimitOrder.Data[]));
    using Position for Position.Data;
    using Position for Position.LiquidatedData;
    using Quantity for int256;
    using Quantity for int128;


    //    struct OpenLimitResp {
    //        uint64 orderId;
    //        uint256 sizeOut;
    //    }

    function handleMarketPart(
        Position.Data memory totalPosition,
        Position.Data memory marketPosition,
        uint256 _newQuantity,
        uint256 _newNotional,
        int256 newQuantityInt,
        uint256 _leverage,
        int256[] memory cumulativePremiumFractions
    ) public view returns (Position.Data memory newData) {
        if (newQuantityInt * totalPosition.quantity >= 0) {
            newData = Position.Data(
                marketPosition.quantity + newQuantityInt,
                handleMarginInIncrease(_newNotional / _leverage, marketPosition, totalPosition, cumulativePremiumFractions),
                handleNotionalInIncrease(_newNotional, marketPosition, totalPosition),
            // TODO update latest cumulative premium fraction
                0,
                block.number,
                _leverage
            );
        } else {
            newData = Position.Data(
                marketPosition.quantity + newQuantityInt,
                handleMarginInOpenReverse(totalPosition.margin * _newQuantity / totalPosition.quantity.abs(), marketPosition, totalPosition, cumulativePremiumFractions),
                handleNotionalInOpenReverse(_newNotional, marketPosition, totalPosition),
            // TODO update latest cumulative premium fraction
                0,
                block.number,
                _leverage
            );
        }
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
    ) public view returns (uint256 openNotional) {
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
        Position.Data memory totalPositionData,
        int256[] memory cumulativePremiumFractions
    ) public view returns (uint256 margin) {
        int256 newPositionSide = totalPositionData.quantity < 0 ? int256(1) : int256(- 1);
        if (marketPositionData.quantity * totalPositionData.quantity < 0) {
            margin = marketPositionData.margin + reduceMarginRequirement;
        } else {
            if (marketPositionData.margin > reduceMarginRequirement) {
                margin = marketPositionData.margin - reduceMarginRequirement;
            } else {
                margin = reduceMarginRequirement - marketPositionData.margin;
            }
        }
        margin = calcRemainMarginWithFundingPayment(totalPositionData, margin, cumulativePremiumFractions);
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
    ) public view returns (uint256 openNotional) {

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
        Position.Data memory totalPositionData,
        int256[] memory cumulativePremiumFractions
    ) public view returns (uint256 margin) {
        if (marketPositionData.quantity * totalPositionData.quantity < 0) {
            if (marketPositionData.margin > increaseMarginRequirement) {
                margin = marketPositionData.margin - increaseMarginRequirement;
            } else {
                margin = increaseMarginRequirement - marketPositionData.margin;
            }
        } else {
            margin = marketPositionData.margin + increaseMarginRequirement;
        }
        margin = calcRemainMarginWithFundingPayment(totalPositionData, margin, cumulativePremiumFractions);
    }

    function handleQuantity(int256 oldMarketQuantity, int256 newQuantity) public view returns (int256 quantity) {
        if (oldMarketQuantity * newQuantity >= 0) {
            return oldMarketQuantity + newQuantity;
        }
        return oldMarketQuantity - newQuantity;
    }

    // TODO edit access modifier cause this function called write function in position manager
    function clearAllFilledOrder(
        IPositionManager _positionManager,
        PositionLimitOrder.Data[] memory listLimitOrder,
        PositionLimitOrder.Data[] memory reduceLimitOrder
    ) public returns (PositionLimitOrder.Data[] memory, PositionLimitOrder.Data[] memory) {
        PositionLimitOrder.Data[] memory subListLimitOrder = new PositionLimitOrder.Data[](listLimitOrder.length);
        PositionLimitOrder.Data[] memory subReduceLimitOrder = new PositionLimitOrder.Data[](reduceLimitOrder.length);
        if (listLimitOrder.length > 0) {
            uint256 index = 0;
            for (uint256 i = 0; i < listLimitOrder.length; i++) {
                (bool isFilled,,,) = _positionManager.getPendingOrderDetail(listLimitOrder[i].pip, listLimitOrder[i].orderId);
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
                (bool isFilled,,,) = _positionManager.getPendingOrderDetail(reduceLimitOrder[i].pip, reduceLimitOrder[i].orderId);
                if (isFilled != true) {
                    subReduceLimitOrder[index] = reduceLimitOrder[i];
                    _positionManager.updatePartialFilledOrder(reduceLimitOrder[i].pip, reduceLimitOrder[i].orderId);
                    index++;
                }
            }
        }
        return (subListLimitOrder, subReduceLimitOrder);
    }

    function calculateLimitOrder(
        address positionManager,
        PositionLimitOrder.Data[] memory _limitOrders,
        PositionLimitOrder.Data[] memory _reduceOrders,
        Position.Data memory _positionData
    ) public view returns (Position.Data memory positionData) {
        for (uint i = 0; i < _limitOrders.length; i++) {
            if (_limitOrders[i].pip != 0) {
                _positionData = accumulateLimitOrderToPositionData(positionManager, _limitOrders[i], _positionData, _limitOrders[i].entryPrice, _limitOrders[i].reduceQuantity);
            }
        }
        for (uint i = 0; i < _reduceOrders.length; i++) {
            if (_reduceOrders[i].pip != 0) {
                _positionData = accumulateLimitOrderToPositionData(positionManager, _reduceOrders[i], _positionData, _reduceOrders[i].entryPrice, _reduceOrders[i].reduceQuantity);
            }
        }
        positionData = _positionData;
    }

    function accumulateLimitOrderToPositionData(
        address addressPositionManager,
        PositionLimitOrder.Data memory limitOrder,
        Position.Data memory positionData,
        uint256 entryPrice,
        uint256 reduceQuantity) public view returns (Position.Data memory) {

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
        PositionLimitOrder.Data[] memory reduceLimitOrder) public view returns (PositionHouseStorage.LimitOrderPending[] memory){

        IPositionManager _positionManager = IPositionManager(addressPositionManager);
        if (listLimitOrder.length + reduceLimitOrder.length > 0) {
            PositionHouseStorage.LimitOrderPending[] memory listPendingOrderData = new PositionHouseStorage.LimitOrderPending[](listLimitOrder.length + reduceLimitOrder.length + 1);
            uint256 index = 0;
            for (uint256 i = 0; i < listLimitOrder.length; i++) {

                (bool isFilled, bool isBuy,
                uint256 quantity, uint256 partialFilled) = _positionManager.getPendingOrderDetail(listLimitOrder[i].pip, listLimitOrder[i].orderId);
                if (!isFilled) {
                    listPendingOrderData[index] = PositionHouseStorage.LimitOrderPending({
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
                    listPendingOrderData[index] = PositionHouseStorage.LimitOrderPending({
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
        }
        PositionHouseStorage.LimitOrderPending[] memory blankListPendingOrderData;
        return blankListPendingOrderData;
    }

    function getPositionNotionalAndUnrealizedPnl(
        address addressPositionManager,
        address _trader,
        PositionHouseStorage.PnlCalcOption _pnlCalcOption,
        Position.Data memory position
    ) public view returns
    (
        uint256 positionNotional,
        int256 unrealizedPnl
    ){
        IPositionManager positionManager = IPositionManager(addressPositionManager);

        uint256 oldPositionNotional = position.openNotional;
        if (_pnlCalcOption == PositionHouseStorage.PnlCalcOption.SPOT_PRICE) {
            positionNotional = positionManager.getPrice() * position.quantity.abs() / positionManager.getBaseBasisPoint();
        }
        else if (_pnlCalcOption == PositionHouseStorage.PnlCalcOption.TWAP) {
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
        uint256 indexLimit = 0;

        for (indexLimit; indexLimit < _limitOrders.length; indexLimit++) {
            {
                if (_limitOrders[indexLimit].pip == 0 && _limitOrders[indexLimit].orderId == 0) continue;
                if (_limitOrders[indexLimit].reduceQuantity != 0 || indexLimit == _limitOrders.length - 1) {
                    {
                        (indexReduce, totalClaimableAmount, positionData) = calculatePnlFromReduceOrder(_positionManager, indexReduce, totalClaimableAmount, positionData, _reduceOrders, positionMapData);
                    }
                    positionData = accumulateLimitOrderToPositionData(_positionManagerAddress, _limitOrders[indexLimit], positionData, _limitOrders[indexLimit].entryPrice, _limitOrders[indexLimit].reduceQuantity);
                } else {
                    positionData = accumulateLimitOrderToPositionData(_positionManagerAddress, _limitOrders[indexLimit], positionData, _limitOrders[indexLimit].entryPrice, _limitOrders[indexLimit].reduceQuantity);
                }
            }

            (bool isFilled,,uint256 quantity, uint256 partialFilled) = _positionManager.getPendingOrderDetail(_limitOrders[indexLimit].pip, _limitOrders[indexLimit].orderId);
            if (!isFilled) {
                totalClaimableAmount -= int256((quantity - partialFilled) * _positionManager.pipToPrice(_limitOrders[indexLimit].pip) / _positionManager.getBaseBasisPoint() / _limitOrders[indexLimit].leverage);
            }

        }

        totalClaimableAmount = totalClaimableAmount + int256(canClaimAmountInMap) + manualMarginInMap + int256(positionMapData.margin);
        if (totalClaimableAmount <= 0) {
            totalClaimableAmount = 0;
        }
    }

    function calculatePnlFromReduceOrder(
        IPositionManager _positionManager,
        uint256 _indexReduce,
        int256 _totalClaimableAmount,
        Position.Data memory _positionData,
        PositionLimitOrder.Data[] memory _reduceOrders,
        Position.Data memory positionMapData
    ) public view returns (uint256 indexReduce, int256 totalClaimableAmount, Position.Data memory positionData) {
        for (_indexReduce; _indexReduce < _reduceOrders.length; _indexReduce++) {
            (bool isFilled,,, uint256 partialFilled) = _positionManager.getPendingOrderDetail(_reduceOrders[_indexReduce].pip, _reduceOrders[_indexReduce].orderId);
            //            uint256 filledQuantity = (partialFilled < _reduceOrders[_indexReduce].reduceQuantity && !isFilled) ? partialFilled : _reduceOrders[_indexReduce].reduceQuantity;
            {
                int256 realizedPnl = int256(((partialFilled < _reduceOrders[_indexReduce].reduceQuantity && !isFilled) ? partialFilled : _reduceOrders[_indexReduce].reduceQuantity) * _positionManager.pipToPrice(_reduceOrders[_indexReduce].pip) / _positionManager.getBaseBasisPoint())
                - int256((_positionData.openNotional != 0 ? _positionData.openNotional : positionMapData.openNotional) * ((partialFilled < _reduceOrders[_indexReduce].reduceQuantity && !isFilled) ? partialFilled : _reduceOrders[_indexReduce].reduceQuantity) / (_positionData.quantity.abs() != 0 ? _positionData.quantity.abs() : positionMapData.quantity.abs()));
                _totalClaimableAmount += _reduceOrders[_indexReduce].isBuy == 2 ? realizedPnl : (- realizedPnl);
            }
            {
                positionData = accumulateLimitOrderToPositionData(address(_positionManager), _reduceOrders[_indexReduce], _positionData, _reduceOrders[_indexReduce].entryPrice, _reduceOrders[_indexReduce].reduceQuantity);
            }
            if (_reduceOrders[_indexReduce].reduceLimitOrderId != 0) {
                _indexReduce++;
                break;
            }
        }
        indexReduce = _indexReduce;
        totalClaimableAmount = _totalClaimableAmount;
    }

    // TODO edit access modifier cause this function called write function in position manager
    function openMarketOrder(
        address addressPositionManager,
        uint256 _quantity,
        Position.Side _side,
        address _trader
    ) internal returns (int256 exchangedQuantity, uint256 openNotional) {
        IPositionManager _positionManager = IPositionManager(addressPositionManager);

        uint256 exchangedSize;
        (exchangedSize, openNotional) = _positionManager.openMarketPosition(_quantity, _side == Position.Side.LONG);
        require(exchangedSize == _quantity, "NELQ");
        exchangedQuantity = _side == Position.Side.LONG ? int256(exchangedSize) : - int256(exchangedSize);
    }

//    function increasePosition(
//        address addressPositionManager,
//        Position.Side _side,
//        int256 _quantity,
//        uint256 _leverage,
//        address _trader,
//        Position.Data memory totalPosition,
//        Position.Data memory marketPosition
//    ) public returns (PositionHouseStorage.PositionResp memory positionResp){
////        IPositionManager _positionManager = IPositionManager(addressPositionManager);
//        (positionResp.exchangedPositionSize, positionResp.exchangedQuoteAssetAmount) = openMarketOrder(addressPositionManager, _quantity.abs(), _side, _trader);
//        if (positionResp.exchangedPositionSize != 0) {
////            Position.Data memory marketPosition = positionMap[address(_positionManager)][_trader];
//            int256 _newSize = marketPosition.quantity + positionResp.exchangedPositionSize;
//            uint256 increaseMarginRequirement = positionResp.exchangedQuoteAssetAmount / _leverage;
//            // TODO update function latestCumulativePremiumFraction
//
//            //            Position.Data memory totalPosition = getPosition(address(_positionManager), _trader);
//
//            (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(addressPositionManager, _trader, PositionHouseStorage.PnlCalcOption.SPOT_PRICE, totalPosition);
//
//            positionResp.unrealizedPnl = unrealizedPnl;
//            positionResp.realizedPnl = 0;
//            // checked margin to vault
//            positionResp.marginToVault = int256(increaseMarginRequirement);
//            positionResp.position = Position.Data(
//                _newSize,
//                handleMarginInIncrease(increaseMarginRequirement, marketPosition, totalPosition),
//                handleNotionalInIncrease(positionResp.exchangedQuoteAssetAmount, marketPosition, totalPosition),
//                0,
//                block.number,
//                _leverage
//            );
//        }
//    }

    function calcRemainMarginWithFundingPayment(
        Position.Data memory oldPosition, uint256 deltaMargin, int256[] memory cumulativePremiumFractions
    ) internal view returns (uint256 remainMargin){
        int256 fundingPayment;
        // calculate fundingPayment
        int256 latestCumulativePremiumFraction = getLatestCumulativePremiumFraction(cumulativePremiumFractions);
        if (oldPosition.quantity != 0) {
            fundingPayment = (latestCumulativePremiumFraction - oldPosition.lastUpdatedCumulativePremiumFraction) * oldPosition.quantity;
        }

        // calculate remain margin, if remain margin is negative, set to zero and leave the rest to bad debt
        if (int256(deltaMargin) + fundingPayment >= 0) {
            remainMargin = uint256(int256(deltaMargin) + fundingPayment);
        }
    }

    function getLatestCumulativePremiumFraction(int256[] memory cumulativePremiumFractions) public view returns (int256){
        uint256 len = cumulativePremiumFractions.length;
        if (len > 0) {
            return cumulativePremiumFractions[len - 1];
        }
    }
}