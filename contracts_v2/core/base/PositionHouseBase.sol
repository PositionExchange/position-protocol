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
import {MarketOrder} from "../modules/MarketOrder.sol";
import {ClaimableAmountManager} from "../modules/ClaimableAmountManager.sol";
import {MarketMakerLogic} from "../modules/MarketMaker.sol";
import {Base} from "../modules/Base.sol";

import "hardhat/console.sol";

contract PositionHouseBase is
    ReentrancyGuardUpgradeable,
    CumulativePremiumFractions,
    LimitOrderManager,
    MarketMakerLogic,
    MarketOrder
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
        (bool _needClaim, int256 _claimableAmount) = _needToClaimFund(_pmAddress, _trader, _positionDataWithManualMargin);
        if (_needClaim) {
            _internalClaimFund(_pmAddress, _trader, _positionDataWithManualMargin, _claimableAmount);
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
        (bool _needClaim, int256 _claimableAmount) = _needToClaimFund(_pmAddress, _trader, _positionDataWithManualMargin);
        if (_needClaim) {
            _internalClaimFund(_pmAddress, _trader, _positionDataWithManualMargin, _claimableAmount);
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
        address _pmAddress = address(_positionManager);
        Position.Data memory _positionDataWithManualMargin = getPositionWithManualMargin(_pmAddress, _trader, getPosition(_pmAddress, _trader));
        _internalCancelAllPendingOrder(_positionManager, _trader);
        // must reuse this code instead of using function _internalCloseMarketPosition
        _internalOpenMarketPosition(
            _positionManager,
            _positionDataWithManualMargin.quantity > 0
            ? Position.Side.SHORT
            : Position.Side.LONG,
            _positionDataWithManualMargin.quantity.abs(),
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
        _internalClaimFund(_pmAddress, _trader, _positionDataWithManualMargin, 0);
    }

    function _internalClaimFund(address _pmAddress, address _trader, Position.Data memory _positionData, int256 totalRealizedPnl) internal {
        if(totalRealizedPnl == 0){
            totalRealizedPnl = _getClaimAmount(
                _pmAddress,
                _trader,
                _positionData
            );
        }
        clearPosition(_pmAddress, _trader);
        if (totalRealizedPnl > 0) {
            _withdraw(_pmAddress, _trader, totalRealizedPnl.abs());
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
                // after clear position, create an opposite market order of old position
                _positionManager.openMarketPosition(positionDataWithManualMargin.quantity.abs(), _liquidateOrderIsBuy);
                feeToLiquidator =
                (liquidationPenalty * _liquidationFeeRatio) /
                2 /
                100;
                _reduceBonus(_pmAddress, _trader, 0);
                emit FullyLiquidated(_pmAddress, _trader);
            }
            address _caller = _msgSender();
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

        emit MarginAdded(_trader, _amount, _positionManager);
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

        uint256 removableMargin = getRemovableMargin(_positionManager, _trader);
        require(_amount <= removableMargin, Errors.VL_INVALID_REMOVE_MARGIN);

        manualMargin[_pmAddress][_trader] -= int256(_amount);

        _withdraw(_pmAddress, _trader, _amount);

        emit MarginRemoved(_trader, _amount, _positionManager);
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
    override(Base)
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
    override(Base)
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
        Position.LiquidatedData memory _debtPosition = debtPosition[_pmAddress][_trader];
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

    function getPositionWithManualMargin(
        address _pmAddress,
        address _trader,
        Position.Data memory _oldPosition
    ) public view override(Base) returns (Position.Data memory) {
        _oldPosition.margin += _getManualMargin(_pmAddress, _trader).abs();
        return _oldPosition;
    }

    function _getClaimAmount(
        address _pmAddress,
        address _trader,
        Position.Data memory _positionData
    ) internal view override(Base) returns (int256) {
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
        // Position Data without manual margin
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
        // only use initial margin for calculating maintenanceMargin
        maintenanceMargin =
        (_positionData.margin *
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
    override(CumulativePremiumFractions, Base)
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
    function _requireOrderSideAndQuantity(
        address _pmAddress,
        address _trader,
        Position.Side _side,
        uint256 _quantity,
        int256 _positionQuantity
    ) internal override(Base) view {
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

    function clearPosition(address _pmAddress, address _trader) internal override(Base) {
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

    function partialLiquidate(
        IPositionManager _positionManager,
        int256 _quantity,
        Position.Data memory _oldPosition,
        address _trader
    ) internal returns (PositionResp memory positionResp) {
        address _pmAddress = address(_positionManager);
        int256 _manualMargin = _getManualMargin(_pmAddress, _trader);
        //        _emptyReduceLimitOrders(_pmAddress, _trader);
        // if current position is long (_quantity >0) then liquidate order is short
        bool _liquidateOrderIsBuy = _quantity > 0 ? false : true;
        // call directly to position manager to skip check enough liquidity
        _positionManager.openMarketPosition(_quantity.abs(), _liquidateOrderIsBuy);
        positionResp.exchangedQuoteAssetAmount = _quantity
        .getExchangedQuoteAssetAmount(
            _oldPosition.openNotional,
            _oldPosition.quantity.abs()
        );
        //        (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(
        //            _positionManager,
        //            _trader,
        //            PnlCalcOption.SPOT_PRICE,
        //            _oldPosition
        //        );
        // TODO need to calculate remain margin with funding payment
        (uint256 _liquidatedPositionMargin, uint256 _liquidatedManualMargin) = PositionHouseFunction.calculatePartialLiquidateMargin(
            _oldPosition.margin - _manualMargin.abs(),
            _manualMargin.abs(),
            positionHouseConfigurationProxy.liquidationFeeRatio()
        );
        manualMargin[_pmAddress][_trader] -= int256(_liquidatedManualMargin);
        uint256 _liquidatedMargin = _liquidatedPositionMargin + _liquidatedManualMargin;
        positionResp.marginToVault = int256(_liquidatedMargin);
        //        positionResp.unrealizedPnl = unrealizedPnl;
        debtPosition[_pmAddress][_trader].updateDebt(
            _quantity,
            _liquidatedPositionMargin,
            positionResp.exchangedQuoteAssetAmount
        );
        _reduceBonus(_pmAddress, _trader, _liquidatedMargin);
        return positionResp;
    }

    function _checkMaxNotional(uint256 _notional, bytes32 _key, uint16 _leverage) internal override(Base) returns (bool) {
        return _notional <= (positionNotionalConfigProxy.getMaxNotional(_key, _leverage) * 10**18);
    }

    function _updatePositionMap(
        address _pmAddress,
        address _trader,
        Position.Data memory newData
    ) internal override(Base) {
        positionMap[_pmAddress][_trader].update(newData);
    }

    function _getPositionMap(address _pmAddress, address _trader)
    internal
    view
    override(Base)
    returns (Position.Data memory)
    {
        return positionMap[_pmAddress][_trader];
    }

    function _getManualMargin(address _pmAddress, address _trader)
    internal
    view
    override(Base)
    returns (int256)
    {
        return manualMargin[_pmAddress][_trader];
    }

    function getDebtPosition(address _pmAddress, address _trader)
    public
    view
    override(Base)
    returns (Position.LiquidatedData memory)
    {
        return debtPosition[_pmAddress][_trader];
    }

    function _deposit(
        address positionManager,
        address trader,
        uint256 amount,
        uint256 fee
    )
    internal override(Base) virtual
    {
        insuranceFund.deposit(positionManager, trader, amount, fee);
    }

    function _withdraw(
        address positionManager,
        address trader,
        uint256 amount
    ) internal override(Base) virtual
    {
        insuranceFund.withdraw(positionManager, trader, amount);
    }

    function _reduceBonus(
        address positionManager,
        address trader,
        uint256 amount
    ) internal virtual
    {
        insuranceFund.reduceBonus(positionManager, trader, amount);
    }

    modifier onlyPositionStrategyOrder() {
        require(msg.sender == address(positionStrategyOrder), Errors.VL_ONLY_POSITION_STRATEGY_ORDER);
        _;
    }


    IPositionStrategyOrder public positionStrategyOrder;

}
