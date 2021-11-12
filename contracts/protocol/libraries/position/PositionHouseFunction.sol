pragma solidity ^0.8.0;

import "./Position.sol";
import "../../../interfaces/IPositionManager.sol";
import "./PositionLimitOrder.sol";
import "../../libraries/helpers/Quantity.sol";

library PositionHouseFunction {
    using PositionLimitOrder for mapping(address => mapping(address => PositionLimitOrder.Data[]));
    using Position for Position.Data;
    using Quantity for int256;
    using Quantity for int128;

    struct LimitOrderPending {
        // TODO restruct data: can remove openNotional, blockNumber
        bool isBuy;
        uint256 quantity;
        uint256 partialFilled;
        int256 pip;
        uint256 leverage;
        uint256 blockNumber;
        uint256 orderIdOfTrader;
        uint256 orderId;
    }

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

        int256 newPositionSide = totalPositionData.quantity > 0 ? int256(1) : int256(- 1);
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
        Position.Data memory positionData,
        uint256 leverage,
        uint256 priceDivBaseBasisPoint,
        uint256 entryPrice,
        uint256 reduceQuantity,
        bool isFilled,
        bool isBuy,
        uint256 quantity,
        uint256 partialFilled) internal view returns (Position.Data memory) {
        if (isFilled) {
            int256 _orderQuantity;

            if (reduceQuantity == 0 && entryPrice == 0) {
                _orderQuantity = isBuy ? int256(quantity) : - int256(quantity);
            } else if (reduceQuantity != 0 && entryPrice == 0) {
                _orderQuantity = isBuy ? int256(quantity - reduceQuantity) : - int256(quantity - reduceQuantity);
            } else {
                _orderQuantity = isBuy ? int256(reduceQuantity) : - int256(reduceQuantity);
            }
            {
                uint256 _orderNotional = _orderQuantity.abs() * (entryPrice == 0 ? priceDivBaseBasisPoint : entryPrice);
                // IMPORTANT UPDATE FORMULA WITH LEVERAGE
                //                uint256 _orderMargin = _orderNotional / leverage;
                positionData = positionData.accumulateLimitOrder(_orderQuantity, _orderNotional / leverage, _orderNotional);
            }
        }
        else if (!isFilled && partialFilled != 0) {// partial filled
            int256 _partialQuantity;
            {
                if (reduceQuantity == 0 && entryPrice == 0) {
                    _partialQuantity = isBuy ? int256(partialFilled) : - int256(partialFilled);
                } else if (reduceQuantity != 0 && entryPrice == 0) {

                    int256 _partialQuantityTemp = partialFilled > reduceQuantity ? int256(partialFilled - reduceQuantity) : 0;
                    _partialQuantity = isBuy ? _partialQuantityTemp : - _partialQuantityTemp;
                } else {
                    int256 _partialQuantityTemp = partialFilled > reduceQuantity ? int256(reduceQuantity) : int256(partialFilled);
                    _partialQuantity = isBuy ? _partialQuantityTemp : - _partialQuantityTemp;
                }
                uint256 _partialOpenNotional = _partialQuantity.abs() * (entryPrice == 0 ? priceDivBaseBasisPoint : entryPrice);
                // IMPORTANT UPDATE FORMULA WITH LEVERAGE
                // uint256 _partialMargin = _partialOpenNotional / leverage;
                positionData = positionData.accumulateLimitOrder(_partialQuantity, _partialOpenNotional / leverage, _partialOpenNotional);
            }

        }
        positionData.leverage = positionData.leverage >= leverage ? positionData.leverage : leverage;
        return positionData;
    }
}