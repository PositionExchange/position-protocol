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
import "./libraries/helpers/Quantity.sol";
import "./libraries/position/PositionLimitOrder.sol";
import "../interfaces/IInsuranceFund.sol";
import "./libraries/types/PositionHouseStorage.sol";
import {PositionHouseFunction} from "./libraries/position/PositionHouseFunction.sol";
import {PositionHouseMath} from "./libraries/position/PositionHouseMath.sol";
import {Errors} from "./libraries/helpers/Errors.sol";
import {Int256Math} from "./libraries/helpers/Int256Math.sol";
import {CumulativePremiumFractions} from "./modules/CumulativePremiumFractions.sol";
import {LimitOrderManager} from "./modules/LimitOrder.sol";
import {ClaimableAmountManager} from "./modules/ClaimableAmountManager.sol";
import {MarketMakerLogic} from "./modules/MarketMaker.sol";

// TODO remove on production
import "hardhat/console.sol";

contract PositionHouse is
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    CumulativePremiumFractions,
    ClaimableAmountManager,
    PositionHouseStorage,
    LimitOrderManager,
    PausableUpgradeable,
    MarketMakerLogic
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
        uint16 leverage,
        uint256 entryPrice,
        IPositionManager positionManager
    );

//    event MarginAdded(
//        address trader,
//        uint256 marginAdded,
//        IPositionManager positionManager
//    );
//
//    event MarginRemoved(
//        address trader,
//        uint256 marginRemoved,
//        IPositionManager positionManager
//    );

    event FullyLiquidated(address pmAddress, address trader);
    event PartiallyLiquidated(address pmAddress, address trader);
