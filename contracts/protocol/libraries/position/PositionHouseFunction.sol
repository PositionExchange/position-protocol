pragma solidity ^0.8.0;

import "./Position.sol";
import "../../../interfaces/IPositionManager.sol";
import "./PositionLimitOrder.sol";
import "../../libraries/helpers/Quantity.sol";
import "../../PositionHouse.sol";

library PositionHouseFunction {
    using PositionLimitOrder for mapping(address => mapping(address => PositionLimitOrder.Data[]));
    using Position for Position.Data;
    using Quantity for int256;
    using Quantity for int128;


    struct OpenLimitResp {
        uint64 orderId;
        uint256 sizeOut;
    }

    function handleNotionalInOpenReverse(
        uint256 exchangedQuoteAmount,
        Position.Data memory marketPositionData,
        Position.Data memory totalPositionData
    ) internal pure returns (uint256 openNotional) {
        // Position.Data memory marketPositionData = positionMap[_positionManager][_trader];
        // Position.Data memory totalPositionData = getPosition(_positionManager, _trader);
        int256 newPositionSide = totalPositionData.quantity < 0 ? int256(1) : int256(- 1);
        if (marketPositionData.quantity * totalPositionData.quantity < 0) {
//            if (marketPositionData.quantity * newPositionSide > 0) {
            if (marketPositionData.quantity * newPositionSide > 0) {
                openNotional = marketPositionData.openNotional + exchangedQuoteAmount;
            } else {
                openNotional = marketPositionData.openNotional - exchangedQuoteAmount;
            }
        } else if (marketPositionData.quantity == 0) {
            openNotional = exchangedQuoteAmount;
        } else {
            openNotional = marketPositionData.openNotional > exchangedQuoteAmount ? marketPositionData.openNotional - exchangedQuoteAmount : exchangedQuoteAmount - marketPositionData.openNotional;
        }
    }

    function handleMarginInOpenReverse(
        uint256 reduceMarginRequirement,
        Position.Data memory marketPositionData,
        Position.Data memory totalPositionData
    ) internal pure returns (uint256 margin) {
        int256 newPositionSide = totalPositionData.quantity < 0 ? int256(1) : int256(- 1);
        if (marketPositionData.quantity * totalPositionData.quantity < 0) {
            if (marketPositionData.quantity * newPositionSide > 0) {
                margin = marketPositionData.margin + reduceMarginRequirement;
            } else {
                margin = marketPositionData.margin - reduceMarginRequirement;
            }
        } else {
            margin = reduceMarginRequirement > marketPositionData.margin ? reduceMarginRequirement - marketPositionData.margin : marketPositionData.margin - reduceMarginRequirement;
        }
    }


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

    function handleMarginInIncrease(
        uint256 increaseMarginRequirement,
        Position.Data memory marketPositionData,
        Position.Data memory totalPositionData
    ) internal pure returns (uint256 margin) {
        int256 newPositionSide = totalPositionData.quantity > 0 ? int256(1) : int256(- 1);
        if (marketPositionData.quantity * totalPositionData.quantity < 0) {
            if (marketPositionData.quantity * newPositionSide > 0) {
                margin = marketPositionData.margin + increaseMarginRequirement;
            } else {
                margin = increaseMarginRequirement > marketPositionData.margin ? increaseMarginRequirement - marketPositionData.margin : marketPositionData.margin - increaseMarginRequirement;
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
        PositionHouse.LimitOrderPending[] memory listPendingOrderData = new PositionHouse.LimitOrderPending[](listLimitOrder.length + reduceLimitOrder.length);
        uint256 index = 0;
        for (uint256 i = 0; i < listLimitOrder.length; i++) {
            (bool isFilled, bool isBuy,
            uint256 quantity, uint256 partialFilled) = _positionManager.getPendingOrderDetail(listLimitOrder[i].pip, listLimitOrder[i].orderId);
            if (!isFilled && listLimitOrder[i].reduceQuantity == 0) {
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
            if (!isFilled) {
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
        if (listPendingOrderData[0].quantity == 0 && listPendingOrderData[listPendingOrderData.length - 1].quantity == 0) {
            PositionHouse.LimitOrderPending[] memory blankListPendingOrderData;
            return blankListPendingOrderData;
        }
        return listPendingOrderData;
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
}