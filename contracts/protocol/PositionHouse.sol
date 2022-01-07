pragma solidity ^0.8.0;

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
import {Errors} from "./libraries/helpers/Errors.sol";

contract PositionHouse is ReentrancyGuardUpgradeable, OwnableUpgradeable, PositionHouseStorage
{
    using PositionLimitOrder for mapping(address => mapping(address => PositionLimitOrder.Data[]));
    using Quantity for int256;
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

    event AddMargin(address trader, uint256 marginAdded, IPositionManager positionManager);

    event RemoveMargin(address trader, uint256 marginRemoved, IPositionManager positionManager);

    event CancelLimitOrder(address trader, address _positionManager, uint128 pip, uint64 orderId);

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
        int256 pQuantity = _side == Position.Side.LONG ? int256(_quantity) : - int256(_quantity);
        Position.Data memory oldPosition = getPosition(address(_positionManager), _trader);
        if (oldPosition.quantity == 0) {
            oldPosition.leverage = 1;
        }
        //leverage must be greater than old position and in range of allowed leverage
        require(_leverage >= oldPosition.leverage && _leverage <= 125 && _leverage > 0, Errors.VL_INVALID_LEVERAGE);
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
            pResp = openReversePosition(_positionManager, _side, pQuantity, _leverage, _trader, oldPosition);
        }
        // update position state
        positionMap[pmAddr][_trader].update(
            pResp.position
        );

        if (pResp.marginToVault > 0) {
            //transfer from trader to vault
            deposit(_positionManager, _trader, pResp.marginToVault.abs(), pResp.position.openNotional);
        } else if (pResp.marginToVault < 0) {
            // withdraw from vault to user
            withdraw(_positionManager, _trader, pResp.marginToVault.abs());
        }
        emit OpenMarket(_trader, pQuantity, _leverage, pResp.exchangedQuoteAssetAmount / _quantity, _positionManager);
    }

    function openLimitOrder(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _quantity,
        uint128 _pip,
        uint256 _leverage
    ) public whenNotPaused nonReentrant {
        address _trader = _msgSender();
        OpenLimitResp memory openLimitResp;
        (openLimitResp.orderId, openLimitResp.sizeOut) = _internalOpenLimitOrder(
            _positionManager,
            _trader,
            _pip,
            int256(_quantity).abs128(),
            _side == Position.Side.LONG ? true : false,
            _leverage
        );
        if (openLimitResp.sizeOut < _quantity) {
            PositionLimitOrder.Data memory _newOrder = PositionLimitOrder.Data({
                pip : _pip,
                orderId : openLimitResp.orderId,
                leverage : uint16(_leverage),
                isBuy : _side == Position.Side.LONG ? 1 : 2,
                entryPrice : 0,
                reduceLimitOrderId : 0,
                reduceQuantity : 0,
                blockNumber : block.number
            });
            handleLimitOrderInOpenLimit(_newOrder, _positionManager, _trader, _quantity, openLimitResp.sizeOut, _side);
        }
        uint256 baseBasisPoint = _positionManager.getBaseBasisPoint();
        uint256 depositAmount = _quantity * _positionManager.pipToPrice(_pip) / _leverage / baseBasisPoint;
        deposit(_positionManager, _trader, depositAmount, _quantity * _positionManager.pipToPrice(_pip) / baseBasisPoint);
        canClaimAmountMap[address(_positionManager)][_trader] += depositAmount;
        emit OpenLimit(openLimitResp.orderId, _trader, _side == Position.Side.LONG ? int256(_quantity) : - int256(_quantity), _leverage, _pip, _positionManager);
    }

    function _internalOpenLimitOrder(
        IPositionManager _positionManager,
        address _trader,
        uint128 _pip,
        uint128 _quantity,
        bool _isBuy,
        uint256 _leverage
    ) internal returns (
        uint64 orderId,
        uint256 sizeOut
    ){
        {
            Position.Data memory totalPosition = getPosition(address(_positionManager), _trader);
            require(_leverage >= totalPosition.leverage && _leverage <= 125 && _leverage > 0, Errors.VL_INVALID_LEVERAGE);
            (uint128 currentPip, uint8 isFullBuy) = _positionManager.getCurrentSingleSlot();
            uint256 openNotional;
            //1: buy
            //2: sell
            if (_pip == currentPip && isFullBuy != (_isBuy ? 1 : 2) && _isBuy != (totalPosition.quantity > 0 ? true : false)) {// not is full buy -> open opposite orders
                uint128 liquidityInCurrentPip = _positionManager.getLiquidityInCurrentPip();
                if (totalPosition.quantity.abs() <= liquidityInCurrentPip && totalPosition.quantity.abs() <= _quantity && totalPosition.quantity.abs() != 0) {
                    {
                        PositionResp memory closePositionResp = internalClosePosition(_positionManager, _trader, PnlCalcOption.SPOT_PRICE, true, totalPosition);
                        if (int256(_quantity) - closePositionResp.exchangedPositionSize == 0) {
                            // TODO deposit margin to vault of position resp
//                            positionResp = closePositionResp;
//                            deposit(_positionManager, _trader, positionResp.marginToVault.abs(), 0);
                        } else {
                            (orderId, sizeOut, openNotional) = _positionManager.openLimitPosition(_pip, _quantity - (closePositionResp.exchangedPositionSize).abs128(), _isBuy);
                        }
                    }
                } else {
                    (orderId, sizeOut, openNotional) = _positionManager.openLimitPosition(_pip, _quantity, _isBuy);
                }
                if (sizeOut != 0) {
                    handleMarketQuantityInLimitOrder(address(_positionManager), _trader, sizeOut, openNotional, _leverage, _isBuy);
                }
            } else {
                (orderId, sizeOut, openNotional) = _positionManager.openLimitPosition(_pip, _quantity, _isBuy);
                if (sizeOut != 0) {
                    handleMarketQuantityInLimitOrder(address(_positionManager), _trader, sizeOut, openNotional, _leverage, _isBuy);
                }
            }
        }

    }

    // check the new limit order is fully reduce, increase or both reduce and increase
    function handleLimitOrderInOpenLimit(
        PositionLimitOrder.Data memory _newOrder,
        IPositionManager _positionManager,
        address _trader,
        uint256 _quantity,
        uint256 _sizeOut,
        Position.Side _side
    ) internal {
        address positionManagerAddress = address(_positionManager);
        Position.Data memory totalPosition = getPosition(positionManagerAddress, _trader);
        uint256 baseBasisPoint = _positionManager.getBaseBasisPoint();
        if (totalPosition.quantity == 0 || _side == (totalPosition.quantity > 0 ? Position.Side.LONG : Position.Side.SHORT)) {
            limitOrders[positionManagerAddress][_trader].push(_newOrder);
        } else {
            // if new limit order is smaller than old position then just reduce old position
            if (totalPosition.quantity.abs() > _quantity) {
                _newOrder.reduceQuantity = _quantity - _sizeOut;
                _newOrder.entryPrice = totalPosition.openNotional * baseBasisPoint / totalPosition.quantity.abs();
                reduceLimitOrders[positionManagerAddress][_trader].push(_newOrder);
            }
            // else new limit order is larger than old position then close old position and open new opposite position
            else {
                _newOrder.reduceQuantity = totalPosition.quantity.abs();
                _newOrder.reduceLimitOrderId = reduceLimitOrders[positionManagerAddress][_trader].length + 1;
                limitOrders[positionManagerAddress][_trader].push(_newOrder);
                _newOrder.entryPrice = totalPosition.openNotional * baseBasisPoint / totalPosition.quantity.abs();
                reduceLimitOrders[positionManagerAddress][_trader].push(_newOrder);
            }
        }
    }

    function cancelLimitOrder(IPositionManager _positionManager, uint64 orderIdOfTrader, uint128 pip, uint64 orderId) public whenNotPaused nonReentrant {
        address _trader = _msgSender();
        uint256 refundQuantity = _positionManager.cancelLimitOrder(pip, orderId);
        uint128 oldOrderPip;
        uint64 oldOrderId;
        address positionManagerAddress = address(_positionManager);
        PositionLimitOrder.Data[] memory listLimitOrders = limitOrders[positionManagerAddress][_trader];
        PositionLimitOrder.Data[] memory listReduceLimitOrders = reduceLimitOrders[positionManagerAddress][_trader];

        if (orderIdOfTrader < listLimitOrders.length) {
            oldOrderPip = listLimitOrders[orderIdOfTrader].pip;
            oldOrderId = listLimitOrders[orderIdOfTrader].orderId;
        }
        uint16 leverage;
        PositionLimitOrder.Data memory blankLimitOrderData;
        {
            if (pip == oldOrderPip && orderId == oldOrderId) {
                leverage = listLimitOrders[orderIdOfTrader].leverage;
                (,,, uint256 partialFilled) = _positionManager.getPendingOrderDetail(pip, orderId);
                if (partialFilled == 0) {
                    uint256 reduceLimitOrderId = listLimitOrders[orderIdOfTrader].reduceLimitOrderId;
                    if (reduceLimitOrderId != 0) {
                        reduceLimitOrders[positionManagerAddress][_trader][reduceLimitOrderId - 1] = blankLimitOrderData;
                    }
                    limitOrders[positionManagerAddress][_trader][orderIdOfTrader] = blankLimitOrderData;

                }
            } else {
                leverage = listReduceLimitOrders[orderIdOfTrader].leverage;
                (,,, uint256 partialFilled) = _positionManager.getPendingOrderDetail(pip, orderId);
                if (partialFilled == 0) {
                    reduceLimitOrders[positionManagerAddress][_trader][orderIdOfTrader] = blankLimitOrderData;
                }
            }
        }

        uint256 refundMargin = refundQuantity * _positionManager.pipToPrice(pip) / uint256(leverage) / _positionManager.getBaseBasisPoint();
        withdraw(_positionManager, _trader, refundMargin);
        canClaimAmountMap[positionManagerAddress][_trader] -= refundMargin;
        emit CancelLimitOrder(_trader, positionManagerAddress, pip, orderId);
    }

    /**
    * @notice close position with close market
    * @param _positionManager IPositionManager address
    * @param _quantity want to close
    */
    function closePosition(
        IPositionManager _positionManager,
        uint256 _quantity
    ) public {
        address _trader = _msgSender();
        Position.Data memory positionData = getPosition(address(_positionManager), _trader);
        require(_quantity > 0 && _quantity <= positionData.quantity.abs(), Errors.VL_INVALID_CLOSE_QUANTITY);
        openMarketPosition(
            _positionManager,
            positionData.quantity > 0 ? Position.Side.SHORT : Position.Side.LONG,
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
        Position.Data memory positionData = getPosition(address(_positionManager), _trader);
        require(_quantity > 0 && _quantity <= positionData.quantity.abs(), Errors.VL_INVALID_CLOSE_QUANTITY);
        openLimitOrder(
            _positionManager,
            positionData.quantity > 0 ? Position.Side.SHORT : Position.Side.LONG,
            _quantity,
            _pip,
            positionData.leverage
        );
    }

    function getClaimAmount(address _positionManager, address _trader) public view returns (int256 totalClaimableAmount) {
        Position.Data memory positionData = getPosition(_positionManager, _trader);
        return PositionHouseFunction.getClaimAmount(
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

    function claimFund(IPositionManager _positionManager) public whenNotPaused nonReentrant {
        address _trader = _msgSender();
        address positionManagerAddress = address(_positionManager);
        int256 totalRealizedPnl = getClaimAmount(positionManagerAddress, _trader);
        require(getPosition(positionManagerAddress, _trader).quantity == 0, Errors.VL_INVALID_CLAIM_FUND);
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
    function liquidate(
        IPositionManager _positionManager,
        address _trader
    ) external whenNotPaused nonReentrant {
        address _caller = _msgSender();
        (, , uint256 marginRatio) = getMaintenanceDetail(_positionManager, _trader);

        // TODO before liquidate should we check can claimFund, because trader has close position limit before liquidate
        // require trader's margin ratio higher than partial liquidation ratio
        require(marginRatio >= partialLiquidationRatio, Errors.VL_NOT_ENOUGH_MARGIN_RATIO);
        address positionManagerAddress = address(_positionManager);
        PositionResp memory positionResp;
        uint256 liquidationPenalty;
        {
            uint256 feeToLiquidator;
            uint256 feeToInsuranceFund;
            Position.Data memory positionData = getPosition(positionManagerAddress, _trader);
            // partially liquidate position
            if (marginRatio >= partialLiquidationRatio && marginRatio < 100) {

                // calculate amount quantity of position to reduce
                int256 partiallyLiquidateQuantity = positionData.quantity * int256(liquidationPenaltyRatio) / 100;
                // partially liquidate position by reduce position's quantity
                positionResp = partialLiquidate(
                    _positionManager,
                    positionData.quantity > 0 ? Position.Side.SHORT : Position.Side.LONG,
                    - partiallyLiquidateQuantity,
                    positionData,
                    _trader
                );

                // half of the liquidationFee goes to liquidator & another half goes to insurance fund
                liquidationPenalty = uint256(positionResp.marginToVault);
                feeToLiquidator = liquidationPenalty / 2;
                feeToInsuranceFund = liquidationPenalty - feeToLiquidator;
                // TODO take liquidation fee
//                // TODO has taken liquidation fee, check again
//                deposit(_positionManager, _trader, liquidationPenalty - feeToLiquidator, 0);
            } else {        
                // fully liquidate trader's position
                liquidationPenalty = positionData.margin + uint256(manualMargin[positionManagerAddress][_trader]);
                withdraw(_positionManager, _trader, (uint256(getClaimAmount(positionManagerAddress, _trader)) + positionData.margin));
                clearPosition(positionManagerAddress, _trader);
                feeToLiquidator = liquidationPenalty * liquidationFeeRatio / 2 / 100;
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
    function addMargin(IPositionManager _positionManager, uint256 _marginAdded) external whenNotPaused nonReentrant {
        address _trader = _msgSender();
        require(getPosition(address(_positionManager), _trader).quantity != 0, Errors.VL_NO_POSITION_TO_ADD);
        manualMargin[address(_positionManager)][_trader] += int256(_marginAdded);

        deposit(_positionManager, _trader, _marginAdded, 0);

        emit AddMargin(_trader, _marginAdded, _positionManager);
    }

    function getAddedMargin(IPositionManager _positionManager, address _trader) public view returns (int256) {
        return manualMargin[address(_positionManager)][_trader];
    }

    /**
     * @notice add margin to increase margin ratio
     * @param _positionManager IPositionManager address
     * @param _marginRemoved added margin
     */
    function removeMargin(IPositionManager _positionManager, uint256 _marginRemoved) external whenNotPaused nonReentrant {

        address _trader = _msgSender();

        require(getPosition(address(_positionManager), _trader).quantity != 0, Errors.VL_NO_POSITION_TO_REMOVE);
        uint256 removableMargin = uint256(getRemovableMargin(_positionManager, _trader));
        require(_marginRemoved <= removableMargin, Errors.VL_INVALID_REMOVE_MARGIN);

        manualMargin[address(_positionManager)][_trader] -= int256(_marginRemoved);

        withdraw(_positionManager, _trader, _marginRemoved);

        emit RemoveMargin(_trader, _marginRemoved, _positionManager);
    }

    function getRemovableMargin(IPositionManager _positionManager, address _trader) public view returns (int256) {
        int256 addedMargin = manualMargin[address(_positionManager)][_trader];
        (uint256 maintenanceMargin,int256 marginBalance,) = getMaintenanceDetail(_positionManager, _trader);
        int256 removableMargin = (marginBalance - int256(maintenanceMargin)) > 0 ? (marginBalance - int256(maintenanceMargin)) : 0;
        return addedMargin <= (marginBalance - int256(maintenanceMargin)) ? addedMargin : removableMargin;
    }

    function clearPosition(address positionManagerAddress, address _trader) internal {
        positionMap[positionManagerAddress][_trader].clear();
        debtPosition[positionManagerAddress][_trader].clearDebt();
        manualMargin[positionManagerAddress][_trader] = 0;
        canClaimAmountMap[positionManagerAddress][_trader] = 0;
        (PositionLimitOrder.Data[] memory subListLimitOrder, PositionLimitOrder.Data[] memory subReduceLimitOrder) = PositionHouseFunction.clearAllFilledOrder(IPositionManager(positionManagerAddress), limitOrders[positionManagerAddress][_trader], reduceLimitOrders[positionManagerAddress][_trader]);
        if (limitOrders[positionManagerAddress][_trader].length > 0) {
            delete limitOrders[positionManagerAddress][_trader];
        }
        for (uint256 i = 0; i < subListLimitOrder.length; i++) {
            if (subListLimitOrder[i].pip == 0) {
                break;
            }
            limitOrders[positionManagerAddress][_trader].push(subListLimitOrder[i]);
        }
        if (reduceLimitOrders[positionManagerAddress][_trader].length > 0) {
            delete reduceLimitOrders[positionManagerAddress][_trader];
        }
        for (uint256 i = 0; i < subReduceLimitOrder.length; i++) {
            if (subReduceLimitOrder[i].pip == 0) {
                break;
            }
            reduceLimitOrders[positionManagerAddress][_trader].push(subReduceLimitOrder[i]);
        }
    }

    function openReversePosition(
        IPositionManager _positionManager,
        Position.Side _side,
        int256 _quantity,
        uint256 _leverage,
        address _trader,
        Position.Data memory totalPosition
    ) internal returns (PositionResp memory positionResp) {
        address positionManagerAddress = address(_positionManager);
        if (_quantity.abs() < totalPosition.quantity.abs()) {
            {
                positionResp = PositionHouseFunction.openReversePosition(
                    positionManagerAddress,
                    _side,
                    _quantity,
                    _leverage,
                    _trader,
                    totalPosition,
                    positionMap[positionManagerAddress][_trader],
                    cumulativePremiumFractions[positionManagerAddress]
                );
                return positionResp;
            }
        }
        // if new position is larger then close old and open new
        return closeAndOpenReversePosition(_positionManager, _side, _quantity, _leverage, totalPosition);
    }

    function closeAndOpenReversePosition(
        IPositionManager _positionManager,
        Position.Side _side,
        int256 _quantity,
        uint256 _leverage,
        Position.Data memory totalPosition
    ) internal returns (PositionResp memory positionResp) {
        address _trader = _msgSender();
        address positionManagerAddress = address(_positionManager);
        PositionResp memory closePositionResp = internalClosePosition(_positionManager, _trader, PnlCalcOption.SPOT_PRICE, false, totalPosition);
        if (_quantity - closePositionResp.exchangedPositionSize == 0) {
            positionResp = closePositionResp;
        } else {
            totalPosition = getPosition(positionManagerAddress, _trader);
            PositionResp memory increasePositionResp = PositionHouseFunction.increasePosition(address(_positionManager), _side, _quantity - closePositionResp.exchangedPositionSize, _leverage, _trader, totalPosition, positionMap[positionManagerAddress][_trader], cumulativePremiumFractions[positionManagerAddress]);
            positionResp = PositionResp({
            position : increasePositionResp.position,
            exchangedQuoteAssetAmount : closePositionResp.exchangedQuoteAssetAmount + increasePositionResp.exchangedQuoteAssetAmount,
            fundingPayment : 0,
            exchangedPositionSize : closePositionResp.exchangedPositionSize + increasePositionResp.exchangedPositionSize,
            realizedPnl : closePositionResp.realizedPnl + increasePositionResp.realizedPnl,
            unrealizedPnl : 0,
            marginToVault : closePositionResp.marginToVault + increasePositionResp.marginToVault
            });
        }
        return positionResp;
    }

    function internalClosePosition(
        IPositionManager _positionManager,
        address _trader,
        PnlCalcOption _pnlCalcOption,
        bool isInOpenLimit,
        Position.Data memory totalPosition
    ) internal returns (PositionResp memory positionResp) {
        address positionManagerAddress = address(_positionManager);
        (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(_positionManager, _trader, _pnlCalcOption, totalPosition);
        uint256 openMarketQuantity = totalPosition.quantity.abs();
        require(openMarketQuantity != 0, Errors.VL_INVALID_QUANTITY_INTERNAL_CLOSE);
        if (isInOpenLimit) {
            uint256 liquidityInCurrentPip = uint256(_positionManager.getLiquidityInCurrentPip());
            openMarketQuantity = liquidityInCurrentPip > totalPosition.quantity.abs() ? totalPosition.quantity.abs() : liquidityInCurrentPip;
        }

        (positionResp.exchangedPositionSize, positionResp.exchangedQuoteAssetAmount)
        = PositionHouseFunction.openMarketOrder(
            positionManagerAddress,
            openMarketQuantity,
            totalPosition.quantity > 0 ? Position.Side.SHORT : Position.Side.LONG,
            _trader
        );

        (
            uint256 remainMargin,
            uint256 badDebt,
            int256 fundingPayment,

        ) = calcRemainMarginWithFundingPayment(_positionManager, totalPosition, totalPosition.margin);


        positionResp.realizedPnl = unrealizedPnl;
        positionResp.marginToVault = - ((int256(remainMargin) + positionResp.realizedPnl + manualMargin[positionManagerAddress][_trader]) < 0 ? 0 : (int256(remainMargin) + positionResp.realizedPnl + manualMargin[positionManagerAddress][_trader]));
//        int256 _marginToVault = int256(remainMargin) + positionResp.realizedPnl + manualMargin[address(_positionManager)][_trader];
//        positionResp.marginToVault = - (_marginToVault < 0 ? 0 : _marginToVault);
        positionResp.unrealizedPnl = 0;
        canClaimAmountMap[positionManagerAddress][_trader] = 0;
        clearPosition(positionManagerAddress, _trader);
    }

    function handleMarketQuantityInLimitOrder(address _positionManager, address _trader, uint256 _newQuantity, uint256 _newNotional, uint256 _leverage, bool _isBuy) internal {
        Position.Data memory newData;
        Position.Data memory marketPosition = positionMap[_positionManager][_trader];
        Position.Data memory totalPosition = getPosition(_positionManager, _trader);
        int256 newQuantityInt = _isBuy == true ? int256(_newQuantity) : - int256(_newQuantity);
        int256[] memory cumulativePremiumFractions = cumulativePremiumFractions[_positionManager];
        {
            newData = PositionHouseFunction.handleMarketPart(totalPosition, marketPosition, _newQuantity, _newNotional, newQuantityInt, _leverage, cumulativePremiumFractions);
        }
        positionMap[_positionManager][_trader].update(
            newData
        );
    }

    function getListOrderPending(IPositionManager _positionManager, address _trader) public view returns (LimitOrderPending[] memory){

        return PositionHouseFunction.getListOrderPending(
            address(_positionManager),
            _trader,
            limitOrders[address(_positionManager)][_trader],
            reduceLimitOrders[address(_positionManager)][_trader]);

    }

    function getPosition(
        address positionManager,
        address _trader
    ) public view returns (Position.Data memory positionData){
        positionData = positionMap[positionManager][_trader];
        PositionLimitOrder.Data[] memory _limitOrders = limitOrders[positionManager][_trader];
        PositionLimitOrder.Data[] memory _reduceOrders = reduceLimitOrders[positionManager][_trader];
        positionData = PositionHouseFunction.calculateLimitOrder(positionManager, _limitOrders, _reduceOrders, positionData);
        positionData.margin += uint256(manualMargin[positionManager][_trader]);
        Position.LiquidatedData memory _debtPosition = debtPosition[positionManager][_trader];
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
        Position.Data memory totalPosition
    ) public view returns
    (
        uint256 positionNotional,
        int256 unrealizedPnl
    ){
        (positionNotional, unrealizedPnl) = PositionHouseFunction.getPositionNotionalAndUnrealizedPnl(address(positionManager), _trader, _pnlCalcOption, totalPosition);
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
    ) public view returns (uint256 maintenanceMargin, int256 marginBalance, uint256 marginRatio) {
        Position.Data memory positionData = getPosition(address(_positionManager), _trader);
        (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(_positionManager, _trader, PnlCalcOption.SPOT_PRICE, positionData);
        (uint256 remainMarginWithFundingPayment,,,) = calcRemainMarginWithFundingPayment(_positionManager, positionData, positionData.margin);
        maintenanceMargin = (remainMarginWithFundingPayment - uint256(manualMargin[address(_positionManager)][_trader])) * maintenanceMarginRatio / 100;
        marginBalance = int256(remainMarginWithFundingPayment) + unrealizedPnl;
        marginRatio = marginBalance <= 0 ? 100 : maintenanceMargin * 100 / uint256(marginBalance);
    }

    function getLatestCumulativePremiumFraction(IPositionManager _positionManager) public view returns (int256){
        uint256 len = cumulativePremiumFractions[address(_positionManager)].length;
        if (len > 0) {
            return cumulativePremiumFractions[address(_positionManager)][len - 1];
        }
    }

    function payFunding(IPositionManager _positionManager) external onlyOwner {
        int256 premiumFraction = _positionManager.settleFunding();
        cumulativePremiumFractions[address(_positionManager)].push(
            premiumFraction + getLatestCumulativePremiumFraction(_positionManager)
        );
    }

    function calcFee(
        address _trader,
        IPositionManager _positionManager,
        uint256 _positionNotional
    ) internal returns (uint256) {
        return _positionManager.calcFee(_positionNotional);
    }

    function withdraw(IPositionManager _positionManager, address _trader, uint256 amount) internal {
        insuranceFund.withdraw(address(_positionManager.getQuoteAsset()), _trader, amount);
    }

    function deposit(IPositionManager _positionManager, address _trader, uint256 amount, uint256 openNotional) internal {
        uint256 fee = calcFee(_trader, _positionManager, openNotional);
        insuranceFund.deposit(address(_positionManager.getQuoteAsset()), _trader, amount + fee);
        insuranceFund.updateTotalFee(fee);
    }


    //
    // INTERNAL FUNCTION OF POSITION HOUSE
    //

    //    function openMarketOrder(
    //        IPositionManager _positionManager,
    //        uint256 _quantity,
    //        Position.Side _side
    //    ) internal returns (int256 exchangedQuantity, uint256 openNotional) {
    //        address _trader = _msgSender();
    //        // TODO higher gas price but lower contract's size
    //        (exchangedQuantity, openNotional) = PositionHouseFunction.openMarketOrder(address(_positionManager), _quantity, _side, _trader);
    //    }

    function calcRemainMarginWithFundingPayment(
        IPositionManager _positionManager, Position.Data memory oldPosition, uint256 deltaMargin
    ) internal view returns (uint256 remainMargin, uint256 badDebt, int256 fundingPayment, int256 latestCumulativePremiumFraction){

        // calculate fundingPayment
        latestCumulativePremiumFraction = getLatestCumulativePremiumFraction(_positionManager);
        if (oldPosition.quantity != 0) {
            fundingPayment = (latestCumulativePremiumFraction - oldPosition.lastUpdatedCumulativePremiumFraction) * oldPosition.quantity;
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
        Position.Data memory totalPosition,
        address _trader
    ) internal returns (PositionResp memory positionResp){
        (positionResp.exchangedPositionSize,) = PositionHouseFunction.openMarketOrder(address(_positionManager), _quantity.abs(), _side, _trader);
        positionResp.exchangedQuoteAssetAmount = _quantity.abs() * (totalPosition.openNotional / totalPosition.quantity.abs());
        (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(_positionManager, _trader, PnlCalcOption.SPOT_PRICE, totalPosition);
        // TODO need to calculate remain margin with funding payment
        uint256 remainMargin = totalPosition.margin * (100 - liquidationFeeRatio) / 100;
        // unchecked
        positionResp.marginToVault = int256(totalPosition.margin) - int256(remainMargin);
        positionResp.unrealizedPnl = unrealizedPnl;
        debtPosition[address(_positionManager)][_trader].updateDebt(
            - _quantity,
            totalPosition.margin - remainMargin,
            positionResp.exchangedQuoteAssetAmount
        );
        return positionResp;
    }

    // UPDATE VARIABLE STORAGE

    function updatePartialLiquidationRatio(uint256 _partialLiquidationRatio) public onlyOwner {
        partialLiquidationRatio = _partialLiquidationRatio;
    }

    function updateLiquidationPenaltyRatio(uint256 _liquidationPenaltyRatio) public onlyOwner {
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
