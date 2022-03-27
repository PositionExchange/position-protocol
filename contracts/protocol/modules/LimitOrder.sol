// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import {PositionHouseMath} from "../libraries/position/PositionHouseMath.sol";
import {PositionHouseFunction} from "../libraries/position/PositionHouseFunction.sol";
import "../libraries/position/PositionLimitOrder.sol";
import "../libraries/helpers/Quantity.sol";
import "../libraries/types/PositionHouseStorage.sol";
import {Errors} from "../libraries/helpers/Errors.sol";

abstract contract LimitOrderManager {
    using Quantity for int256;
    // increase orders
    mapping(address => mapping(address => PositionLimitOrder.Data[])) private limitOrders;
    // reduce orders
    mapping(address => mapping(address => PositionLimitOrder.Data[])) private reduceLimitOrders;

    // check the new limit order is fully reduce, increase or both reduce and increase
    function _storeLimitOrder(
        PositionLimitOrder.Data memory _newOrder,
        IPositionManager _positionManager,
        address _trader,
        int256 _quantity,
        uint256 _sizeOut
    ) internal {
        address _pmAddress = address(_positionManager);
        Position.Data memory oldPosition = getPosition(
            _pmAddress,
            _trader
        );
        if (
            oldPosition.quantity == 0 ||
            _quantity.isSameSide(oldPosition.quantity)
        ) {
            _pushLimit(_pmAddress, _trader, _newOrder);
        } else {
            // limit order reducing position
            uint256 baseBasisPoint = _positionManager.getBaseBasisPoint();
            // if new limit order is smaller than old position then just reduce old position
            if (oldPosition.quantity.abs() > _quantity.abs()) {
                _newOrder.reduceQuantity = _quantity.abs() - _sizeOut;
            }
            // else new limit order is larger than old position then close old position and open new opposite position
            else {
                _newOrder.reduceQuantity = oldPosition.quantity.abs();
                _newOrder.reduceLimitOrderId =
                _getReduceLimitOrders(_pmAddress, _trader).length +
                1;
                _pushLimit(_pmAddress, _trader, _newOrder);
            }
            _newOrder.entryPrice = PositionHouseMath.entryPriceFromNotional(
                oldPosition.openNotional,
                oldPosition.quantity.abs(),
                baseBasisPoint
            );
            _pushReduceLimit(_pmAddress, _trader, _newOrder);
        }
    }

    function _internalOpenLimitOrder(
        IPositionManager _positionManager,
        address _trader,
        uint128 _pip,
        int256 _rawQuantity,
        uint256 _leverage
    ) internal returns (uint64 orderId, uint256 sizeOut) {
        {
            address _pmAddress = address(_positionManager);
            Position.Data memory oldPosition = getPosition(_pmAddress, _trader);
            require(
                _leverage >= oldPosition.leverage &&
                _leverage <= 125 &&
                _leverage > 0,
                Errors.VL_INVALID_LEVERAGE
            );
            uint256 openNotional;
            uint128 _quantity = _rawQuantity.abs128();
            if (
                oldPosition.quantity != 0 &&
                !oldPosition.quantity.isSameSide(_rawQuantity) &&
                _positionManager.needClosePositionBeforeOpeningLimitOrder(
                    _rawQuantity.u8Side(),
                    _pip,
                    _quantity,
                    oldPosition.quantity.u8Side(),
                    oldPosition.quantity.abs()
                )
            ) {
                PositionHouseStorage.PositionResp memory closePositionResp = internalClosePosition(
                    _positionManager,
                    _trader,
                    PositionHouseStorage.PnlCalcOption.SPOT_PRICE,
                    true,
                    oldPosition
                );
                if (
                    _rawQuantity - closePositionResp.exchangedPositionSize == 0
                ) {
                    // TODO deposit margin to vault of position resp
                    //                            positionResp = closePositionResp;
                    //                            deposit(_positionManager, _trader, positionResp.marginToVault.abs(), 0);
                } else {
                    _quantity -= (closePositionResp.exchangedPositionSize)
                    .abs128();
                }
            }
            (orderId, sizeOut, openNotional) = _positionManager
            .openLimitPosition(_pip, _quantity, _rawQuantity > 0);
            if (sizeOut != 0) {
                // case: open a limit order at the last price
                // the order must be partially executed
                // then update the current position
                Position.Data memory newData;
                newData = PositionHouseFunction.handleMarketPart(
                    oldPosition,
                    _getPositionMap(_pmAddress, _trader),
                    openNotional,
                    _rawQuantity > 0 ? int256(sizeOut) : - int256(sizeOut),
                    _leverage,
                    getCumulativePremiumFractions(_pmAddress)
                );
                _updatePositionMap(_pmAddress, _trader, newData);
            }
        }
    }

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

    function getPosition(address _pmAddress, address _trader) public view virtual returns (Position.Data memory);

    function internalClosePosition(
        IPositionManager _positionManager,
        address _trader,
        PositionHouseStorage.PnlCalcOption _pnlCalcOption,
        bool _isInOpenLimit,
        Position.Data memory _oldPosition
    ) internal virtual returns (PositionHouseStorage.PositionResp memory positionResp);

    function _updatePositionMap(address _pmAddress, address _trader, Position.Data memory newData) internal virtual;

    function getCumulativePremiumFractions(address _pmAddress) public view virtual returns (int256[] memory);

    function _getPositionMap(address _pmAddress, address _trader) internal view virtual returns(Position.Data memory);
}
