// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import {PositionHouseMath} from "../libraries/position/PositionHouseMath.sol";
import {PositionHouseFunction} from "../libraries/position/PositionHouseFunction.sol";
import "../libraries/position/PositionLimitOrder.sol";
import "../libraries/helpers/Quantity.sol";
import "../libraries/helpers/Int256Math.sol";
import "../libraries/types/PositionHouseStorage.sol";
import {Errors} from "../libraries/helpers/Errors.sol";
import "./ClaimableAmountManager.sol";

import "hardhat/console.sol";

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

        // only increase order can get withdraw fund from contract
        if (_isReduce == 0) {
            (, uint256 _refundMargin, ) = _positionManager.getNotionalMarginAndFee(
                refundQuantity,
                _order.pip,
                _order.leverage
            );
            insuranceFund.withdraw(_pmAddress, _trader, _refundMargin);
        }
        emit CancelLimitOrder(_trader, _pmAddress, _order.pip, _order.orderId);
    }

    function _internalOpenLimitOrder(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _uQuantity,
        uint128 _pip,
        uint16 _leverage,
        Position.Data memory _oldPosition
    ) internal {
        address _trader = msg.sender;
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
            // trader always need to deposit fund when openLimitResp.sizeOut <= _uQuantity
            // only when new order is reduce order then trader no need to deposit fund
            bool isIncreaseOrder = true;
            if (openLimitResp.orderId != 0){
                isIncreaseOrder = _storeLimitOrder(
                    _newOrder,
                    _positionManager,
                    _trader,
                    _quantity
                );
            }
            (, uint256 marginToVault, uint256 fee) = _positionManager
                .getNotionalMarginAndFee(_uQuantity, _pip, _leverage);
            if (isIncreaseOrder && openLimitResp.orderId != 0) {
                insuranceFund.deposit(_pmAddress, _trader, marginToVault, fee);
            }
            _setLimitOrderPremiumFraction(_pmAddress, _trader, getLatestCumulativePremiumFraction(_pmAddress));
            uint256 limitOrderMargin = marginToVault * (_uQuantity - openLimitResp.sizeOut) / _uQuantity;
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
    ) internal returns (bool isIncreaseOrder){
        address _pmAddress = address(_positionManager);
        Position.Data memory oldPosition = getPosition(_pmAddress, _trader);
        if (
            oldPosition.quantity == 0 ||
            _quantity.isSameSide(oldPosition.quantity)
        ) {
            // limit order increasing position
            _pushLimit(_pmAddress, _trader, _newOrder);
            return true;
        } else {
            // limit order reducing position
            uint256 baseBasisPoint = _positionManager.getBaseBasisPoint();
            _newOrder.entryPrice = PositionHouseMath.entryPriceFromNotional(
                oldPosition.openNotional,
                oldPosition.quantity.abs(),
                baseBasisPoint
            );
            _pushReduceLimit(_pmAddress, _trader, _newOrder);
            return false;
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
            uint128 _quantity = _rawQuantity.abs128();
            if (
                oldPosition.quantity != 0 &&
                !oldPosition.quantity.isSameSide(_rawQuantity) &&
                oldPosition.quantity.abs() <= _quantity &&
                _positionManager.needClosePositionBeforeOpeningLimitOrder(
                    _rawQuantity.u8Side(),
                    _pip,
                    oldPosition.quantity.abs()
                )
            ) {
                PositionHouseStorage.PositionResp
                    memory closePositionResp = _internalClosePosition(
                        _positionManager,
                        _trader,
                        PositionHouseStorage.PnlCalcOption.SPOT_PRICE,
                        true,
                        oldPosition
                    );
                if (
                    _rawQuantity - closePositionResp.exchangedPositionSize == 0
                ) {
                    // TODO refactor to a flag
                    // flag to compare if (openLimitResp.sizeOut <= _uQuantity)
                    // in this case, sizeOut is just only used to compare to open the limit order
                    sizeOut = _rawQuantity.abs() + 1;
                    if (closePositionResp.marginToVault < 0) {
                        insuranceFund.withdraw(_pmAddress, _trader, closePositionResp.marginToVault.abs());
                    }
                } else {
                    _quantity -= (closePositionResp.exchangedPositionSize)
                        .abs128();
                }
            } else {
                (orderId, sizeOut, openNotional) = _positionManager
                    .openLimitPosition(_pip, _quantity, _rawQuantity > 0);
                if (sizeOut != 0) {
                    {

                        if (!_rawQuantity.isSameSide(oldPosition.quantity) && oldPosition.quantity != 0) {
                            int256 totalReturn = PositionHouseFunction.calcReturnWhenOpenReverse(_pmAddress, _trader, sizeOut, oldPosition);
                            insuranceFund.withdraw(_pmAddress, _trader, totalReturn.abs());
                        }
                    }
                    // case: open a limit order at the last price
                    // the order must be partially executed
                    // then update the current position
                    {
                        Position.Data memory newData = PositionHouseFunction.handleMarketPart(
                            oldPosition,
                            _getPositionMap(_pmAddress, _trader),
                            openNotional,
                            _rawQuantity > 0 ? int256(sizeOut) : - int256(sizeOut),
                            _leverage,
                            getLatestCumulativePremiumFraction(_pmAddress)
                        );
                            _updatePositionMap(_pmAddress, _trader, newData);
                    }
                }
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

    function _blankReduceLimitOrder(
        address _pmAddress,
        address _trader,
        uint256 index
    ) internal {
        // blank limit order data
        // we set the deleted order to a blank data
        // because we don't want to mess with order index (orderIdx)
        PositionLimitOrder.Data memory blankLimitOrderData;
        reduceLimitOrders[_pmAddress][_trader][index] = blankLimitOrderData;
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

    function _internalClosePosition(
        IPositionManager _positionManager,
        address _trader,
        PositionHouseStorage.PnlCalcOption _pnlCalcOption,
        bool _isInOpenLimit,
        Position.Data memory _oldPosition
    )
        internal
        virtual
        returns (PositionHouseStorage.PositionResp memory positionResp);

    function _updatePositionMap(
        address _pmAddress,
        address _trader,
        Position.Data memory newData
    ) internal virtual;


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


    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[49] private __gap;
    mapping(address => mapping(address => int128)) public limitOrderPremiumFraction;
}