//    event WhitelistManagerUpdated(address positionManager, bool isWhitelite);

    function initialize(
        address _insuranceFund,
        IPositionHouseConfigurationProxy _positionHouseConfigurationProxy
    ) public initializer {
        __ReentrancyGuard_init();
        __Ownable_init();
        insuranceFund = IInsuranceFund(_insuranceFund);
        positionHouseConfigurationProxy = _positionHouseConfigurationProxy;
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
        uint16 _leverage
    ) external whenNotPaused nonReentrant {
        address _pmAddress = address (_positionManager);
        address _trader = _msgSender();
        Position.Data memory _positionData = getPosition(address(_positionManager), _msgSender());
        (bool _needClaim, int256 _claimAbleAmount) = _needToClaimFund(_pmAddress, _trader, getPosition(_pmAddress, _trader));
        if (_needClaim) {
            _internalClaimFund(_positionManager, _positionData, _claimAbleAmount);
        }
        _internalOpenMarketPosition(
            _positionManager,
            _side,
            _quantity,
            _leverage,
            _positionData
        );
    }

    function openLimitOrder(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _uQuantity,
        uint128 _pip,
        uint16 _leverage
    ) external whenNotPaused nonReentrant {
        address _pmAddress = address (_positionManager);
        address _trader = _msgSender();
        Position.Data memory _positionData = getPosition(address(_positionManager), _msgSender());
        require(_requireSideOrder(_pmAddress, _trader, _side),Errors.VL_MUST_SAME_SIDE);
        (bool _needClaim, int256 _claimAbleAmount) = _needToClaimFund(_pmAddress, _trader, _positionData);
        if (_needClaim) {
            _internalClaimFund(_positionManager, _positionData, _claimAbleAmount);
        }
        _internalOpenLimitOrder(
            _positionManager,
            _side,
            _uQuantity,
            _pip,
            _leverage,
            _positionData
        );
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
        _internalCancelLimitOrder(_positionManager, _orderIdx, _isReduce);
    }

    /**
     * @notice close position with close market
     * @param _positionManager IPositionManager address
     * @param _quantity want to close
     */
    function closePosition(IPositionManager _positionManager, uint256 _quantity)
        external
        whenNotPaused
        nonReentrant
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
        _internalOpenMarketPosition(
            _positionManager,
            positionData.quantity > 0
                ? Position.Side.SHORT
                : Position.Side.LONG,
            _quantity,
            positionData.leverage,
            positionData
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
    ) external whenNotPaused nonReentrant {
        address _trader = _msgSender();
        Position.Data memory positionData = getPosition(
            address(_positionManager),
            _trader
        );
        require(
            _quantity > 0 && _quantity <= positionData.quantity.abs(),
            Errors.VL_INVALID_CLOSE_QUANTITY
        );
        _internalOpenLimitOrder(
            _positionManager,
            positionData.quantity > 0
                ? Position.Side.SHORT
                : Position.Side.LONG,
            _quantity,
            _pip,
            positionData.leverage,
            positionData
        );
    }

    function claimFund(IPositionManager _positionManager)
        external
        whenNotPaused
        nonReentrant
    {
        Position.Data memory _positionData = getPosition(address(_positionManager), _msgSender());
        require(
            _positionData.quantity == 0,
            Errors.VL_INVALID_CLAIM_FUND
        );
        _internalClaimFund(_positionManager, _positionData, 0);
    }

    function _internalClaimFund(IPositionManager _positionManager, Position.Data memory _positionData, int256 totalRealizedPnl) internal {
        address _trader = _msgSender();
        address _pmAddress = address(_positionManager);
        if(totalRealizedPnl == 0){
            totalRealizedPnl = _getClaimAmount(
                _pmAddress,
                _trader,
                _positionData,
                _getPositionMap(_pmAddress, _trader),
                _getLimitOrders(_pmAddress, _trader),
                _getReduceLimitOrders(_pmAddress, _trader),
                getClaimableAmount(_pmAddress, _trader),
                _getManualMargin(_pmAddress, _trader)
            );
        }
        clearPosition(_pmAddress, _trader);
        if (totalRealizedPnl > 0) {
            _withdraw(_pmAddress, _trader, totalRealizedPnl.abs());
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
            _trader,
            PnlCalcOption.ORACLE
        );
        uint256 _partialLiquidationRatio = positionHouseConfigurationProxy.partialLiquidationRatio();
        require(
            marginRatio >= _partialLiquidationRatio,
            Errors.VL_NOT_ENOUGH_MARGIN_RATIO
        );
        address _pmAddress = address(_positionManager);
        PositionResp memory positionResp;
        uint256 liquidationPenalty;
        {
            uint256 feeToLiquidator;
            Position.Data memory positionData = getPosition(
                _pmAddress,
                _trader
            );
            (uint256 _liquidationFeeRatio, uint256 _liquidationPenaltyRatio) = positionHouseConfigurationProxy.getLiquidationRatio();
            // partially liquidate position
            if (marginRatio >= _partialLiquidationRatio && marginRatio < 100) {
                // calculate amount quantity of position to reduce
                int256 partiallyLiquidateQuantity = positionData
                    .quantity
                    .getPartiallyLiquidate(_liquidationPenaltyRatio);
                // partially liquidate position by reduce position's quantity
                positionResp = partialLiquidate(
                    _positionManager,
                    -partiallyLiquidateQuantity,
                    positionData,
                    _trader
                );

                // half of the liquidationFee goes to liquidator & another half goes to insurance fund
                liquidationPenalty = uint256(positionResp.marginToVault);
                feeToLiquidator = liquidationPenalty / 2;
                uint256 feeToInsuranceFund = liquidationPenalty - feeToLiquidator;
                emit PartiallyLiquidated(_pmAddress, _trader);
            } else {
                // fully liquidate trader's position
                liquidationPenalty =
                    positionData.margin +
                    uint256(manualMargin[_pmAddress][_trader]);
                clearPosition(_pmAddress, _trader);
                feeToLiquidator =
                    (liquidationPenalty * _liquidationFeeRatio) /
                    2 /
                    100;
                emit FullyLiquidated(_pmAddress, _trader);
            }
            _withdraw(_pmAddress, _caller, feeToLiquidator);
            // count as bad debt, transfer money to insurance fund and liquidator
        }
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
        manualMargin[_pmAddress][_trader] += int256(_amount);

        _deposit(_pmAddress, _trader, _amount, 0);

//        emit MarginAdded(_trader, _amount, _positionManager);
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

        _withdraw(address(_positionManager), _trader, _amount);

//        emit MarginRemoved(_trader, _amount, _positionManager);
    }

    // OWNER UPDATE VARIABLE STORAGE

    function setPauseStatus(bool _isPause) external onlyOwner {
        if (_isPause) {
            _pause();
        } else {
            _unpause();
        }
    }

    // PUBLIC VIEW QUERY

    function getAddedMargin(address _positionManager, address _trader)
    external
    view
    returns (int256)
    {
        return manualMargin[_positionManager][_trader];
    }

    function getRemovableMargin(
        IPositionManager _positionManager,
        address _trader
    ) public view returns (uint256) {
        int256 _marginAdded = manualMargin[address(_positionManager)][_trader];
        (
            uint256 maintenanceMargin,
            int256 marginBalance,

        ) = getMaintenanceDetail(_positionManager, _trader, PnlCalcOption.ORACLE);
        int256 _remainingMargin = marginBalance - int256(maintenanceMargin);
        return
            uint256(
                _marginAdded <= _remainingMargin
                    ? _marginAdded
                    : _remainingMargin.kPositive()
            );
    }

