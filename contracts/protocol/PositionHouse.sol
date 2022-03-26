// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;

import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "../interfaces/IPositionManager.sol";
import "./libraries/position/Position.sol";
import "hardhat/console.sol";
import "./PositionManager.sol";
import "./libraries/helpers/Quantity.sol";
import "./libraries/position/PositionLimitOrder.sol";
import "../interfaces/IInsuranceFund.sol";
import "./libraries/types/PositionHouseStorage.sol";
import {PositionHouseFunction} from "./libraries/position/PositionHouseFunction.sol";
import {PositionHouseMath} from "./libraries/position/PositionHouseMath.sol";
import {Errors} from "./libraries/helpers/Errors.sol";
import {Int256Math} from "./libraries/helpers/Int256Math.sol";

contract PositionHouse is
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    PositionHouseStorage,
    PausableUpgradeable
{
    using PositionLimitOrder for mapping(address => mapping(address => PositionLimitOrder.Data[]));
    using Quantity for int256;
    using Int256Math for int256;
    using Quantity for int128;

    using Position for Position.Data;
    using Position for Position.LiquidatedData;
    using PositionHouseFunction for PositionHouse;

    event OpenMarket(
        address trader,
        int256 quantity,
        uint256 leverage,
        uint256 entryPrice,
        IPositionManager positionManager
    );
    event OpenLimit(
        uint64 orderId,
        address trader,
        int256 quantity,
        uint256 leverage,
        uint128 pip,
        IPositionManager positionManager
    );

    event MarginAdded(
        address trader,
        uint256 marginAdded,
        IPositionManager positionManager
    );

    event MarginRemoved(
        address trader,
        uint256 marginRemoved,
        IPositionManager positionManager
    );

    event CancelLimitOrder(
        address trader,
        address _positionManager,
        uint128 pip,
        uint64 orderId
    );

    event Liquidated(address pmAddress, address trader);

    event WhitelistPositionManagerAdded(address pmAddress);

    event WhitelistPositionManagerRemoved(address pmAddress);

    function initialize(
        uint256 _maintenanceMarginRatio,
        uint256 _partialLiquidationRatio,
        uint256 _liquidationFeeRatio,
        uint256 _liquidationPenaltyRatio,
        address _insuranceFund
    ) public initializer {
        __ReentrancyGuard_init();
        __Ownable_init();
        maintenanceMarginRatio = _maintenanceMarginRatio;
        partialLiquidationRatio = _partialLiquidationRatio;
        liquidationFeeRatio = _liquidationFeeRatio;
        liquidationPenaltyRatio = _liquidationPenaltyRatio;
        insuranceFund = IInsuranceFund(_insuranceFund);
    }

    /**
     * @notice open position with price market
     * @param _positionManager IPositionManager address
     * @param _side Side of position LONG or SHORT
     * @param _quantity quantity of size after mul with leverage
     * @param _leverage leverage of position
     */
    function openMarketPosition(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _quantity,
        uint256 _leverage
    ) public whenNotPaused nonReentrant {
        address _trader = _msgSender();
        address _pmAddress = address(_positionManager);
        int256 pQuantity = _side == Position.Side.LONG
            ? int256(_quantity)
            : -int256(_quantity);
        Position.Data memory oldPosition = getPosition(
            _pmAddress,
            _trader
        );
        if (oldPosition.quantity == 0) {
            oldPosition.leverage = 1;
        }
        //leverage must be greater than old position and in range of allowed leverage
        require(
            _leverage >= oldPosition.leverage &&
                _leverage <= 125 &&
                _leverage > 0,
            Errors.VL_INVALID_LEVERAGE
        );
        PositionResp memory pResp;
        // check if old position quantity is the same side with the new one
        if (oldPosition.quantity == 0 || oldPosition.side() == _side) {
            pResp = PositionHouseFunction.increasePosition(
                _pmAddress,
                _side,
                int256(_quantity),
                _leverage,
                _trader,
                oldPosition,
                positionMap[_pmAddress][_trader],
                cumulativePremiumFractions[_pmAddress]
            );
        } else {
            pResp = openReversePosition(
                _positionManager,
                _side,
                pQuantity,
                _leverage,
                _trader,
                oldPosition
            );
        }
        // update position state
        positionMap[_pmAddress][_trader].update(pResp.position);

        if (pResp.marginToVault > 0) {
            //transfer from trader to vault
            uint256 fee = _positionManager.calcFee(pResp.position.openNotional);
            deposit(_positionManager, _trader, pResp.marginToVault.abs(), fee);
        } else if (pResp.marginToVault < 0) {
            // withdraw from vault to user
            withdraw(_positionManager, _trader, pResp.marginToVault.abs());
        }
        emit OpenMarket(
            _trader,
            pQuantity,
            _leverage,
            (pResp.exchangedQuoteAssetAmount * _positionManager.getBasisPoint()) / _quantity,
            _positionManager
        );
    }

    function openLimitOrder(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _uQuantity,
        uint128 _pip,
        uint256 _leverage
    ) public whenNotPaused nonReentrant {
        address _trader = _msgSender();
        OpenLimitResp memory openLimitResp;
        int256 _quantity = _side == Position.Side.LONG
            ? int256(_uQuantity)
            : -int256(_uQuantity);
        (
            openLimitResp.orderId,
            openLimitResp.sizeOut
        ) = _internalOpenLimitOrder(
            _positionManager,
            _trader,
            _pip,
            _quantity,
            _leverage
        );
        if (openLimitResp.sizeOut < _uQuantity) {
            PositionLimitOrder.Data memory _newOrder = PositionLimitOrder.Data({
                pip: _pip,
                orderId: openLimitResp.orderId,
                leverage: uint16(_leverage),
                isBuy: _side == Position.Side.LONG ? 1 : 2,
                entryPrice: 0,
                reduceLimitOrderId: 0,
                reduceQuantity: 0,
                blockNumber: block.number
            });
            _storeLimitOrder(
                _newOrder,
                _positionManager,
                _trader,
                _quantity,
                openLimitResp.sizeOut
            );
        }
        (, uint256 marginToVault, uint256 fee) = _positionManager
            .getNotionalMarginAndFee(_uQuantity, _pip, _leverage);
        deposit(_positionManager, _trader, marginToVault, fee);
        canClaimAmountMap[address(_positionManager)][_trader] += marginToVault;
        emit OpenLimit(
            openLimitResp.orderId,
            _trader,
            _quantity,
            _leverage,
            _pip,
            _positionManager
        );
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
                PositionResp memory closePositionResp = internalClosePosition(
                    _positionManager,
                    _trader,
                    PnlCalcOption.SPOT_PRICE,
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
                    positionMap[_pmAddress][_trader],
                    openNotional,
                    _rawQuantity > 0 ? int256(sizeOut) : -int256(sizeOut),
                    _leverage,
                    cumulativePremiumFractions[_pmAddress]
                );
                positionMap[_pmAddress][_trader].update(newData);
            }
        }
    }

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
            limitOrders[_pmAddress][_trader].push(_newOrder);
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
                    reduceLimitOrders[_pmAddress][_trader].length +
                    1;
                limitOrders[_pmAddress][_trader].push(_newOrder);
            }
            _newOrder.entryPrice = PositionHouseMath.entryPriceFromNotional(
                oldPosition.openNotional,
                oldPosition.quantity.abs(),
                baseBasisPoint
            );
            reduceLimitOrders[_pmAddress][_trader].push(_newOrder);
        }
    }

    /**
     * @dev cancel a limit order
     * @param _positionManager position manager
     * @param _orderIdx order index in the limit orders (increase or reduce) list
     * @param _isReduce is that a reduce limit order?
     * The external service must determine that by a variable in getListOrderPending
     */
    function cancelLimitOrder(
        IPositionManager _positionManager,
        uint64 _orderIdx,
        uint8 _isReduce
    ) external whenNotPaused nonReentrant {
        address _trader = _msgSender();
        address _pmAddress = address(_positionManager);
        // declare a pointer to reduceLimitOrders or limitOrders
        PositionLimitOrder.Data[] storage _orders = _isReduce == 1
            ? reduceLimitOrders[_pmAddress][_trader]
            : limitOrders[_pmAddress][_trader];
        require(_orderIdx < _orders.length, Errors.VL_INVALID_ORDER);
        // save gas
        PositionLimitOrder.Data memory _order = _orders[_orderIdx];
        // blank limit order data
        // we set the deleted order to a blank data
        // because we don't want to mess with order index (orderIdx)
        PositionLimitOrder.Data memory blankLimitOrderData;

        (uint256 refundQuantity, uint256 partialFilled) = _positionManager
            .cancelLimitOrder(_order.pip, _order.orderId);
        if (partialFilled == 0) {
            _orders[_orderIdx] = blankLimitOrderData;
            if (_order.reduceLimitOrderId != 0) {
                reduceLimitOrders[_pmAddress][_trader][
                    _order.reduceLimitOrderId - 1
                ] = blankLimitOrderData;
            }
        }

        (, uint256 _refundMargin, ) = _positionManager.getNotionalMarginAndFee(
            refundQuantity,
            _order.pip,
            _order.leverage
        );
        withdraw(_positionManager, _trader, _refundMargin);
        canClaimAmountMap[_pmAddress][_trader] -= _refundMargin;
        emit CancelLimitOrder(_trader, _pmAddress, _order.pip, _order.orderId);
    }

    /**
     * @notice close position with close market
     * @param _positionManager IPositionManager address
     * @param _quantity want to close
     */
    function closePosition(IPositionManager _positionManager, uint256 _quantity)
        public
    {
        address _trader = _msgSender();
        Position.Data memory positionData = getPosition(
            address(_positionManager),
            _trader
        );
        require(
            _quantity > 0 && _quantity <= positionData.quantity.abs(),
            Errors.VL_INVALID_CLOSE_QUANTITY
        );
        openMarketPosition(
            _positionManager,
            positionData.quantity > 0
                ? Position.Side.SHORT
                : Position.Side.LONG,
            _quantity,
            positionData.leverage
        );
    }

    /**
     * @notice close position with close market
     * @param _positionManager IPositionManager address
     * @param _pip limit price want to close
     * @param _quantity want to close
     */
    function closeLimitPosition(
        IPositionManager _positionManager,
        uint128 _pip,
        uint256 _quantity
    ) public {
        address _trader = _msgSender();
        Position.Data memory positionData = getPosition(
            address(_positionManager),
            _trader
        );
        require(
            _quantity > 0 && _quantity <= positionData.quantity.abs(),
            Errors.VL_INVALID_CLOSE_QUANTITY
        );
        openLimitOrder(
            _positionManager,
            positionData.quantity > 0
                ? Position.Side.SHORT
                : Position.Side.LONG,
            _quantity,
            _pip,
            positionData.leverage
        );
    }

    function getClaimAmount(address _pmAddress, address _trader)
        public
        view
        returns (int256 totalClaimableAmount)
    {
        Position.Data memory positionData = getPosition(
            _pmAddress,
            _trader
        );
        return
            PositionHouseFunction.getClaimAmount(
                _pmAddress,
                _trader,
                positionData,
                positionMap[_pmAddress][_trader],
                limitOrders[_pmAddress][_trader],
                reduceLimitOrders[_pmAddress][_trader],
                canClaimAmountMap[_pmAddress][_trader],
                manualMargin[_pmAddress][_trader]
            );
    }

    function claimFund(IPositionManager _positionManager)
        external
        whenNotPaused
        nonReentrant
    {
        address _trader = _msgSender();
        address _pmAddress = address(_positionManager);
        int256 totalRealizedPnl = getClaimAmount(
            _pmAddress,
            _trader
        );
        require(
            getPosition(_pmAddress, _trader).quantity == 0,
            Errors.VL_INVALID_CLAIM_FUND
        );
        clearPosition(_pmAddress, _trader);
        if (totalRealizedPnl > 0) {
            withdraw(_positionManager, _trader, totalRealizedPnl.abs());
        }
    }

    /**
     * @notice liquidate trader's underwater position. Require trader's margin ratio more than partial liquidation ratio
     * @dev liquidator can NOT open any positions in the same block to prevent from price manipulation.
     * @param _positionManager positionManager address
     * @param _trader trader address
     */
    function liquidate(IPositionManager _positionManager, address _trader)
        external
        whenNotPaused
        nonReentrant
    {
        address _caller = _msgSender();
        (, , uint256 marginRatio) = getMaintenanceDetail(
            _positionManager,
            _trader
        );

        require(
            marginRatio >= partialLiquidationRatio,
            Errors.VL_NOT_ENOUGH_MARGIN_RATIO
        );
        address _pmAddress = address(_positionManager);
        PositionResp memory positionResp;
        uint256 liquidationPenalty;
        {
            uint256 feeToLiquidator;
            uint256 feeToInsuranceFund;
            Position.Data memory positionData = getPosition(
                _pmAddress,
                _trader
            );
            // partially liquidate position
            if (marginRatio >= partialLiquidationRatio && marginRatio < 100) {
                // calculate amount quantity of position to reduce
                int256 partiallyLiquidateQuantity = positionData
                    .quantity
                    .getPartiallyLiquidate(liquidationPenaltyRatio);
                // partially liquidate position by reduce position's quantity
                positionResp = partialLiquidate(
                    _positionManager,
                    positionData.quantity > 0
                        ? Position.Side.SHORT
                        : Position.Side.LONG,
                    -partiallyLiquidateQuantity,
                    positionData,
                    _trader
                );

                // half of the liquidationFee goes to liquidator & another half goes to insurance fund
                liquidationPenalty = uint256(positionResp.marginToVault);
                feeToLiquidator = liquidationPenalty / 2;
                feeToInsuranceFund = liquidationPenalty - feeToLiquidator;
            } else {
                // fully liquidate trader's position
                liquidationPenalty =
                    positionData.margin +
                    uint256(manualMargin[_pmAddress][_trader]);
                withdraw(
                    _positionManager,
                    _trader,
                    (uint256(getClaimAmount(_pmAddress, _trader)) +
                        positionData.margin)
                );
                clearPosition(_pmAddress, _trader);
                feeToLiquidator =
                    (liquidationPenalty * liquidationFeeRatio) /
                    2 /
                    100;
            }
            withdraw(_positionManager, _caller, feeToLiquidator);
            // count as bad debt, transfer money to insurance fund and liquidator
        }
        emit Liquidated(_pmAddress, _trader);
    }

    /**
     * @notice add margin to decrease margin ratio
     * @param _positionManager IPositionManager address
     * @param _amount amount of margin to add
     */
    function addMargin(IPositionManager _positionManager, uint256 _amount)
        external
        whenNotPaused
        nonReentrant
    {
        address _trader = _msgSender();
        address _pmAddress = address(_positionManager);
        require(
            getPosition(_pmAddress, _trader).quantity != 0,
            Errors.VL_NO_POSITION_TO_ADD
        );
        manualMargin[_pmAddress][_trader] += int256(
            _amount
        );

        deposit(_positionManager, _trader, _amount, 0);

        emit MarginAdded(_trader, _amount, _positionManager);
    }

    function getAddedMargin(IPositionManager _positionManager, address _trader)
        external
        view
        returns (int256)
    {
        return manualMargin[address(_positionManager)][_trader];
    }

    /**
     * @notice add margin to increase margin ratio
     * @param _positionManager IPositionManager address
     * @param _amount amount of margin to remove
     */
    function removeMargin(IPositionManager _positionManager, uint256 _amount)
        external
        whenNotPaused
        nonReentrant
    {
        address _trader = _msgSender();

        uint256 removableMargin = getRemovableMargin(_positionManager, _trader);
        require(_amount <= removableMargin, Errors.VL_INVALID_REMOVE_MARGIN);

        manualMargin[address(_positionManager)][_trader] -= int256(_amount);

        withdraw(_positionManager, _trader, _amount);

        emit MarginRemoved(_trader, _amount, _positionManager);
    }

    function getRemovableMargin(
        IPositionManager _positionManager,
        address _trader
    ) public view returns (uint256) {
        int256 _marginAdded = manualMargin[address(_positionManager)][_trader];
        (
            uint256 maintenanceMargin,
            int256 marginBalance,

        ) = getMaintenanceDetail(_positionManager, _trader);
        int256 _remainingMargin = marginBalance - int256(maintenanceMargin);
        return
            uint256(
                _marginAdded <= _remainingMargin
                    ? _marginAdded
                    : _remainingMargin.kPositive()
            );
    }

    function clearPosition(address _pmAddress, address _trader)
        internal
    {
        positionMap[_pmAddress][_trader].clear();
        debtPosition[_pmAddress][_trader].clearDebt();
        manualMargin[_pmAddress][_trader] = 0;
        canClaimAmountMap[_pmAddress][_trader] = 0;
        (
            PositionLimitOrder.Data[] memory subListLimitOrders,
            PositionLimitOrder.Data[] memory subReduceLimitOrders
        ) = PositionHouseFunction.clearAllFilledOrder(
                IPositionManager(_pmAddress),
                limitOrders[_pmAddress][_trader],
                reduceLimitOrders[_pmAddress][_trader]
            );
        if (limitOrders[_pmAddress][_trader].length > 0) {
            delete limitOrders[_pmAddress][_trader];
        }
        for (uint256 i = 0; i < subListLimitOrders.length; i++) {
            if (subListLimitOrders[i].pip == 0) {
                break;
            }
            limitOrders[_pmAddress][_trader].push(
                subListLimitOrders[i]
            );
        }
        if (reduceLimitOrders[_pmAddress][_trader].length > 0) {
            delete reduceLimitOrders[_pmAddress][_trader];
        }
        for (uint256 i = 0; i < subReduceLimitOrders.length; i++) {
            if (subReduceLimitOrders[i].pip == 0) {
                break;
            }
            reduceLimitOrders[_pmAddress][_trader].push(
                subReduceLimitOrders[i]
            );
        }
    }

    function openReversePosition(
        IPositionManager _positionManager,
        Position.Side _side,
        int256 _quantity,
        uint256 _leverage,
        address _trader,
        Position.Data memory _oldPosition
    ) internal returns (PositionResp memory positionResp) {
        address _pmAddress = address(_positionManager);
        if (_quantity.abs() < _oldPosition.quantity.abs()) {
            {
                positionResp = PositionHouseFunction.openReversePosition(
                    _pmAddress,
                    _side,
                    _quantity,
                    _leverage,
                    _trader,
                    _oldPosition,
                    positionMap[_pmAddress][_trader],
                    cumulativePremiumFractions[_pmAddress]
                );
                return positionResp;
            }
        }
        // if new position is larger then close old and open new
        return
            closeAndOpenReversePosition(
                _positionManager,
                _side,
                _quantity,
                _leverage,
                _oldPosition
            );
    }

    function closeAndOpenReversePosition(
        IPositionManager _positionManager,
        Position.Side _side,
        int256 _quantity,
        uint256 _leverage,
        Position.Data memory _oldPosition
    ) internal returns (PositionResp memory positionResp) {
        address _trader = _msgSender();
        address _pmAddress = address(_positionManager);
        PositionResp memory closePositionResp = internalClosePosition(
            _positionManager,
            _trader,
            PnlCalcOption.SPOT_PRICE,
            false,
            _oldPosition
        );
        if (_quantity - closePositionResp.exchangedPositionSize == 0) {
            positionResp = closePositionResp;
        } else {
            _oldPosition = getPosition(_pmAddress, _trader);
            PositionResp memory increasePositionResp = PositionHouseFunction
                .increasePosition(
                    address(_positionManager),
                    _side,
                    _quantity - closePositionResp.exchangedPositionSize,
                    _leverage,
                    _trader,
                    _oldPosition,
                    positionMap[_pmAddress][_trader],
                    cumulativePremiumFractions[_pmAddress]
                );
            positionResp = PositionResp({
                position: increasePositionResp.position,
                exchangedQuoteAssetAmount: closePositionResp
                    .exchangedQuoteAssetAmount +
                    increasePositionResp.exchangedQuoteAssetAmount,
                fundingPayment: 0,
                exchangedPositionSize: closePositionResp.exchangedPositionSize +
                    increasePositionResp.exchangedPositionSize,
                realizedPnl: closePositionResp.realizedPnl +
                    increasePositionResp.realizedPnl,
                unrealizedPnl: 0,
                marginToVault: closePositionResp.marginToVault +
                    increasePositionResp.marginToVault
            });
        }
        return positionResp;
    }

    function internalClosePosition(
        IPositionManager _positionManager,
        address _trader,
        PnlCalcOption _pnlCalcOption,
        bool _isInOpenLimit,
        Position.Data memory _oldPosition
    ) internal returns (PositionResp memory positionResp) {
        address _pmAddress = address(_positionManager);
        (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(
            _positionManager,
            _trader,
            _pnlCalcOption,
            _oldPosition
        );
        uint256 openMarketQuantity = _oldPosition.quantity.abs();
        require(
            openMarketQuantity != 0,
            Errors.VL_INVALID_QUANTITY_INTERNAL_CLOSE
        );
        if (_isInOpenLimit) {
            uint256 liquidityInCurrentPip = uint256(
                _positionManager.getLiquidityInCurrentPip()
            );
            openMarketQuantity = liquidityInCurrentPip >
                _oldPosition.quantity.abs()
                ? _oldPosition.quantity.abs()
                : liquidityInCurrentPip;
        }

        (
            positionResp.exchangedPositionSize,
            positionResp.exchangedQuoteAssetAmount
        ) = PositionHouseFunction.openMarketOrder(
            _pmAddress,
            openMarketQuantity,
            _oldPosition.quantity > 0 ? Position.Side.SHORT : Position.Side.LONG,
            _trader
        );

        (
            uint256 remainMargin,
            uint256 badDebt,
            int256 fundingPayment,
        ) = calcRemainMarginWithFundingPayment(
                _positionManager,
                _oldPosition,
                _oldPosition.margin
            );

        positionResp.realizedPnl = unrealizedPnl;
        positionResp.marginToVault = -int256(remainMargin)
            .add(positionResp.realizedPnl)
            .add(manualMargin[_pmAddress][_trader])
            .kPositive();
        positionResp.unrealizedPnl = 0;
        canClaimAmountMap[_pmAddress][_trader] = 0;
        clearPosition(_pmAddress, _trader);
    }

    function getListOrderPending(
        IPositionManager _positionManager,
        address _trader
    ) public view returns (LimitOrderPending[] memory) {
        address _pmAddress = address(_positionManager);
        return
            PositionHouseFunction.getListOrderPending(
                _pmAddress,
                _trader,
                limitOrders[_pmAddress][_trader],
                reduceLimitOrders[_pmAddress][_trader]
            );
    }

    function getPosition(address _pmAddress, address _trader)
        public
        view
        returns (Position.Data memory positionData)
    {
        positionData = positionMap[_pmAddress][_trader];
        PositionLimitOrder.Data[] memory _limitOrders = limitOrders[
            _pmAddress
        ][_trader];
        PositionLimitOrder.Data[] memory _reduceOrders = reduceLimitOrders[
            _pmAddress
        ][_trader];
        positionData = PositionHouseFunction.calculateLimitOrder(
            _pmAddress,
            _limitOrders,
            _reduceOrders,
            positionData
        );
        positionData.margin += uint256(manualMargin[_pmAddress][_trader]);
        Position.LiquidatedData memory _debtPosition = debtPosition[
            _pmAddress
        ][_trader];
        if (_debtPosition.margin != 0) {
            positionData.quantity -= _debtPosition.quantity;
            positionData.margin -= _debtPosition.margin;
            positionData.openNotional -= _debtPosition.notional;
        }
    }

    function getPositionNotionalAndUnrealizedPnl(
        IPositionManager _positionManager,
        address _trader,
        PnlCalcOption _pnlCalcOption,
        Position.Data memory _oldPosition
    ) public view returns (uint256 positionNotional, int256 unrealizedPnl) {
        (positionNotional, unrealizedPnl) = PositionHouseFunction
            .getPositionNotionalAndUnrealizedPnl(
                address(_positionManager),
                _trader,
                _pnlCalcOption,
                _oldPosition
            );
    }

    //    function getLiquidationPrice(
    //        IPositionManager positionManager,
    //        address _trader,
    //        PnlCalcOption _pnlCalcOption
    //    ) public view returns (uint256 liquidationPrice){
    //        Position.Data memory positionData = getPosition(address(positionManager), _trader);
    //        (uint256 maintenanceMargin,,) = getMaintenanceDetail(positionManager, _trader);
    //        if (positionData.side() == Position.Side.LONG) {
    //            liquidationPrice = (maintenanceMargin - positionData.margin + positionData.openNotional) / positionData.quantity.abs();
    //        } else {
    //            liquidationPrice = (positionData.openNotional - maintenanceMargin + positionData.margin) / positionData.quantity.abs();
    //        }
    //    }

    function getMaintenanceDetail(
        IPositionManager _positionManager,
        address _trader
    )
        public
        view
        returns (
            uint256 maintenanceMargin,
            int256 marginBalance,
            uint256 marginRatio
        )
    {
        address _pmAddress = address(_positionManager);
        Position.Data memory positionData = getPosition(
            _pmAddress,
            _trader
        );
        (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(
            _positionManager,
            _trader,
            PnlCalcOption.SPOT_PRICE,
            positionData
        );
        (
            uint256 remainMarginWithFundingPayment,
            ,
            ,

        ) = calcRemainMarginWithFundingPayment(
                _positionManager,
                positionData,
                positionData.margin
            );
        maintenanceMargin =
            ((remainMarginWithFundingPayment -
                uint256(manualMargin[_pmAddress][_trader])) *
                maintenanceMarginRatio) /
            100;
        marginBalance = int256(remainMarginWithFundingPayment) + unrealizedPnl;
        marginRatio = marginBalance <= 0
            ? 100
            : (maintenanceMargin * 100) / uint256(marginBalance);
    }

    function getLatestCumulativePremiumFraction(
        IPositionManager _positionManager
    ) public view returns (int256) {
        uint256 len = cumulativePremiumFractions[address(_positionManager)]
            .length;
        if (len > 0) {
            return
                cumulativePremiumFractions[address(_positionManager)][len - 1];
        }
        return 0;
    }

    function payFunding(IPositionManager _positionManager) external onlyOwner {
        int256 premiumFraction = _positionManager.settleFunding();
        cumulativePremiumFractions[address(_positionManager)].push(
            premiumFraction +
                getLatestCumulativePremiumFraction(_positionManager)
        );
    }

    function withdraw(
        IPositionManager _positionManager,
        address _trader,
        uint256 _amount
    ) internal onlyWhitelistManager(address(_positionManager)) {
        insuranceFund.withdraw(
            address(_positionManager.getQuoteAsset()),
            _trader,
            _amount
        );
    }

    function deposit(
        IPositionManager _positionManager,
        address _trader,
        uint256 _amount,
        uint256 _fee
    ) internal onlyWhitelistManager(address(_positionManager)) {
        insuranceFund.deposit(
            address(_positionManager.getQuoteAsset()),
            _trader,
            _amount + _fee
        );
        insuranceFund.updateTotalFee(_fee);
    }

    //
    // INTERNAL FUNCTION OF POSITION HOUSE
    //

    function calcRemainMarginWithFundingPayment(
        IPositionManager _positionManager,
        Position.Data memory _oldPosition,
        uint256 _pMargin
    )
        internal
        view
        returns (
            uint256 remainMargin,
            uint256 badDebt,
            int256 fundingPayment,
            int256 latestCumulativePremiumFraction
        )
    {
        // calculate fundingPayment
        latestCumulativePremiumFraction = getLatestCumulativePremiumFraction(
            _positionManager
        );
        if (_oldPosition.quantity != 0) {
            fundingPayment =
                (latestCumulativePremiumFraction -
                    _oldPosition.lastUpdatedCumulativePremiumFraction) *
                _oldPosition.quantity;
        }

        // calculate remain margin, if remain margin is negative, set to zero and leave the rest to bad debt
        if (int256(_pMargin) + fundingPayment >= 0) {
            remainMargin = uint256(int256(_pMargin) + fundingPayment);
        } else {
            badDebt = uint256(-fundingPayment - int256(_pMargin));
        }
    }

    function partialLiquidate(
        IPositionManager _positionManager,
        Position.Side _side,
        int256 _quantity,
        Position.Data memory _oldPosition,
        address _trader
    ) internal returns (PositionResp memory positionResp) {
        address _pmAddress = address(_positionManager);
        (positionResp.exchangedPositionSize, ) = PositionHouseFunction
            .openMarketOrder(
                _pmAddress,
                _quantity.abs(),
                _side,
                _trader
            );
        positionResp.exchangedQuoteAssetAmount = _quantity
            .getExchangedQuoteAssetAmount(
                _oldPosition.openNotional,
                _oldPosition.quantity.abs()
            );
        (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(
            _positionManager,
            _trader,
            PnlCalcOption.SPOT_PRICE,
            _oldPosition
        );
        // TODO need to calculate remain margin with funding payment
        uint256 remainMargin = (_oldPosition.margin *
            (100 - liquidationFeeRatio)) / 100;
        // unchecked
        positionResp.marginToVault =
            int256(_oldPosition.margin) -
            int256(remainMargin);
        positionResp.unrealizedPnl = unrealizedPnl;
        debtPosition[_pmAddress][_trader].updateDebt(
            -_quantity,
            _oldPosition.margin - remainMargin,
            positionResp.exchangedQuoteAssetAmount
        );
        return positionResp;
    }

    // UPDATE VARIABLE STORAGE

    function updatePartialLiquidationRatio(uint256 _partialLiquidationRatio)
        public
        onlyOwner
    {
        partialLiquidationRatio = _partialLiquidationRatio;
    }

    function updateLiquidationPenaltyRatio(uint256 _liquidationPenaltyRatio)
        public
        onlyOwner
    {
        liquidationPenaltyRatio = _liquidationPenaltyRatio;
    }

    function isWhitelistManager(address _positionManager) public view returns (bool) {
        return whitelistManager[_positionManager];
    }

    function setWhitelistManager(address _positionManager) public onlyOwner {
        whitelistManager[_positionManager] = true;
        emit WhitelistPositionManagerAdded(_positionManager);
    }

    function removeWhitelistManager(address _positionManager) public onlyOwner {
        whitelistManager[_positionManager] = false;
        emit WhitelistPositionManagerRemoved(_positionManager);
    }

    modifier onlyWhitelistManager(address _positionManager) {
        require(isWhitelistManager(_positionManager), Errors.VL_NOT_WHITELIST_MANAGER);
        _;
    }

    function setPauseStatus(bool _isPause) public onlyOwner {
        if(_isPause) {
            _pause();
        }else{
            _unpause();
        }
    }

    // NEW REQUIRE: restriction mode
    // In restriction mode, no one can do multi open/close/liquidate position in the same block.
    // If any underwater position being closed (having a bad debt and make insuranceFund loss),
    // or any liquidation happened,
    // restriction mode is ON in that block and OFF(default) in the next block.
    // This design is to prevent the attacker being benefited from the multiple action in one block
    //    function requireNotRestrictionMode(IAmm _amm) private view {
    //        uint256 currentBlock = _blockNumber();
    //        if (currentBlock == positionManagerMap[address].lastRestrictionBlock) {
    //            // only one action allowed
    //
    //        }
    //    }
}
