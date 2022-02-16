// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;

import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
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
    PositionHouseStorage
{
    using PositionLimitOrder for mapping(address => mapping(address => PositionLimitOrder.Data[]));
    using Quantity for int256;
    using Int256Math for int256;
    using Quantity for int128;

    using Position for Position.Data;
    using Position for Position.LiquidatedData;
    using PositionHouseFunction for PositionHouse;

    //    modifier whenNotPaused() {
    //        require(!paused, "Pausable: paused");
    //        _;
    //    }

    event OpenMarket(
        address trader,
        int256 quantity,
        uint256 leverage,
        uint256 priceMarket,
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

    event AddMargin(
        address trader,
        uint256 marginAdded,
        IPositionManager positionManager
    );

    event RemoveMargin(
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

    event Liquidate(address positionManager, address trader);

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
        paused = false;
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
        address pmAddr = address(_positionManager);
        int256 pQuantity = _side == Position.Side.LONG
            ? int256(_quantity)
            : -int256(_quantity);
        Position.Data memory oldPosition = getPosition(
            address(_positionManager),
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
                pmAddr,
                _side,
                int256(_quantity),
                _leverage,
                _trader,
                oldPosition,
                positionMap[pmAddr][_trader],
                cumulativePremiumFractions[pmAddr]
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
        positionMap[pmAddr][_trader].update(pResp.position);

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
            pResp.exchangedQuoteAssetAmount / _quantity,
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
                    sizeOut,
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
        address positionManagerAddress = address(_positionManager);
        Position.Data memory oldPosition = getPosition(
            positionManagerAddress,
            _trader
        );
        if (
            oldPosition.quantity == 0 ||
            _quantity.isSameSide(oldPosition.quantity)
        ) {
            limitOrders[positionManagerAddress][_trader].push(_newOrder);
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
                    reduceLimitOrders[positionManagerAddress][_trader].length +
                    1;
                limitOrders[positionManagerAddress][_trader].push(_newOrder);
            }
            _newOrder.entryPrice = PositionHouseMath.entryPriceFromNotional(
                oldPosition.openNotional,
                oldPosition.quantity.abs(),
                baseBasisPoint
            );
            reduceLimitOrders[positionManagerAddress][_trader].push(_newOrder);
        }
    }

    /**
     * @dev cancel a limit order
     * @param _positionManager position manager
     * @param _orderIdx order index in the limit orders (increase or reduce) list
     * @param _isReduce is that a reduce limit order?
     * The external service must determine that by a variable in getListPendingOrders
     */
    function cancelLimitOrder(
        IPositionManager _positionManager,
        uint64 _orderIdx,
        bool _isReduce
    ) external whenNotPaused nonReentrant {
        address _trader = _msgSender();
        address _pmAddress = address(_positionManager);
        // declare a pointer to reduceLimitOrders or limitOrders
        PositionLimitOrder.Data[] storage _orders = _isReduce
            ? reduceLimitOrders[_pmAddress][_trader]
            : limitOrders[_pmAddress][_trader];
        require(_orderIdx < _orders.length, "invalid order");
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

    function getClaimAmount(address _positionManager, address _trader)
        public
        view
        returns (int256 totalClaimableAmount)
    {
        Position.Data memory positionData = getPosition(
            _positionManager,
            _trader
        );
        return
            PositionHouseFunction.getClaimAmount(
                _positionManager,
                _trader,
                positionData,
                limitOrders[_positionManager][_trader],
                reduceLimitOrders[_positionManager][_trader],
                positionMap[_positionManager][_trader],
                canClaimAmountMap[_positionManager][_trader],
                manualMargin[_positionManager][_trader]
            );
    }

    function claimFund(IPositionManager _positionManager)
        external
        whenNotPaused
        nonReentrant
    {
        address _trader = _msgSender();
        address positionManagerAddress = address(_positionManager);
        int256 totalRealizedPnl = getClaimAmount(
            positionManagerAddress,
            _trader
        );
        require(
            getPosition(positionManagerAddress, _trader).quantity == 0,
            Errors.VL_INVALID_CLAIM_FUND
        );
        clearPosition(positionManagerAddress, _trader);
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
        address positionManagerAddress = address(_positionManager);
        PositionResp memory positionResp;
        uint256 liquidationPenalty;
        {
            uint256 feeToLiquidator;
            uint256 feeToInsuranceFund;
            Position.Data memory positionData = getPosition(
                positionManagerAddress,
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
                    uint256(manualMargin[positionManagerAddress][_trader]);
                withdraw(
                    _positionManager,
                    _trader,
                    (uint256(getClaimAmount(positionManagerAddress, _trader)) +
                        positionData.margin)
                );
                clearPosition(positionManagerAddress, _trader);
                feeToLiquidator =
                    (liquidationPenalty * liquidationFeeRatio) /
                    2 /
                    100;
            }
            withdraw(_positionManager, _caller, feeToLiquidator);
            // count as bad debt, transfer money to insurance fund and liquidator
        }
        emit Liquidate(address(_positionManager), _trader);
    }

    /**
     * @notice add margin to decrease margin ratio
     * @param _positionManager IPositionManager address
     * @param _marginAdded added margin
     */
    function addMargin(IPositionManager _positionManager, uint256 _marginAdded)
        external
        whenNotPaused
        nonReentrant
    {
        address _trader = _msgSender();
        require(
            getPosition(address(_positionManager), _trader).quantity != 0,
            Errors.VL_NO_POSITION_TO_ADD
        );
        manualMargin[address(_positionManager)][_trader] += int256(
            _marginAdded
        );

        deposit(_positionManager, _trader, _marginAdded, 0);

        emit AddMargin(_trader, _marginAdded, _positionManager);
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
     * @param _amount amount to remove
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

        emit RemoveMargin(_trader, _amount, _positionManager);
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

    function clearPosition(address positionManagerAddress, address _trader)
        internal
    {
        positionMap[positionManagerAddress][_trader].clear();
        debtPosition[positionManagerAddress][_trader].clearDebt();
        manualMargin[positionManagerAddress][_trader] = 0;
        canClaimAmountMap[positionManagerAddress][_trader] = 0;
        (
            PositionLimitOrder.Data[] memory subListLimitOrder,
            PositionLimitOrder.Data[] memory subReduceLimitOrder
        ) = PositionHouseFunction.clearAllFilledOrder(
                IPositionManager(positionManagerAddress),
                limitOrders[positionManagerAddress][_trader],
                reduceLimitOrders[positionManagerAddress][_trader]
            );
        if (limitOrders[positionManagerAddress][_trader].length > 0) {
            delete limitOrders[positionManagerAddress][_trader];
        }
        for (uint256 i = 0; i < subListLimitOrder.length; i++) {
            if (subListLimitOrder[i].pip == 0) {
                break;
            }
            limitOrders[positionManagerAddress][_trader].push(
                subListLimitOrder[i]
            );
        }
        if (reduceLimitOrders[positionManagerAddress][_trader].length > 0) {
            delete reduceLimitOrders[positionManagerAddress][_trader];
        }
        for (uint256 i = 0; i < subReduceLimitOrder.length; i++) {
            if (subReduceLimitOrder[i].pip == 0) {
                break;
            }
            reduceLimitOrders[positionManagerAddress][_trader].push(
                subReduceLimitOrder[i]
            );
        }
    }

    function openReversePosition(
        IPositionManager _positionManager,
        Position.Side _side,
        int256 _quantity,
        uint256 _leverage,
        address _trader,
        Position.Data memory oldPosition
    ) internal returns (PositionResp memory positionResp) {
        address positionManagerAddress = address(_positionManager);
        if (_quantity.abs() < oldPosition.quantity.abs()) {
            {
                positionResp = PositionHouseFunction.openReversePosition(
                    positionManagerAddress,
                    _side,
                    _quantity,
                    _leverage,
                    _trader,
                    oldPosition,
                    positionMap[positionManagerAddress][_trader],
                    cumulativePremiumFractions[positionManagerAddress]
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
                oldPosition
            );
    }

    function closeAndOpenReversePosition(
        IPositionManager _positionManager,
        Position.Side _side,
        int256 _quantity,
        uint256 _leverage,
        Position.Data memory oldPosition
    ) internal returns (PositionResp memory positionResp) {
        address _trader = _msgSender();
        address positionManagerAddress = address(_positionManager);
        PositionResp memory closePositionResp = internalClosePosition(
            _positionManager,
            _trader,
            PnlCalcOption.SPOT_PRICE,
            false,
            oldPosition
        );
        if (_quantity - closePositionResp.exchangedPositionSize == 0) {
            positionResp = closePositionResp;
        } else {
            oldPosition = getPosition(positionManagerAddress, _trader);
            PositionResp memory increasePositionResp = PositionHouseFunction
                .increasePosition(
                    address(_positionManager),
                    _side,
                    _quantity - closePositionResp.exchangedPositionSize,
                    _leverage,
                    _trader,
                    oldPosition,
                    positionMap[positionManagerAddress][_trader],
                    cumulativePremiumFractions[positionManagerAddress]
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
        bool isInOpenLimit,
        Position.Data memory oldPosition
    ) internal returns (PositionResp memory positionResp) {
        address positionManagerAddress = address(_positionManager);
        (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(
            _positionManager,
            _trader,
            _pnlCalcOption,
            oldPosition
        );
        uint256 openMarketQuantity = oldPosition.quantity.abs();
        require(
            openMarketQuantity != 0,
            Errors.VL_INVALID_QUANTITY_INTERNAL_CLOSE
        );
        if (isInOpenLimit) {
            uint256 liquidityInCurrentPip = uint256(
                _positionManager.getLiquidityInCurrentPip()
            );
            openMarketQuantity = liquidityInCurrentPip >
                oldPosition.quantity.abs()
                ? oldPosition.quantity.abs()
                : liquidityInCurrentPip;
        }

        (
            positionResp.exchangedPositionSize,
            positionResp.exchangedQuoteAssetAmount
        ) = PositionHouseFunction.openMarketOrder(
            positionManagerAddress,
            openMarketQuantity,
            oldPosition.quantity > 0 ? Position.Side.SHORT : Position.Side.LONG,
            _trader
        );

        (
            uint256 remainMargin,
            uint256 badDebt,
            int256 fundingPayment,

        ) = calcRemainMarginWithFundingPayment(
                _positionManager,
                oldPosition,
                oldPosition.margin
            );

        positionResp.realizedPnl = unrealizedPnl;
        positionResp.marginToVault = -int256(remainMargin)
            .add(positionResp.realizedPnl)
            .add(manualMargin[positionManagerAddress][_trader])
            .kPositive();
        //        int256 _marginToVault = int256(remainMargin) + positionResp.realizedPnl + manualMargin[address(_positionManager)][_trader];
        //        positionResp.marginToVault = - (_marginToVault < 0 ? 0 : _marginToVault);
        positionResp.unrealizedPnl = 0;
        canClaimAmountMap[positionManagerAddress][_trader] = 0;
        clearPosition(positionManagerAddress, _trader);
    }

    function getListOrderPending(
        IPositionManager _positionManager,
        address _trader
    ) public view returns (LimitOrderPending[] memory) {
        return
            PositionHouseFunction.getListOrderPending(
                address(_positionManager),
                _trader,
                limitOrders[address(_positionManager)][_trader],
                reduceLimitOrders[address(_positionManager)][_trader]
            );
    }

    function getPosition(address positionManager, address _trader)
        public
        view
        returns (Position.Data memory positionData)
    {
        positionData = positionMap[positionManager][_trader];
        PositionLimitOrder.Data[] memory _limitOrders = limitOrders[
            positionManager
        ][_trader];
        PositionLimitOrder.Data[] memory _reduceOrders = reduceLimitOrders[
            positionManager
        ][_trader];
        positionData = PositionHouseFunction.calculateLimitOrder(
            positionManager,
            _limitOrders,
            _reduceOrders,
            positionData
        );
        positionData.margin += uint256(manualMargin[positionManager][_trader]);
        Position.LiquidatedData memory _debtPosition = debtPosition[
            positionManager
        ][_trader];
        if (_debtPosition.margin != 0) {
            positionData.quantity -= _debtPosition.quantity;
            positionData.margin -= _debtPosition.margin;
            positionData.openNotional -= _debtPosition.notional;
        }
    }

    function getPositionNotionalAndUnrealizedPnl(
        IPositionManager positionManager,
        address _trader,
        PnlCalcOption _pnlCalcOption,
        Position.Data memory oldPosition
    ) public view returns (uint256 positionNotional, int256 unrealizedPnl) {
        (positionNotional, unrealizedPnl) = PositionHouseFunction
            .getPositionNotionalAndUnrealizedPnl(
                address(positionManager),
                _trader,
                _pnlCalcOption,
                oldPosition
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
        Position.Data memory positionData = getPosition(
            address(_positionManager),
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
                uint256(manualMargin[address(_positionManager)][_trader])) *
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
        uint256 amount
    ) internal {
        insuranceFund.withdraw(
            address(_positionManager.getQuoteAsset()),
            _trader,
            amount
        );
    }

    function deposit(
        IPositionManager _positionManager,
        address _trader,
        uint256 amount,
        uint256 fee
    ) internal {
        insuranceFund.deposit(
            address(_positionManager.getQuoteAsset()),
            _trader,
            amount + fee
        );
        insuranceFund.updateTotalFee(fee);
    }

    //
    // INTERNAL FUNCTION OF POSITION HOUSE
    //

    function calcRemainMarginWithFundingPayment(
        IPositionManager _positionManager,
        Position.Data memory oldPosition,
        uint256 deltaMargin
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
        if (oldPosition.quantity != 0) {
            fundingPayment =
                (latestCumulativePremiumFraction -
                    oldPosition.lastUpdatedCumulativePremiumFraction) *
                oldPosition.quantity;
        }

        // calculate remain margin, if remain margin is negative, set to zero and leave the rest to bad debt
        if (int256(deltaMargin) + fundingPayment >= 0) {
            remainMargin = uint256(int256(deltaMargin) + fundingPayment);
        } else {
            badDebt = uint256(-fundingPayment - int256(deltaMargin));
        }
    }

    // TODO can move to position house function
    function partialLiquidate(
        IPositionManager _positionManager,
        Position.Side _side,
        int256 _quantity,
        Position.Data memory oldPosition,
        address _trader
    ) internal returns (PositionResp memory positionResp) {
        (positionResp.exchangedPositionSize, ) = PositionHouseFunction
            .openMarketOrder(
                address(_positionManager),
                _quantity.abs(),
                _side,
                _trader
            );
        positionResp.exchangedQuoteAssetAmount = _quantity
            .getExchangedQuoteAssetAmount(
                oldPosition.openNotional,
                oldPosition.quantity.abs()
            );
        (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(
            _positionManager,
            _trader,
            PnlCalcOption.SPOT_PRICE,
            oldPosition
        );
        // TODO need to calculate remain margin with funding payment
        uint256 remainMargin = (oldPosition.margin *
            (100 - liquidationFeeRatio)) / 100;
        // unchecked
        positionResp.marginToVault =
            int256(oldPosition.margin) -
            int256(remainMargin);
        positionResp.unrealizedPnl = unrealizedPnl;
        debtPosition[address(_positionManager)][_trader].updateDebt(
            -_quantity,
            oldPosition.margin - remainMargin,
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

    modifier whenNotPaused() {
        //        require(!paused, "Pausable: paused");
        _;
    }

    modifier whenPaused() {
        //        require(paused, "Pausable: not paused");
        _;
    }

    //    function pause() public onlyOwner whenNotPaused {
    //        paused = true;
    //    }
    //
    //    function unpause() public onlyOwner whenPaused {
    //        paused = false;
    //    }

    //    function pause() public onlyOwner whenNotPaused {
    //        paused = true;
    //    }
    //
    //    function unpause() public onlyOwner {
    //        require(paused, "Pausable: not paused");
    //        paused = false;
    //    }

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
