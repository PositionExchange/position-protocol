// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import {PositionHouseFunction} from "../libraries/position/PositionHouseFunction.sol";
import {PositionMath} from "../libraries/position/PositionMath.sol";
import "../libraries/position/PositionLimitOrder.sol";
import "../libraries/helpers/Quantity.sol";
import "../libraries/helpers/Int256Math.sol";
import "../libraries/types/PositionHouseStorage.sol";
import {Errors} from "../libraries/helpers/Errors.sol";
import "./ClaimableAmountManager.sol";

abstract contract LimitOrderManager is ClaimableAmountManager, PositionHouseStorage {
    event OpenLimit(
        uint64 orderId,
        address trader,
        int256 quantity,
        uint256 leverage,
        uint128 pip,
        IPositionManager positionManager
    );

    event CancelLimitOrder(
        address trader,
        address _positionManager,
        uint128 pip,
        uint64 orderId
    );

    using Quantity for int256;
    using Int256Math for int256;
    // increase orders
    mapping(address => mapping(address => PositionLimitOrder.Data[]))
        private limitOrders;
    // reduce orders
    mapping(address => mapping(address => PositionLimitOrder.Data[]))
        private reduceLimitOrders;

    function _internalCancelLimitOrder(
        IPositionManager _positionManager,
        uint64 _orderIdx,
        uint8 _isReduce
    ) internal {
        address _trader = msg.sender;
        address _pmAddress = address(_positionManager);
        // declare a pointer to reduceLimitOrders or limitOrders
        PositionLimitOrder.Data[] storage _orders = _getLimitOrderPointer(
            _pmAddress,
            _trader,
            _isReduce
        );
        require(_orderIdx < _orders.length, Errors.VL_INVALID_ORDER);
        // save gas
        PositionLimitOrder.Data memory _order = _orders[_orderIdx];
        PositionLimitOrder.Data memory blankLimitOrderData;

        (uint256 refundQuantity, uint256 partialFilled) = _positionManager
        .cancelLimitOrder(_order.pip, _order.orderId);
        if (partialFilled == 0) {
            _orders[_orderIdx] = blankLimitOrderData;
        }

        // only increase order can withdraw fund from contract
        if (_isReduce == 0) {
            (, uint256 _refundMargin, ) = _positionManager.getNotionalMarginAndFee(
                refundQuantity,
                _order.pip,
                _order.leverage
            );
            _withdraw(_pmAddress, _trader, _refundMargin);
        }
        emit CancelLimitOrder(_trader, _pmAddress, _order.pip, _order.orderId);
    }

    function _internalCancelAllPendingOrder(
        IPositionManager _positionManager,
        address _trader
    ) internal {
        address _pmAddress = address(_positionManager);
        PositionLimitOrder.Data[] memory _increaseOrders = limitOrders[_pmAddress][_trader];
        uint256 totalRefundMargin;
        if (_increaseOrders.length != 0) {
            totalRefundMargin = PositionHouseFunction.getTotalPendingLimitOrderMargin(_positionManager, _increaseOrders);
        }
        _emptyLimitOrders(_pmAddress, _trader);
        _emptyReduceLimitOrders(_pmAddress, _trader);
        if (totalRefundMargin != 0) {
            _withdraw(_pmAddress, _trader, totalRefundMargin);
        }
    }

    function _internalOpenLimitOrder(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _uQuantity,
        uint128 _pip,
        uint16 _leverage,
        Position.Data memory _oldPosition,
        address _trader
    ) internal {
        PositionHouseStorage.OpenLimitResp memory openLimitResp;
        address _pmAddress = address(_positionManager);
        int256 _quantity = _side == Position.Side.LONG
            ? int256(_uQuantity)
            : -int256(_uQuantity);
        _requireOrderSideAndQuantity(_pmAddress, _trader, _side, _uQuantity, _oldPosition.quantity);

        (openLimitResp.orderId, openLimitResp.sizeOut) = _openLimitOrder(
            _positionManager,
            _trader,
            _pip,
            _quantity,
            _leverage,
            _oldPosition
        );
        if (openLimitResp.sizeOut <= _uQuantity) {
            PositionLimitOrder.Data memory _newOrder = PositionLimitOrder.Data({
                pip: _pip,
                orderId: openLimitResp.orderId,
                leverage: _leverage,
                isBuy: _side == Position.Side.LONG ? 1 : 2,
                entryPrice: 0,
                reduceLimitOrderId: 0,
                reduceQuantity: 0,
                blockNumber: uint64(block.number)
            });
            if (openLimitResp.orderId != 0){
                _storeLimitOrder(
                    _newOrder,
                    _positionManager,
                    _trader,
                    _quantity
                );
            }
            (uint256 notional, uint256 marginToVault, uint256 fee) = _positionManager
                .getNotionalMarginAndFee(_uQuantity, _pip, _leverage);
            if (_oldPosition.quantity == 0 || _oldPosition.quantity.isSameSide(_quantity)) {
                require(_checkMaxNotional(notional, configNotionalKey[_pmAddress], _leverage), Errors.VL_EXCEED_MAX_NOTIONAL);
                _deposit(_pmAddress, _trader, marginToVault, fee);
            }
            _setLimitOrderPremiumFraction(_pmAddress, _trader, getLatestCumulativePremiumFraction(_pmAddress));
        }
        emit OpenLimit(
            openLimitResp.orderId,
            _trader,
            _quantity,
            _leverage,
            _pip,
            _positionManager
        );
    }

    // check the new limit order is fully reduce, increase or both reduce and increase
    function _storeLimitOrder(
        PositionLimitOrder.Data memory _newOrder,
        IPositionManager _positionManager,
        address _trader,
        int256 _quantity
    ) internal {
        address _pmAddress = address(_positionManager);
        Position.Data memory oldPosition = getPosition(_pmAddress, _trader);
        if (
            oldPosition.quantity == 0 ||
            _quantity.isSameSide(oldPosition.quantity)
        ) {
            // limit order increasing position
            _pushLimit(_pmAddress, _trader, _newOrder);
        } else {
            // limit order reducing position
            uint256 baseBasisPoint = _positionManager.getBaseBasisPoint();
            _newOrder.entryPrice = PositionMath.calculateEntryPrice(
                oldPosition.openNotional,
                oldPosition.quantity.abs(),
                baseBasisPoint
            );
            _pushReduceLimit(_pmAddress, _trader, _newOrder);
        }
    }

    function _openLimitOrder(
        IPositionManager _positionManager,
        address _trader,
        uint128 _pip,
        int256 _rawQuantity,
        uint16 _leverage,
        Position.Data memory oldPosition
    ) private returns (uint64 orderId, uint256 sizeOut) {
        {
            address _pmAddress = address(_positionManager);
            require(
                _leverage >= oldPosition.leverage &&
                    _leverage <= _positionManager.getLeverage() &&
                    _leverage > 0,
                Errors.VL_INVALID_LEVERAGE
            );
            uint256 openNotional;
            {
                uint128 _quantity = _rawQuantity.abs128();
                (orderId, sizeOut, openNotional) = _positionManager
                    .openLimitPosition(_pip, _quantity, _rawQuantity > 0);
            }
            if (sizeOut != 0) {
                int256 intSizeOut = _rawQuantity > 0 ? int256(sizeOut) : -int256(sizeOut);
                {
                    if (!_rawQuantity.isSameSide(oldPosition.quantity) && oldPosition.quantity != 0) {
                        int256 totalReturn = PositionHouseFunction.calcReturnWhenOpenReverse(sizeOut, openNotional, oldPosition);
                        _withdraw(_pmAddress, _trader, totalReturn.abs());
                        // if new limit order is not same side with old position, sizeOut == oldPosition.quantity
                        // => close all position and clear position, return sizeOut + 1 mean closed position
                        if (sizeOut == oldPosition.quantity.abs()) {
                            clearPosition(_pmAddress, _trader);
                            // TODO refactor to a flag
                            // flag to compare if (openLimitResp.sizeOut <= _uQuantity)
                            // in this case, sizeOut is just only used to compare to open the limit order
                            return (orderId, sizeOut + 1);
                        }
                    }
                }
                // case: open a limit order at the last price
                // the order must be partially executed
                // then update the current position
                _updatePositionAfterOpenLimit(
                    oldPosition,
                    openNotional,
                    intSizeOut,
                    _leverage,
                    _pmAddress,
                    _trader
                );
            }
        }
    }

    function _getLimitOrderPointer(
        address _pmAddress,
        address _trader,
        uint8 _isReduce
    ) internal view returns (PositionLimitOrder.Data[] storage) {
        return
            _isReduce == 1
                ? reduceLimitOrders[_pmAddress][_trader]
                : limitOrders[_pmAddress][_trader];
    }

    function _getLimitOrders(address _pmAddress, address _trader)
        public
        view
        returns (PositionLimitOrder.Data[] memory)
    {
        return limitOrders[_pmAddress][_trader];
    }

    function _getReduceLimitOrders(address _pmAddress, address _trader)
        public
        view
        returns (PositionLimitOrder.Data[] memory)
    {
        return reduceLimitOrders[_pmAddress][_trader];
    }

    function _updatePositionAfterOpenLimit(
        Position.Data memory _oldPosition,
        uint256 _openNotional,
        int256 _intSizeOut,
        uint16 _leverage,
        address _pmAddress,
        address _trader
    ) internal {
        int256 manualAddedMargin = _getManualMargin(_pmAddress, _trader);
        _oldPosition.margin -= manualAddedMargin.abs();
        // only use position data without manual margin
        Position.Data memory newData = PositionHouseFunction.handleMarketPart(
            _oldPosition,
            _getPositionMap(_pmAddress, _trader),
            _openNotional,
            _intSizeOut,
            _leverage,
            getLatestCumulativePremiumFraction(_pmAddress)
        );
        // reduce storage manual margin when reverse
        if (_intSizeOut * _oldPosition.quantity < 0) {
            manualMargin[_pmAddress][_trader] -= manualAddedMargin * _intSizeOut.absInt() / _oldPosition.quantity.absInt();
        }
        _updatePositionMap(_pmAddress, _trader, newData);
    }

    function _pushLimit(
        address _pmAddress,
        address _trader,
        PositionLimitOrder.Data memory order
    ) internal {
        limitOrders[_pmAddress][_trader].push(order);
    }

    function _pushReduceLimit(
        address _pmAddress,
        address _trader,
        PositionLimitOrder.Data memory order
    ) internal {
        reduceLimitOrders[_pmAddress][_trader].push(order);
    }

    function _setLimitOrderPremiumFraction(
        address _pmAddress,
        address _trader,
        int128 _latestCumulativeFraction
    ) internal {
        limitOrderPremiumFraction[_pmAddress][_trader] = _latestCumulativeFraction;
    }

    function _emptyLimitOrders(address _pmAddress, address _trader) internal {
        if (_getLimitOrders(_pmAddress, _trader).length > 0) {
            delete limitOrders[_pmAddress][_trader];
        }
    }

    function _emptyReduceLimitOrders(address _pmAddress, address _trader)
        internal
    {
        if (_getReduceLimitOrders(_pmAddress, _trader).length > 0) {
            delete reduceLimitOrders[_pmAddress][_trader];
        }
    }

    function _getLimitOrderPremiumFraction(
        address _pmAddress,
        address _trader
    ) internal view returns (int128) {
        return limitOrderPremiumFraction[_pmAddress][_trader];
    }

    function _requireOrderSideAndQuantity(
        address _pmAddress,
        address _trader,
        Position.Side _side,
        uint256 _quantity,
        int256 _positionQuantity
    ) internal view {
        PositionHouseFunction.CheckSideAndQuantityParam memory checkSideAndQuantityParam = PositionHouseFunction.CheckSideAndQuantityParam({
            limitOrders: _getLimitOrders(_pmAddress, _trader),
            reduceLimitOrders: _getReduceLimitOrders(_pmAddress, _trader),
            side: _side,
            orderQuantity: _quantity,
            positionQuantity: _positionQuantity
        });
        PositionHouseFunction.ReturnCheckOrderSideAndQuantity checkOrder = PositionHouseFunction.checkPendingOrderSideAndQuantity(IPositionManager(_pmAddress), checkSideAndQuantityParam);
        if (checkOrder == PositionHouseFunction.ReturnCheckOrderSideAndQuantity.MUST_SAME_SIDE) {
            if (_side == Position.Side.LONG) {
                revert (Errors.VL_MUST_SAME_SIDE_LONG);
            } else {
                revert (Errors.VL_MUST_SAME_SIDE_SHORT);
            }
        } else if (checkOrder == PositionHouseFunction.ReturnCheckOrderSideAndQuantity.MUST_SMALLER_QUANTITY) {
            revert (Errors.VL_MUST_SMALLER_REVERSE_QUANTITY);
        }
    }

    function _needToClaimFund(
        address _pmAddress,
        address _trader,
        Position.Data memory _positionData
    ) internal view returns (bool needClaim, int256 claimableAmount) {
        claimableAmount = _getClaimAmount(
            _pmAddress,
            _trader,
            _positionData
        );
        needClaim = claimableAmount != 0 && _positionData.quantity == 0;
    }

    function _getClaimAmount(
        address _pmAddress,
        address _trader,
        Position.Data memory _positionData
    ) internal view returns (int256) {
        address a = _pmAddress;
        address t = _trader;

        {
            return PositionHouseFunction.getClaimAmount(
                a,
                _getManualMargin(a, t),
                getDebtPosition(a,t),
                _getPositionMap(a, t),
                _getLimitOrders(a, t),
                _getReduceLimitOrders(a, t),
                _getLimitOrderPremiumFraction(a, t),
                getLatestCumulativePremiumFraction(a)
            );

        }

    }

    function getPosition(address _pmAddress, address _trader)
        public
        view
        virtual
        returns (Position.Data memory);

//    function _internalClosePosition(
//        IPositionManager _positionManager,
//        address _trader,
//        PositionHouseStorage.PnlCalcOption _pnlCalcOption,
//        bool _isInOpenLimit,
//        Position.Data memory _oldPosition
//    )
//        internal
//        virtual
//        returns (PositionHouseStorage.PositionResp memory positionResp);

    function _updatePositionMap(
        address _pmAddress,
        address _trader,
        Position.Data memory newData
    ) internal virtual;

    function clearPosition(
        address _pmAddress,
        address _trader
    ) internal virtual;

    function _checkMaxNotional(
        uint256 _notional,
        bytes32 _key,
        uint16 _leverage
    ) internal virtual returns (bool);


    function getLatestCumulativePremiumFraction(address _pmAddress)
        public
        view
        virtual
        returns (int128);

    function _getPositionMap(address _pmAddress, address _trader)
        internal
        view
        virtual
        returns (Position.Data memory);

    function _getManualMargin(address _pmAddress, address _trader)
        internal
        view
        virtual
        returns (int256);

    function getDebtPosition(address _pmAddress, address _trader)
        public
        view
        virtual
        returns (Position.LiquidatedData memory);

    function _withdraw(
        address positionManager,
        address trader,
        uint256 amount
    ) internal virtual;

    function _deposit(
        address positionManager,
        address trader,
        uint256 amount,
        uint256 fee
    ) internal virtual;
    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[49] private __gap;
    mapping(address => mapping(address => int128)) public limitOrderPremiumFraction;
}
