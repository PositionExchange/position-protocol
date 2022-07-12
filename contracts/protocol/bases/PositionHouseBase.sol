// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;

import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "../../interfaces/IPositionManager.sol";
import "../libraries/position/Position.sol";
import "../libraries/helpers/Quantity.sol";
import "../libraries/position/PositionLimitOrder.sol";
import "../../interfaces/IInsuranceFund.sol";
import "../libraries/types/PositionHouseStorage.sol";
import {PositionHouseFunction} from "../libraries/position/PositionHouseFunction.sol";
import {Errors} from "../libraries/helpers/Errors.sol";
import {Int256Math} from "../libraries/helpers/Int256Math.sol";
import {CumulativePremiumFractions} from "../modules/CumulativePremiumFractions.sol";
import {LimitOrderManager} from "../modules/LimitOrder.sol";
import {ClaimableAmountManager} from "../modules/ClaimableAmountManager.sol";
import {MarketMakerLogic} from "../modules/MarketMaker.sol";

import "hardhat/console.sol";

contract PositionHouseBase is
    ReentrancyGuardUpgradeable,
    CumulativePremiumFractions,
    ClaimableAmountManager,
    LimitOrderManager,
    MarketMakerLogic
{
    using PositionLimitOrder for mapping(address => mapping(address => PositionLimitOrder.Data[]));
    using Quantity for int256;
    using Int256Math for int256;
    using Quantity for int128;

    using Position for Position.Data;
    using Position for Position.LiquidatedData;
    using PositionHouseFunction for PositionHouseBase;

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

    event FullyLiquidated(address pmAddress, address trader);
    event PartiallyLiquidated(address pmAddress, address trader);

//    event FundClaimed(
//        address pmAddress,
//        address trader,
//        uint256 totalFund
//    );

    event InstantlyClosed(address pmAddress, address trader);

    function initialize(
        address _insuranceFund,
        IPositionHouseConfigurationProxy _positionHouseConfigurationProxy,
        IPositionNotionalConfigProxy _positionNotionalConfigProxy
    ) public initializer {
        __ReentrancyGuard_init();
        __Ownable_init();
        insuranceFund = IInsuranceFund(_insuranceFund);
        positionHouseConfigurationProxy = _positionHouseConfigurationProxy;
        positionNotionalConfigProxy = _positionNotionalConfigProxy;
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
    ) public virtual {
        address _pmAddress = address (_positionManager);
        address _trader = _msgSender();
        Position.Data memory _positionDataWithManualMargin = getPositionWithManualMargin(_pmAddress, _trader, getPosition(_pmAddress, _trader));
        (bool _needClaim, int256 _claimableMargin, int256 _claimablePnl) = _needToClaimFund(_pmAddress, _trader, _positionDataWithManualMargin);
        if (_needClaim) {
            _internalClaimFund(_pmAddress, _trader, _positionDataWithManualMargin, _claimableMargin, _claimablePnl);
        }
        _internalOpenMarketPosition(
            _positionManager,
            _side,
            _quantity,
            _leverage,
            _positionDataWithManualMargin,
            _trader
        );
    }

    function openLimitOrder(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _uQuantity,
        uint128 _pip,
        uint16 _leverage
    ) public virtual {
        address _pmAddress = address (_positionManager);
        address _trader = _msgSender();
        Position.Data memory _positionDataWithManualMargin = getPositionWithManualMargin(_pmAddress, _trader, getPosition(_pmAddress, _trader));
        (bool _needClaim, int256 _claimableMargin, int256 _claimablePnl) = _needToClaimFund(_pmAddress, _trader, _positionDataWithManualMargin);
        if (_needClaim) {
            _internalClaimFund(_pmAddress, _trader, _positionDataWithManualMargin, _claimableMargin, _claimablePnl);
        }
        _internalOpenLimitOrder(
            _positionManager,
            _side,
            _uQuantity,
            _pip,
            _leverage,
            _positionDataWithManualMargin,
            _trader
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
    ) external virtual nonReentrant {
        _internalCancelLimitOrder(_positionManager, _orderIdx, _isReduce);
    }

    /**
     * @notice close position with close market
     * @param _positionManager IPositionManager address
     * @param _quantity want to close
     */
    function closePosition(IPositionManager _positionManager, uint256 _quantity)
    public
    virtual
    {
        address _pmAddress = address(_positionManager);
        address _trader = _msgSender();
        _internalCloseMarketPosition(_pmAddress, _trader, _quantity);
    }

    function instantlyClosePosition(IPositionManager _positionManager, uint256 _quantity)
    public
    virtual
    {
        address _pmAddress = address(_positionManager);
        address _trader = _msgSender();
        _emptyReduceLimitOrders(_pmAddress, _trader);
        _internalCloseMarketPosition(_pmAddress, _trader, _quantity);
        emit InstantlyClosed(_pmAddress, _trader);
    }

    function triggerClosePosition(IPositionManager _positionManager, address _trader)
    external
    virtual
    nonReentrant
    onlyPositionStrategyOrder
    {
//        address _pmAddress = address(_positionManager);
//        Position.Data memory _positionDataWithManualMargin = getPositionWithManualMargin(_pmAddress, _trader, getPosition(_pmAddress, _trader));
//        _internalCancelAllPendingOrder(_positionManager, _trader);
////         must reuse this code instead of using function _internalCloseMarketPosition
//        _internalOpenMarketPosition(
//            _positionManager,
//            _positionDataWithManualMargin.quantity > 0
//            ? Position.Side.SHORT
//            : Position.Side.LONG,
//            _positionDataWithManualMargin.quantity.abs(),
//            _positionDataWithManualMargin.leverage,
//            _positionDataWithManualMargin,
//            _trader
//        );
    }

    function _internalCloseMarketPosition(address _pmAddress, address _trader, uint256 _quantity) internal {
        Position.Data memory _positionDataWithManualMargin = getPositionWithManualMargin(_pmAddress, _trader, getPosition(_pmAddress, _trader));
        require(
            _quantity <= _positionDataWithManualMargin.quantity.abs(),
            Errors.VL_INVALID_CLOSE_QUANTITY
        );
        _internalOpenMarketPosition(
            IPositionManager(_pmAddress),
            _positionDataWithManualMargin.quantity > 0
            ? Position.Side.SHORT
            : Position.Side.LONG,
            _quantity,
            _positionDataWithManualMargin.leverage,
            _positionDataWithManualMargin,
            _trader
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
    ) public virtual {
        address _pmAddress = address(_positionManager);
        address _trader = _msgSender();
        Position.Data memory _positionDataWithManualMargin = getPositionWithManualMargin(_pmAddress, _trader, getPosition(_pmAddress, _trader));
        require(
            _quantity <= _positionDataWithManualMargin.quantity.abs(),
            Errors.VL_INVALID_CLOSE_QUANTITY
        );
        _internalOpenLimitOrder(
            _positionManager,
            _positionDataWithManualMargin.quantity > 0
            ? Position.Side.SHORT
            : Position.Side.LONG,
            _quantity,
            _pip,
            _positionDataWithManualMargin.leverage,
            _positionDataWithManualMargin,
            _trader
        );
    }

    function claimFund(IPositionManager _positionManager)
    external
    virtual
    nonReentrant
    {
        address _pmAddress = address(_positionManager);
        address _trader = _msgSender();
        Position.Data memory _positionDataWithManualMargin = getPositionWithManualMargin(_pmAddress, _trader, getPosition(_pmAddress, _trader));
        require(
            _positionDataWithManualMargin.quantity == 0,
            Errors.VL_INVALID_CLAIM_FUND
        );
        _internalClaimFund(_pmAddress, _trader, _positionDataWithManualMargin, 0, 0);
    }

    function _internalClaimFund(address _pmAddress, address _trader, Position.Data memory _positionData, int256 _claimableMargin, int256 _claimablePnl) internal {
        if(_claimableMargin == 0){
            (_claimableMargin, _claimablePnl) = _getClaimAmount(
                _pmAddress,
                _trader,
                _positionData
            );
        }
        uint256 oldMargin = _positionData.margin;
        clearPosition(_pmAddress, _trader);
        int256 totalClaimableAmount = _claimableMargin + _claimablePnl;
        if (_claimableMargin + _claimablePnl > 0) {
            _withdraw(_pmAddress, _trader, totalClaimableAmount.abs(), uint256(_claimableMargin), _claimablePnl);
//            emit FundClaimed(_pmAddress, _trader, totalRealizedPnl.abs());
        }
    }

    /**
     * @notice liquidate trader's underwater position. Require trader's margin ratio more than partial liquidation ratio
     * @dev liquidator can NOT open any positions in the same block to prevent from price manipulation.
     * @param _positionManager positionManager address
     * @param _trader trader address
     */
    function _internalLiquidate(
        IPositionManager _positionManager,
        address _trader,
        uint256 _contractPrice
    )
        internal
    {
        (, , uint256 marginRatio) = getMaintenanceDetail(
            _positionManager,
            _trader,
            PnlCalcOption.TWAP
        );
        uint256 _partialLiquidationRatio = positionHouseConfigurationProxy.partialLiquidationRatio();
        {
            require(
                marginRatio >= _partialLiquidationRatio,
                Errors.VL_NOT_ENOUGH_MARGIN_RATIO
            );
        }
        address _pmAddress = address(_positionManager);
        uint256 liquidationPenalty;
        {
            uint256 feeToLiquidator;
            Position.Data memory positionDataWithManualMargin = getPositionWithManualMargin(_pmAddress, _trader, getPosition(_pmAddress, _trader));
            (uint256 _liquidationFeeRatio, uint256 _liquidationPenaltyRatio) = positionHouseConfigurationProxy.getLiquidationRatio();
            // partially liquidate position
            if (marginRatio < 100) {
                // calculate amount quantity of position to reduce
                int256 partiallyLiquidateQuantity = PositionHouseFunction.getPartialLiquidateQuantity(positionDataWithManualMargin.quantity, _liquidationPenaltyRatio, _contractPrice);
                // partially liquidate position by reduce position's quantity
                if (partiallyLiquidateQuantity.abs() > 0) {
                    PositionResp memory positionResp = partialLiquidate(
                        _positionManager,
                        partiallyLiquidateQuantity,
                        positionDataWithManualMargin,
                        _trader
                    );

                    // half of the liquidationFee goes to liquidator & another half goes to insurance fund
                    liquidationPenalty = uint256(positionResp.marginToVault);
                    feeToLiquidator = liquidationPenalty / 2;
                    uint256 feeToInsuranceFund = liquidationPenalty - feeToLiquidator;
                    emit PartiallyLiquidated(_pmAddress, _trader);
                }
            } else {
                // fully liquidate trader's position
                bool _liquidateOrderIsBuy = positionDataWithManualMargin.quantity > 0 ? false : true;
                liquidationPenalty = positionDataWithManualMargin.margin ;
                clearPosition(_pmAddress, _trader);
                _clearBonus(_pmAddress, _trader);
                // after clear position, create an opposite market order of old position
                _positionManager.openMarketPosition(positionDataWithManualMargin.quantity.abs(), _liquidateOrderIsBuy);
                feeToLiquidator =
                (liquidationPenalty * _liquidationFeeRatio) /
                2 /
                100;
                emit FullyLiquidated(_pmAddress, _trader);
            }
            address _caller = _msgSender();
            _withdraw(_pmAddress, _caller, feeToLiquidator, 0, 0);
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
    virtual
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
    virtual
    nonReentrant
    {
        address _pmAddress = address(_positionManager);
        address _trader = _msgSender();

        uint256 _oldMargin = getTotalMargin(_pmAddress, _trader);
        require(_amount <= getRemovableMargin(_positionManager, _trader), Errors.VL_INVALID_REMOVE_MARGIN);

        manualMargin[_pmAddress][_trader] -= int256(_amount);

        _withdraw(_pmAddress, _trader, _amount, _oldMargin, 0);

//        emit MarginRemoved(_trader, _amount, _positionManager);
    }

    // OWNER UPDATE VARIABLE STORAGE

    //    function setPauseStatus(bool _isPause) external onlyOwner {
    //        if (_isPause) {
    //            _pause();
    //        } else {
    //            _unpause();
    //        }
    //    }

    function setPositionStrategyOrder(IPositionStrategyOrder _positionStrategyOrder) external onlyOwner {
        positionStrategyOrder = _positionStrategyOrder;
    }

    function updateConfigNotionalKey(address _pmAddress, bytes32 _key) external onlyOwner {
        configNotionalKey[_pmAddress] = _key;
    }

    // PUBLIC VIEW QUERY

    //    function getConfigNotionalKey(address _pmAddress) public view returns (bytes32) {
    //        return configNotionalKey[_pmAddress];
    //    }

    function getAddedMargin(address _positionManager, address _trader)
    public
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

        ) = getMaintenanceDetail(_positionManager, _trader, PnlCalcOption.TWAP);
        int256 _remainingMargin = marginBalance - int256(maintenanceMargin);
        return
        uint256(
            _marginAdded <= _remainingMargin
            ? _marginAdded
            : _remainingMargin.kPositive()
        );
    }

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
        if (positionData.lastUpdatedCumulativePremiumFraction == 0) {
            positionData.lastUpdatedCumulativePremiumFraction = _getLimitOrderPremiumFraction(_pmAddress, _trader);
        }
        Position.LiquidatedData memory _debtPosition = debtPosition[_pmAddress][
        _trader
        ];
        if (_debtPosition.margin != 0) {
            positionData.quantity -= _debtPosition.quantity;
            positionData.margin -= _debtPosition.margin;
            positionData.openNotional -= _debtPosition.notional;
        }
        if (positionData.quantity == 0) {
            positionData.margin = 0;
            positionData.openNotional = 0;
            positionData.leverage = 1;
        }
    }

    function getTotalMargin(address _pmAddress, address _trader)
    public
    override
    returns (uint256) {
        uint256 pendingMargin = PositionHouseFunction.getTotalPendingLimitOrderMargin(IPositionManager(_pmAddress), _getLimitOrders(_pmAddress, _trader), false);
        uint256 margin = getPositionWithManualMargin(_pmAddress, _trader, getPosition(_pmAddress, _trader)).margin;

        return pendingMargin + margin;
    }

    function getPositionWithManualMargin(
        address _pmAddress,
        address _trader,
        Position.Data memory _oldPosition
    ) internal view returns (Position.Data memory) {
        _oldPosition.margin += _getManualMargin(_pmAddress, _trader).abs();
        return _oldPosition;
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
        Position.Data memory _positionData = getPosition(_pmAddress, _trader);
        Position.Data memory _positionDataWithManualMargin = getPositionWithManualMargin(_pmAddress, _trader, getPosition(_pmAddress, _trader));
        (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(
            _positionManager,
            _trader,
            _calcOption,
            _positionDataWithManualMargin
        );
        (
        uint256 remainMarginWithFundingPayment,
        ,
        ,

        ) = calcRemainMarginWithFundingPayment(
            _pmAddress,
            // only use position data without margin when calculate remain margin with funding payment
            _positionData,
            _positionDataWithManualMargin.margin
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
        if (_positionDataWithManualMargin.quantity == 0) {
            marginRatio = 0;
        }
    }

    function getLimitOrderPremiumFraction(address _pmAddress, address _trader) public view returns (int128) {
        return _getLimitOrderPremiumFraction(_pmAddress, _trader);
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
        Position.Data memory oldPosition,
        address _trader
    ) internal {
        address _pmAddress = address(_positionManager);
        _requireOrderSideAndQuantity(_pmAddress, _trader, _side, _quantity, oldPosition.quantity);
        int256 pQuantity = _side == Position.Side.LONG
        ? int256(_quantity)
        : -int256(_quantity);
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
            pResp = increasePosition(
                _pmAddress,
                _side,
                int256(_quantity),
                _leverage,
                _trader,
                oldPosition,
                positionMap[_pmAddress][_trader],
                getLatestCumulativePremiumFraction(_pmAddress)
            );
            require(_checkMaxNotional(pResp.exchangedQuoteAssetAmount, configNotionalKey[_pmAddress], _leverage), Errors.VL_EXCEED_MAX_NOTIONAL);
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
            uint256 pendingMargin = PositionHouseFunction.getTotalPendingLimitOrderMargin(_positionManager, _getLimitOrders(_pmAddress, _trader), false);
            _withdraw(_pmAddress, _trader, pResp.marginToVault.abs(), oldPosition.margin + pendingMargin, pResp.realizedPnl);
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
    //        bool _isInOpenLimit,
        Position.Data memory _oldPosition
    ) internal returns (PositionResp memory positionResp) {
        address _pmAddress = address(_positionManager);
        uint256 openMarketQuantity = _oldPosition.quantity.abs();

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
        positionResp.realizedPnl = PositionHouseFunction.calculatePnlWhenClose(_oldPosition.quantity, positionResp.exchangedPositionSize, _oldPosition.openNotional, positionResp.exchangedQuoteAssetAmount);
        {
            // total claimable fund = claimableMargin + claimablePnl
            (int256 claimableMargin, int256 claimablePnl) = _getClaimAmount(_pmAddress, _trader, _oldPosition);
            positionResp.marginToVault = -positionResp.realizedPnl
            .add(claimableMargin + claimablePnl)
            .kPositive();
        }
//        positionResp.unrealizedPnl = 0;
        clearPosition(_pmAddress, _trader);
    }

    function clearPosition(address _pmAddress, address _trader) internal override {
        if (positionStrategyOrder.hasTPOrSL(_pmAddress, _trader)) {
            positionStrategyOrder.unsetTPAndSLWhenClosePosition(_pmAddress, _trader);
        }
        positionMap[_pmAddress][_trader].clear();
        debtPosition[_pmAddress][_trader].clearDebt();
        manualMargin[_pmAddress][_trader] = 0;

        (
        PositionLimitOrder.Data[] memory subListLimitOrders
        ) = PositionHouseFunction.clearAllFilledOrder(
            IPositionManager(_pmAddress),
            _getLimitOrders(_pmAddress, _trader)
        );

        _emptyLimitOrders(_pmAddress, _trader);
        for (uint256 i = 0; i < subListLimitOrders.length; i++) {
            if (subListLimitOrders[i].pip == 0) {
                break;
            }
            _pushLimit(_pmAddress, _trader, subListLimitOrders[i]);
        }
        _emptyReduceLimitOrders(_pmAddress, _trader);
    }

    function increasePosition(
        address _pmAddress,
        Position.Side _side,
        int256 _quantity,
        uint16 _leverage,
        address _trader,
        // position data included manual margin
        Position.Data memory _positionData,
        Position.Data memory _positionDataWithoutLimit,
        int128 _latestCumulativePremiumFraction
    ) internal returns (PositionResp memory positionResp) {
        _positionData.margin -= getAddedMargin(_pmAddress, _trader).abs();
        {
            positionResp = PositionHouseFunction.increasePosition(
                _pmAddress,
                _side,
                _quantity,
                _leverage,
                _trader,
                _positionData,
                _positionDataWithoutLimit,
                _latestCumulativePremiumFraction
            );
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
            int256 _manualAddedMargin = _getManualMargin(_pmAddress, _trader);
            {
                positionResp = PositionHouseFunction.openReversePosition(
                    _pmAddress,
                    _side,
                    _quantity,
                    _leverage,
                    _trader,
                    _oldPosition,
                    positionMap[_pmAddress][_trader],
                    getLatestCumulativePremiumFraction(_pmAddress),
                    _manualAddedMargin
                );
                manualMargin[_pmAddress][_trader] = _manualAddedMargin * (_oldPosition.quantity.absInt() - _quantity.absInt()) / _oldPosition.quantity.absInt();
                return positionResp;
            }
        }
        // if new position is larger then close old and open new
        PositionResp memory closePositionResp = _internalClosePosition(
            _positionManager,
            _trader,
            PnlCalcOption.SPOT_PRICE,
            _oldPosition
        );
        positionResp = closePositionResp;
        return positionResp;
    }

    function partialLiquidate(
        IPositionManager _positionManager,
        int256 _quantity,
        Position.Data memory _oldPosition,
        address _trader
    ) internal returns (PositionResp memory positionResp) {
        address _pmAddress = address(_positionManager);
        int256 _manualMargin = _getManualMargin(_pmAddress, _trader);
        _emptyReduceLimitOrders(_pmAddress, _trader);
        // if current position is long (_quantity >0) then liquidate order is short
        bool _liquidateOrderIsBuy = _quantity > 0 ? false : true;
        // call directly to position manager to skip check enough liquidity
        _positionManager.openMarketPosition(_quantity.abs(), _liquidateOrderIsBuy);
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
        (uint256 _liquidatedPositionMargin, uint256 _liquidatedManualMargin) = PositionHouseFunction.calculatePartialLiquidateMargin(
            _oldPosition.margin - _manualMargin.abs(),
            _manualMargin.abs(),
            positionHouseConfigurationProxy.liquidationFeeRatio()
        );
        manualMargin[_pmAddress][_trader] -= int256(_liquidatedManualMargin);
        positionResp.marginToVault = int256(_liquidatedPositionMargin + _liquidatedManualMargin);
//        positionResp.unrealizedPnl = unrealizedPnl;
        debtPosition[_pmAddress][_trader].updateDebt(
            _quantity,
            _liquidatedPositionMargin,
            positionResp.exchangedQuoteAssetAmount
        );
        return positionResp;
    }

    function _checkMaxNotional(uint256 _notional, bytes32 _key, uint16 _leverage) internal override returns (bool) {
        return _notional <= (positionNotionalConfigProxy.getMaxNotional(_key, _leverage) * 10**18);
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

    function getDebtPosition(address _pmAddress, address _trader)
    public
    view
    override
    returns (Position.LiquidatedData memory)
    {
        return debtPosition[_pmAddress][_trader];
    }

    function _deposit(
        address _positionManager,
        address _trader,
        uint256 _amount,
        uint256 _fee
    )
    internal override virtual
    {
        insuranceFund.deposit(_positionManager, _trader, _amount, _fee);
    }

    function _withdraw(
        address _positionManager,
        address _trader,
        uint256 _amount,
        uint256 _margin,
        int256 _pnl
    ) internal override virtual
    {
        insuranceFund.withdraw(_positionManager, _trader, _amount, _margin, _pnl);
    }

    function _clearBonus(
        address _positionManager,
        address _trader
    ) internal
    {
        insuranceFund.clearBonus(_positionManager, _trader);
    }

    modifier onlyPositionStrategyOrder() {
        require(msg.sender == address(positionStrategyOrder), Errors.VL_ONLY_POSITION_STRATEGY_ORDER);
        _;
    }


    IPositionStrategyOrder public positionStrategyOrder;

}