//    function getClaimAmount(address _pmAddress, address _trader)
//        public
//        view
//        returns (int256 totalClaimableAmount)
//    {
//        Position.Data memory positionData = getPosition(_pmAddress, _trader);
//        return
//            PositionHouseFunction.getClaimAmount(
//                _pmAddress,
//                _trader,
//                positionData,
//                _getPositionMap(_pmAddress, _trader),
//                _getLimitOrders(_pmAddress, _trader),
//                _getReduceLimitOrders(_pmAddress, _trader),
//                getClaimableAmount(_pmAddress, _trader),
//                _getManualMargin(_pmAddress, _trader)
//            );
//    }
//
//    function getListOrderPending(
//        IPositionManager _positionManager,
//        address _trader
//    ) public view returns (LimitOrderPending[] memory) {
//        address _pmAddress = address(_positionManager);
//        return
//            PositionHouseFunction.getListOrderPending(
//                _pmAddress,
//                _trader,
//                _getLimitOrders(_pmAddress, _trader),
//                _getReduceLimitOrders(_pmAddress, _trader)
//            );
//    }

    function getPosition(address _pmAddress, address _trader)
        public
        view
        override
        returns (Position.Data memory positionData)
    {
        positionData = positionMap[_pmAddress][_trader];
        PositionLimitOrder.Data[] memory _limitOrders = _getLimitOrders(
            _pmAddress,
            _trader
        );
        PositionLimitOrder.Data[] memory _reduceOrders = _getReduceLimitOrders(
            _pmAddress,
            _trader
        );
        positionData = PositionHouseFunction.calculateLimitOrder(
            _pmAddress,
            _limitOrders,
            _reduceOrders,
            positionData
        );
        positionData.margin += uint256(manualMargin[_pmAddress][_trader]);
        Position.LiquidatedData memory _debtPosition = debtPosition[_pmAddress][
            _trader
        ];
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
    ) internal view returns (uint256 positionNotional, int256 unrealizedPnl) {
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

//    function getFundingPaymentAmount(IPositionManager _positionManager, address _trader) external view returns (int256 fundingPayment) {
//        address _pmAddress = address(_positionManager);
//        Position.Data memory positionData = getPosition(_pmAddress, _trader);
//        (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(
//            _positionManager,
//            _trader,
//            PnlCalcOption.SPOT_PRICE,
//            positionData
//        );
//        (
//        ,
//        ,
//         fundingPayment
//        ,
//
//        ) = calcRemainMarginWithFundingPayment(
//            _pmAddress,
//            positionData,
//            positionData.margin
//        );
//    }

    function getMaintenanceDetail(
        IPositionManager _positionManager,
        address _trader,
        PnlCalcOption _calcOption
    )
        internal
        view
        returns (
            uint256 maintenanceMargin,
            int256 marginBalance,
            uint256 marginRatio
        )
    {
        address _pmAddress = address(_positionManager);
        Position.Data memory positionData = getPosition(_pmAddress, _trader);
        (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(
            _positionManager,
            _trader,
            _calcOption,
            positionData
        );
        (
            uint256 remainMarginWithFundingPayment,
            ,
            ,

        ) = calcRemainMarginWithFundingPayment(
                _pmAddress,
                positionData,
                positionData.margin
            );
        maintenanceMargin =
            ((remainMarginWithFundingPayment -
                uint256(manualMargin[_pmAddress][_trader])) *
                positionHouseConfigurationProxy.maintenanceMarginRatio()) /
            100;
        marginBalance = int256(remainMarginWithFundingPayment) + unrealizedPnl;
        marginRatio = marginBalance <= 0
            ? 100
            : (maintenanceMargin * 100) / uint256(marginBalance);
    }



    function getLatestCumulativePremiumFraction(address _pmAddress)
        public
        view
        override(CumulativePremiumFractions, LimitOrderManager)
        returns (int128)
    {
        return
        CumulativePremiumFractions.getLatestCumulativePremiumFraction(
            _pmAddress
        );
    }

    //
    // INTERNAL FUNCTIONS
    //

    function _internalOpenMarketPosition(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _quantity,
        uint16 _leverage,
        Position.Data memory oldPosition
    ) internal {
        address _trader = _msgSender();
        address _pmAddress = address(_positionManager);
        require(_requireSideOrder(_pmAddress, _trader, _side),Errors.VL_MUST_SAME_SIDE);
        int256 pQuantity = _side == Position.Side.LONG
            ? int256(_quantity)
            : -int256(_quantity);
        require(_requireQuantityOrder(pQuantity, oldPosition.quantity), Errors.VL_MUST_SMALLER_REVERSE_QUANTITY);
        if (oldPosition.quantity == 0) {
            oldPosition.leverage = 1;
        }
        //leverage must be greater than old position and in range of allowed leverage
        require(
            _leverage >= oldPosition.leverage &&
                _leverage <= _positionManager.getLeverage() &&
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
                getLatestCumulativePremiumFraction(_pmAddress)
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
            _deposit(_pmAddress, _trader, pResp.marginToVault.abs(), pResp.fee);
        } else if (pResp.marginToVault < 0) {
            // withdraw from vault to user
            _withdraw(_pmAddress, _trader, pResp.marginToVault.abs());
        }
        emit OpenMarket(
            _trader,
            pQuantity,
            _leverage,
            pResp.entryPrice,
            _positionManager
        );
    }

    function _internalClosePosition(
        IPositionManager _positionManager,
        address _trader,
        PnlCalcOption _pnlCalcOption,
        bool _isInOpenLimit,
        Position.Data memory _oldPosition
    ) internal override returns (PositionResp memory positionResp) {
        address _pmAddress = address(_positionManager);
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
            positionResp.exchangedQuoteAssetAmount,
            positionResp.entryPrice,
            positionResp.fee
        ) = PositionHouseFunction.openMarketOrder(
            _pmAddress,
            openMarketQuantity,
            _oldPosition.quantity > 0
                ? Position.Side.SHORT
                : Position.Side.LONG
        );

        (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(
            _positionManager,
            _trader,
            _pnlCalcOption,
            _oldPosition
        );

        (
            uint256 remainMargin,
            uint256 badDebt,
            int256 fundingPayment,

        ) = calcRemainMarginWithFundingPayment(
                _pmAddress,
                _oldPosition,
                _oldPosition.margin
            );

        positionResp.realizedPnl = unrealizedPnl;
        positionResp.marginToVault = -int256(remainMargin)
            .add(positionResp.realizedPnl)
            .add(manualMargin[_pmAddress][_trader])
            .kPositive();
        positionResp.unrealizedPnl = 0;
        ClaimableAmountManager._reset(_pmAddress, _trader);
        clearPosition(_pmAddress, _trader);
    }

    function clearPosition(address _pmAddress, address _trader) internal {
        positionMap[_pmAddress][_trader].clear();
        debtPosition[_pmAddress][_trader].clearDebt();
        manualMargin[_pmAddress][_trader] = 0;
        ClaimableAmountManager._reset(_pmAddress, _trader);
        (
            PositionLimitOrder.Data[] memory subListLimitOrders,
            PositionLimitOrder.Data[] memory subReduceLimitOrders
        ) = PositionHouseFunction.clearAllFilledOrder(
                IPositionManager(_pmAddress),
                _getLimitOrders(_pmAddress, _trader),
                _getReduceLimitOrders(_pmAddress, _trader)
            );


        _emptyLimitOrders(_pmAddress, _trader);
        for (uint256 i = 0; i < subListLimitOrders.length; i++) {
            if (subListLimitOrders[i].pip == 0) {
                break;
            }
            _pushLimit(_pmAddress, _trader, subListLimitOrders[i]);
        }
        _emptyReduceLimitOrders(_pmAddress, _trader);
        for (uint256 i = 0; i < subReduceLimitOrders.length; i++) {
            if (subReduceLimitOrders[i].pip == 0) {
                break;
            }
            _pushReduceLimit(_pmAddress, _trader, subReduceLimitOrders[i]);
        }
    }

    function openReversePosition(
        IPositionManager _positionManager,
        Position.Side _side,
        int256 _quantity,
        uint16 _leverage,
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
                    getLatestCumulativePremiumFraction(_pmAddress)
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
        uint16 _leverage,
        Position.Data memory _oldPosition
    ) internal returns (PositionResp memory positionResp) {
        address _trader = _msgSender();
        address _pmAddress = address(_positionManager);
        PositionResp memory closePositionResp = _internalClosePosition(
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
                    getLatestCumulativePremiumFraction(_pmAddress)
                );
            positionResp = PositionResp({
                position: increasePositionResp.position,
                exchangedQuoteAssetAmount: closePositionResp
                    .exchangedQuoteAssetAmount +
                    increasePositionResp.exchangedQuoteAssetAmount,
                fundingPayment: increasePositionResp.fundingPayment,
                exchangedPositionSize: closePositionResp.exchangedPositionSize +
                    increasePositionResp.exchangedPositionSize,
                realizedPnl: closePositionResp.realizedPnl +
                    increasePositionResp.realizedPnl,
                unrealizedPnl: 0,
                marginToVault: closePositionResp.marginToVault +
                    increasePositionResp.marginToVault,
                fee: closePositionResp.fee,
                entryPrice: closePositionResp.entryPrice
            });
        }
        return positionResp;
    }


    function partialLiquidate(
        IPositionManager _positionManager,
        int256 _quantity,
        Position.Data memory _oldPosition,
        address _trader
    ) internal returns (PositionResp memory positionResp) {
        address _pmAddress = address(_positionManager);
        (positionResp.exchangedPositionSize, ,, ) = PositionHouseFunction
            .openMarketOrder(_pmAddress, _quantity.abs(), _quantity > 0
                        ? Position.Side.SHORT
                        : Position.Side.LONG);
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
        uint256 _newMargin = PositionHouseMath.calculatePartialLiquidateMargin(
            _oldPosition.margin,
            positionHouseConfigurationProxy.liquidationFeeRatio()
        );
        // unchecked
        positionResp.marginToVault = int256(_newMargin);
        positionResp.unrealizedPnl = unrealizedPnl;
        debtPosition[_pmAddress][_trader].updateDebt(
            -_quantity,
            _newMargin,
            positionResp.exchangedQuoteAssetAmount
        );
        return positionResp;
    }

    function _updatePositionMap(
        address _pmAddress,
        address _trader,
        Position.Data memory newData
    ) internal override {
        positionMap[_pmAddress][_trader].update(newData);
    }

    function _getPositionMap(address _pmAddress, address _trader)
        internal
        view
        override
        returns (Position.Data memory)
    {
        return positionMap[_pmAddress][_trader];
    }

    function _getManualMargin(address _pmAddress, address _trader)
        internal
        view
        override
        returns (int256)
    {
        return manualMargin[_pmAddress][_trader];
    }

    function _deposit(
        address positionManager,
        address trader,
        uint256 amount,
        uint256 fee)
        internal
    {
        insuranceFund.deposit(positionManager, trader, amount, fee);
    }

    function _withdraw(
        address positionManager,
        address trader,
        uint256 amount
    ) internal
    {
        insuranceFund.withdraw(positionManager, trader, amount);
    }


}
