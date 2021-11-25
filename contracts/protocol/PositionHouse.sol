pragma solidity ^0.8.0;

import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "../interfaces/IPositionManager.sol";
import "./libraries/position/Position.sol";
import "hardhat/console.sol";
import "./PositionManager.sol";
import "./libraries/helpers/Quantity.sol";
import "./libraries/position/PositionLimitOrder.sol";
import "../interfaces/IInsuranceFund.sol";
import "../interfaces/IFeePool.sol";
import {PositionHouseFunction} from "./libraries/position/PositionHouseFunction.sol";

contract PositionHouse is Initializable, ReentrancyGuardUpgradeable, OwnableUpgradeable
{
    using PositionLimitOrder for mapping(address => mapping(address => PositionLimitOrder.Data[]));
    using Quantity for int256;
    using Quantity for int128;

    using Position for Position.Data;
    using Position for Position.LiquidatedData;
    //    using PositionHouseFunction for PositionHouse;

    enum PnlCalcOption {
        TWAP,
        SPOT_PRICE,
        ORACLE
    }

    struct PositionResp {

        Position.Data position;
        // NOTICE margin to vault can be negative
        int256 marginToVault;

        int256 realizedPnl;

        int256 unrealizedPnl;

        int256 exchangedPositionSize;

        uint256 exchangedQuoteAssetAmount;

        uint256 fundingPayment;

    }


    struct LimitOrderPending {
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

    //    struct PositionManagerData {
    //        uint24 blockNumber;
    //        int256[] cumulativePremiumFraction;
    //        // Position data of each trader
    //        mapping(address => Position.Data) positionMap;
    //        mapping(address => PositionLimitOrder.Data[]) limitOrders;
    //        mapping(address => PositionLimitOrder.Data[]) reduceLimitOrders;
    //        // Amount that trader can claim from exchange
    //        mapping(address => int256) canClaimAmount;
    //    }
    //    // TODO change separate mapping to positionManagerMap
    //    mapping(address => PositionManagerData) public positionManagerMap;

    // Can join positionMap and cumulativePremiumFractionsMap into a map of struct with key is PositionManager's address
    // Mapping from position manager address of each pair to position data of each trader
    mapping(address => mapping(address => Position.Data)) public positionMap;
    //    mapping(address => int256[]) public cumulativePremiumFractionsMap;

    mapping(address => mapping(address => Position.LiquidatedData)) public debtPosition;
    mapping(address => mapping(address => uint256)) public canClaimAmountMap;

    // update added margin type from int256 to uint256
    mapping(address => mapping(address => int256)) public manualMargin;
    //can update with index => no need delete array when close all
    mapping(address => mapping(address => PositionLimitOrder.Data[])) public limitOrders;
    mapping(address => mapping(address => PositionLimitOrder.Data[])) public reduceLimitOrders;

    uint256 maintenanceMarginRatio;
    uint256 partialLiquidationRatio;
    uint256 liquidationFeeRatio;
    uint256 liquidationPenaltyRatio;

    IInsuranceFund public insuranceFund;
    IFeePool public feePool;

    modifier whenNotPause(){
        //TODO implement
        _;
    }

    event OpenMarket(
        address trader,
        int256 quantity,
        uint256 leverage,
        uint256 priceMarket,
        IPositionManager positionManager
    );
    event OpenLimit(
        uint64 orderIdOfTrader,
        uint64 orderId,
        address trader,
        int256 quantity,
        uint256 leverage,
        int128 pip,
        IPositionManager positionManager
    );

    event CancelLimit(
        uint64 orderIdOfTrader,
        uint64 orderId,
        address trader,
        int128 pip,
        IPositionManager positionManager
    );

    event AddMargin(address trader, uint256 marginAdded, IPositionManager positionManager);

    event RemoveMargin(address trader, uint256 marginRemoved, IPositionManager positionManager);

    event CancelLimitOrder(address trader, address _positionManager, uint64 orderIdOfTrader, uint64 orderId);

    event Liquidate(address positionManager, address trader);

    function initialize(
        uint256 _maintenanceMarginRatio,
        uint256 _partialLiquidationRatio,
        uint256 _liquidationFeeRatio,
        uint256 _liquidationPenaltyRatio,
        address _insuranceFund,
        address _feePool
    ) public initializer {
        maintenanceMarginRatio = _maintenanceMarginRatio;
        partialLiquidationRatio = _partialLiquidationRatio;
        liquidationFeeRatio = _liquidationFeeRatio;
        liquidationPenaltyRatio = _liquidationPenaltyRatio;
        insuranceFund = IInsuranceFund(_insuranceFund);
        feePool = IFeePool(_feePool);
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
    ) public whenNotPause nonReentrant {
        // TODO update require quantity > minimum amount of each pair
        require(_quantity == (_quantity / 1000000000000000 * 1000000000000000), "IQ");
        //        requirePositionManager(_positionManager);

        address _trader = _msgSender();
        Position.Data memory oldPosition = getPosition(address(_positionManager), _trader);
        if (oldPosition.quantity == 0) {
            oldPosition.leverage = 1;
        }
        require(_leverage >= oldPosition.leverage && _leverage <= 125 && _leverage > 0, "IL");
        PositionResp memory positionResp;
        // check if old position quantity is same side with new
        if (oldPosition.quantity == 0 || oldPosition.side() == _side) {
            positionResp = increasePosition(_positionManager, _side, int256(_quantity), _leverage);
        } else {
            // TODO adjust old position
            positionResp = openReversePosition(_positionManager, _side, _side == Position.Side.LONG ? int256(_quantity) : - int256(_quantity), _leverage);
        }
        // update position sate
        positionMap[address(_positionManager)][_trader].update(
            positionResp.position
        );

        if (positionResp.marginToVault > 0) {
            //transfer from trader to vault
            deposit(_positionManager, _trader, positionResp.marginToVault.abs());
        } else if (positionResp.marginToVault < 0) {
            // withdraw from vault to user
            withdraw(_positionManager, _trader, positionResp.marginToVault.abs());
        }
//        canClaimAmountMap[address(_positionManager)][_trader] += positionResp.marginToVault.abs();
        emit OpenMarket(_trader, _side == Position.Side.LONG ? int256(_quantity) : - int256(_quantity), _leverage, positionResp.exchangedQuoteAssetAmount / _quantity, _positionManager);
    }

    /**
    * @notice open position with price limit
    * @param _positionManager IPositionManager address
    * @param _side Side of position LONG or SHORT
    * @param _quantity quantity of size after mul with leverage
    * @param _pip is pip converted from limit price of position
    * @param _leverage leverage of position
    */
    function openLimitOrder(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _quantity,
        int128 _pip,
        uint256 _leverage
    ) public whenNotPause nonReentrant {
        require(_quantity == (_quantity / 1000000000000000 * 1000000000000000), "IQ");
        require(_pip > 0, "IP");
        //        requirePositionManager(_positionManager);
        address _trader = _msgSender();
        uint64 orderIdOfUser;
        OpenLimitResp memory openLimitResp;
        (, openLimitResp.orderId, openLimitResp.sizeOut) = openLimitIncludeMarket(_positionManager, _trader, _pip, int256(_quantity).abs128(), _side == Position.Side.LONG ? true : false, _leverage);
        {
            PositionLimitOrder.Data memory _newOrder = PositionLimitOrder.Data({
            pip : _pip,
            orderId : openLimitResp.orderId,
            leverage : uint16(_leverage),
            isBuy : _side == Position.Side.LONG ? 1 : 2,
            entryPrice : 0,
            pnlCalcPrice : 0,
            reduceQuantity : 0,
            blockNumber : block.number
            });
            orderIdOfUser = handleLimitOrderInOpenLimit(openLimitResp, _newOrder, _positionManager, _trader, _quantity, _side);
        }

        uint256 depositAmount = _quantity * _positionManager.pipToPrice(_pip) / _leverage / _positionManager.getBaseBasisPoint();
        deposit(_positionManager, _trader, depositAmount);
        canClaimAmountMap[address(_positionManager)][_trader] += depositAmount;
        emit OpenLimit(orderIdOfUser, openLimitResp.orderId, _trader, _side == Position.Side.LONG ? int256(_quantity) : - int256(_quantity), _leverage, _pip, _positionManager);
    }

    function openLimitIncludeMarket(IPositionManager _positionManager, address _trader, int128 _pip, uint128 _quantity, bool _isBuy, uint256 _leverage) internal returns (PositionResp memory positionResp, uint64 orderId, uint256 sizeOut){
        {
            Position.Data memory totalPositionData = getPosition(address(_positionManager), _trader);
            require(_leverage >= totalPositionData.leverage && _leverage <= 125 && _leverage > 0, "IL");
            (int128 currentPip, uint8 isFullBuy) = _positionManager.getCurrentSingleSlot();
            uint256 openNotional;
            //1: buy
            //2: sell
            if (_pip == currentPip && isFullBuy != (_isBuy ? 1 : 2) && _isBuy != (totalPositionData.quantity > 0 ? true : false)) {// not is full buy -> open opposite orders
                uint128 liquidityInCurrentPip = _positionManager.getLiquidityInCurrentPip();
                if (totalPositionData.quantity.abs() <= liquidityInCurrentPip && totalPositionData.quantity.abs() <= _quantity && totalPositionData.quantity.abs() != 0) {
                    {
                        PositionResp memory closePositionResp = internalClosePosition(_positionManager, _trader, PnlCalcOption.SPOT_PRICE, true);
                        if (int256(_quantity) - closePositionResp.exchangedPositionSize == 0) {
                            positionResp = closePositionResp;
                        } else {
                            (orderId, sizeOut, openNotional) = _positionManager.openLimitPosition(_pip, _quantity - (closePositionResp.exchangedPositionSize).abs128(), _isBuy);
                        }
                    }
                } else {
                    (orderId, sizeOut, openNotional) = _positionManager.openLimitPosition(_pip, _quantity, _isBuy);
                }
                handleMarketQuantityInLimitOrder(address(_positionManager), _trader, sizeOut, openNotional, _leverage, _isBuy);
            } else {
                (orderId, sizeOut, openNotional) = _positionManager.openLimitPosition(_pip, _quantity, _isBuy);
                handleMarketQuantityInLimitOrder(address(_positionManager), _trader, sizeOut, openNotional, _leverage, _isBuy);
            }
        }

    }

    // check the new limit order is fully reduce, increase or both reduce and increase
    function handleLimitOrderInOpenLimit(
        OpenLimitResp memory openLimitResp,
        PositionLimitOrder.Data memory _newOrder,
        IPositionManager _positionManager,
        address _trader,
        uint256 _quantity,
        Position.Side _side
    ) internal returns (uint64 orderIdOfUser) {
        Position.Data memory _oldPosition = getPosition(address(_positionManager), _trader);

        if (_oldPosition.quantity == 0 || _side == (_oldPosition.quantity > 0 ? Position.Side.LONG : Position.Side.SHORT)) {
            limitOrders[address(_positionManager)][_trader].push(_newOrder);
            orderIdOfUser = uint64(limitOrders[address(_positionManager)][_trader].length - 1);
        } else {
            // if new limit order is smaller than old position then just reduce old position
            if (_oldPosition.quantity.abs() > _quantity) {
                _newOrder.reduceQuantity = _quantity - openLimitResp.sizeOut;
                _newOrder.entryPrice = _oldPosition.openNotional * _positionManager.getBaseBasisPoint() / _oldPosition.quantity.abs();
//                _newOrder.pnlCalcPrice = _positionManager.pipToPrice(_newOrder.pip);
                reduceLimitOrders[address(_positionManager)][_trader].push(_newOrder);
                orderIdOfUser = uint64(reduceLimitOrders[address(_positionManager)][_trader].length - 1);
            }
            // else new limit order is larger than old position then close old position and open new opposite position
            else {
                _newOrder.reduceQuantity = _oldPosition.quantity.abs();
                limitOrders[address(_positionManager)][_trader].push(_newOrder);
                orderIdOfUser = uint64(limitOrders[address(_positionManager)][_trader].length - 1);
                _newOrder.entryPrice = _oldPosition.openNotional * _positionManager.getBaseBasisPoint() / _oldPosition.quantity.abs();
                _newOrder.pnlCalcPrice = 1;
                reduceLimitOrders[address(_positionManager)][_trader].push(_newOrder);
            }
        }
    }

    function cancelLimitOrder(IPositionManager _positionManager, uint64 orderIdOfTrader, int128 pip, uint64 orderId) public whenNotPause nonReentrant {
        //        requirePositionManager(_positionManager);
        address _trader = _msgSender();
        uint256 refundQuantity = _positionManager.cancelLimitOrder(pip, orderId);
        int128 oldOrderPip = limitOrders[address(_positionManager)][_trader][orderIdOfTrader].pip;
        uint64 oldOrderId = limitOrders[address(_positionManager)][_trader][orderIdOfTrader].orderId;
        uint16 leverage;
        PositionLimitOrder.Data memory blankLimitOrderData;
        if (pip == oldOrderPip && orderId == oldOrderId) {
            leverage = limitOrders[address(_positionManager)][_trader][orderIdOfTrader].leverage;
            (,,, uint256 partialFilled) = _positionManager.getPendingOrderDetail(pip, orderId);
            if (partialFilled == 0){
                limitOrders[address(_positionManager)][_trader][orderIdOfTrader] = blankLimitOrderData;
            }
        } else {
            leverage = reduceLimitOrders[address(_positionManager)][_trader][orderIdOfTrader].leverage;
            (,,, uint256 partialFilled) = _positionManager.getPendingOrderDetail(pip, orderId);
            if (partialFilled == 0){
                reduceLimitOrders[address(_positionManager)][_trader][orderIdOfTrader] = blankLimitOrderData;
            }
        }

        require(leverage >= 0 && leverage <= 125, "IL");

        uint256 refundMargin = refundQuantity * _positionManager.pipToPrice(pip) / uint256(leverage) / _positionManager.getBaseBasisPoint();
        withdraw(_positionManager, _trader, refundMargin);
        canClaimAmountMap[address(_positionManager)][_trader] -= refundMargin;
        emit CancelLimitOrder(_trader, address(_positionManager), orderIdOfTrader, orderId);
    }

    /**
    * @notice close position with close market
    * @param _positionManager IPositionManager address
    * @param _quantity want to close
    */
    function closePosition(
        IPositionManager _positionManager,
//        uint256 _percentQuantity,
        uint256 _quantity
    ) public {
        address _trader = _msgSender();
        Position.Data memory positionData = getPosition(address(_positionManager), _trader);
//        require(_percentQuantity > 0 && _percentQuantity <= 100, "IPQ");
        require(_quantity > 0 && _quantity <= positionData.quantity.abs(), "ICQ");
        //        requirePositionManager(_positionManager);
        // only when close 100% position need to close pending order
        if (_quantity == positionData.quantity.abs()) {
            require(getListOrderPending(_positionManager, _trader).length == 0, "ICP");
        }
        // check conditions
        //        requirePositionManager(_positionManager, true);


        PositionResp memory positionResp;

        if (positionData.quantity > 0) {
//            openMarketPosition(_positionManager, Position.Side.SHORT, uint256(positionData.quantity) * _percentQuantity / 100, positionData.leverage);
            openMarketPosition(_positionManager, Position.Side.SHORT, _quantity, positionData.leverage);
        } else {
//            openMarketPosition(_positionManager, Position.Side.LONG, uint256(- positionData.quantity) * _percentQuantity / 100, positionData.leverage);
            openMarketPosition(_positionManager, Position.Side.LONG, _quantity, positionData.leverage);
        }

    }

    /**
    * @notice close position with close market
    * @param _positionManager IPositionManager address
    * @param _pip limit price want to close
    * @param _quantity want to close
    */
    function closeLimitPosition(
        IPositionManager _positionManager,
        int128 _pip,
//        uint256 _percentQuantity,
        uint256 _quantity
    ) public {
        address _trader = _msgSender();
        Position.Data memory positionData = getPosition(address(_positionManager), _trader);
//        require(_percentQuantity > 0 && _percentQuantity <= 100, "IPQ");
        //        requirePositionManager(_positionManager);
        require(_quantity > 0 && _quantity <= positionData.quantity.abs(), "ICQ");
        if (_quantity == positionData.quantity.abs()) {
            require(getListOrderPending(_positionManager, _trader).length == 0, "ICP");
        }



        if (positionData.quantity > 0) {
//            openLimitOrder(_positionManager, Position.Side.SHORT, uint256(positionData.quantity) * _percentQuantity / 100, _pip, positionData.leverage);
            openLimitOrder(_positionManager, Position.Side.SHORT, _quantity, _pip, positionData.leverage);
        } else {
//            openLimitOrder(_positionManager, Position.Side.LONG, uint256(- positionData.quantity) * _percentQuantity / 100, _pip, positionData.leverage);
            openLimitOrder(_positionManager, Position.Side.LONG, _quantity, _pip, positionData.leverage);
        }
    }

    function getClaimAmount(IPositionManager _positionManager, address _trader) public view returns (int256 totalClaimableAmount) {
        Position.Data memory positionData = getPosition(address(_positionManager), _trader);
        return PositionHouseFunction.getClaimAmount(address(_positionManager), _trader, positionData, limitOrders[address(_positionManager)][_trader], reduceLimitOrders[address(_positionManager)][_trader], positionMap[address(_positionManager)][_trader], canClaimAmountMap[address(_positionManager)][_trader], manualMargin[address(_positionManager)][_trader]);
    }

    function claimFund(IPositionManager _positionManager) public whenNotPause nonReentrant {
        address _trader = _msgSender();
        int256 totalRealizedPnl = getClaimAmount(_positionManager, _trader);
        require(getPosition(address(_positionManager), _trader).quantity == 0 && getListOrderPending(_positionManager, _trader).length == 0, "ICF");
        clearPosition(_positionManager, _trader);
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
    ) external whenNotPause nonReentrant {
        //        requirePositionManager(_positionManager);
        address _caller = _msgSender();
        (uint256 maintenanceMargin, int256 marginBalance, uint256 marginRatio) = getMaintenanceDetail(_positionManager, _trader);

        // TODO before liquidate should we check can claimFund, because trader has close position limit before liquidate
        // require trader's margin ratio higher than partial liquidation ratio
        require(marginRatio >= partialLiquidationRatio, "NEMR");

        PositionResp memory positionResp;
        uint256 liquidationPenalty;
        {
            uint256 feeToLiquidator;
            uint256 feeToInsuranceFund;
            Position.Data memory positionData = getPosition(address(_positionManager), _trader);
            // partially liquidate position
            if (marginRatio >= partialLiquidationRatio && marginRatio < 100) {

                // calculate amount quantity of position to reduce
                int256 partiallyLiquidateQuantity = positionData.quantity * int256(liquidationPenaltyRatio) / 100;
                //                uint256 oldPositionLeverage = positionData.openNotional / positionData.margin;
                // partially liquidate position by reduce position's quantity
                if (positionData.quantity > 0) {
                    positionResp = partialLiquidate(_positionManager, Position.Side.SHORT, - partiallyLiquidateQuantity, positionData, _trader);
                } else {
                    positionResp = partialLiquidate(_positionManager, Position.Side.LONG, - partiallyLiquidateQuantity, positionData, _trader);
                }

                // half of the liquidationFee goes to liquidator & another half goes to insurance fund
                liquidationPenalty = uint256(positionResp.marginToVault);
                feeToLiquidator = liquidationPenalty / 2;
                feeToInsuranceFund = liquidationPenalty - feeToLiquidator;
                // TODO take liquidation fee
            } else {
                // fully liquidate trader's position
                liquidationPenalty = positionData.margin + uint256(manualMargin[address(_positionManager)][_trader]);
                withdraw(_positionManager, _trader, (uint256(getClaimAmount(_positionManager, _trader)) + positionData.margin));
                clearPosition(_positionManager, _trader);
                feeToLiquidator = liquidationPenalty * liquidationFeeRatio / 2 / 100;
            }
            withdraw(_positionManager, _caller, feeToLiquidator);
            // count as bad debt, transfer money to insurance fund and liquidator
            // emit event position liquidated
        }
        emit Liquidate(address(_positionManager), _trader);
        // emit event
    }

    /**
     * @notice add margin to decrease margin ratio
     * @param _positionManager IPositionManager address
     * @param _marginAdded added margin
     */
    function addMargin(IPositionManager _positionManager, uint256 _marginAdded) external whenNotPause nonReentrant {

        address _trader = _msgSender();
        Position.Data memory oldPositionData = getPosition(address(_positionManager), _trader);
        require(oldPositionData.quantity != 0, "NPTA");
        if (oldPositionData.quantity != 0) {
            manualMargin[address(_positionManager)][_trader] += int256(_marginAdded);
        }

        deposit(_positionManager, _trader, _marginAdded);

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
    function removeMargin(IPositionManager _positionManager, uint256 _marginRemoved) external whenNotPause nonReentrant {

        address _trader = _msgSender();

        Position.Data memory oldPositionData = getPosition(address(_positionManager), _trader);
        require(oldPositionData.quantity != 0, "NPTR");
        uint256 removableMargin = uint256(getRemovableMargin(_positionManager, _trader));
        require(_marginRemoved <= removableMargin, "IRM");

        manualMargin[address(_positionManager)][_trader] -= int256(_marginRemoved);

        withdraw(_positionManager, _trader, _marginRemoved);

        emit RemoveMargin(_trader, _marginRemoved, _positionManager);
    }

    function getRemovableMargin(IPositionManager _positionManager, address _trader) public view returns (int256) {
        int256 addedMargin = manualMargin[address(_positionManager)][_trader];
        (uint256 maintenanceMargin ,int256 marginBalance , ) = getMaintenanceDetail(_positionManager, _trader);
        int256 removableMargin = (marginBalance - int256(maintenanceMargin)) > 0 ? (marginBalance - int256(maintenanceMargin)) : 0;
        return addedMargin <= (marginBalance - int256(maintenanceMargin)) ? addedMargin : removableMargin;
    }

    /**
     * @notice clear all attribute of
     * @param _positionManager IPositionManager address
     * @param _trader address to clean position
     */
    // IMPORTANT UPDATE CLEAR LIMIT ORDER
    function clearPosition(IPositionManager _positionManager, address _trader) internal {
        positionMap[address(_positionManager)][_trader].clear();
        debtPosition[address(_positionManager)][_trader].clearDebt();
        manualMargin[address(_positionManager)][_trader] = 0;
        canClaimAmountMap[address(_positionManager)][_trader] = 0;
        //        PositionLimitOrder.Data[] memory listLimitOrder = limitOrders[address(_positionManager)][_trader];
//        PositionLimitOrder.Data[] memory reduceLimitOrder = reduceLimitOrders[address(_positionManager)][_trader];
//        (PositionLimitOrder.Data[] memory subListLimitOrder, PositionLimitOrder.Data[] memory subReduceLimitOrder) = PositionHouseFunction.clearAllFilledOrder(_positionManager, _trader, listLimitOrder, reduceLimitOrder);

        if (limitOrders[address(_positionManager)][_trader].length > 0) {
            delete limitOrders[address(_positionManager)][_trader];
        }
//        for (uint256 i = 0; i < subListLimitOrder.length; i++) {
//            limitOrders[address(_positionManager)][_trader][i] = (subListLimitOrder[i]);
//        }
        if (reduceLimitOrders[address(_positionManager)][_trader].length > 0) {
            delete reduceLimitOrders[address(_positionManager)][_trader];
        }
//        for (uint256 i = 0; i < subReduceLimitOrder.length; i++) {
//            reduceLimitOrders[address(_positionManager)][_trader][i] = (subReduceLimitOrder[i]);
//        }
    }

    // TODO can move to position house function
    function increasePosition(
        IPositionManager _positionManager,
        Position.Side _side,
        int256 _quantity,
        uint256 _leverage
    ) internal returns (PositionResp memory positionResp) {
        address _trader = _msgSender();
        (positionResp.exchangedPositionSize, positionResp.exchangedQuoteAssetAmount) = openMarketOrder(_positionManager, _quantity.abs(), _side);
        if (positionResp.exchangedPositionSize != 0) {
            int256 _newSize = positionMap[address(_positionManager)][_trader].quantity + positionResp.exchangedPositionSize;
            uint256 increaseMarginRequirement = positionResp.exchangedQuoteAssetAmount / _leverage;
            // TODO update function latestCumulativePremiumFraction
            uint256 remainMargin = handleMarginInIncrease(address(_positionManager), _trader, increaseMarginRequirement);

            Position.Data memory positionData = getPosition(address(_positionManager), _trader);
            (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(_positionManager, _trader, PnlCalcOption.SPOT_PRICE, positionData);

            // update positionResp
            positionResp.unrealizedPnl = unrealizedPnl;
            positionResp.realizedPnl = 0;
            // checked margin to vault
            positionResp.marginToVault = int256(increaseMarginRequirement);
            positionResp.position = Position.Data(
                _newSize,
                remainMargin,
            // NEW FUNCTION handleNotionalInIncrease
                handleNotionalInIncrease(address(_positionManager), _trader, positionResp.exchangedQuoteAssetAmount),
                0,
                block.number,
                _leverage
            );
        }
    }

    function openReversePosition(
        IPositionManager _positionManager,
        Position.Side _side,
        int256 _quantity,
        uint256 _leverage
    ) internal returns (PositionResp memory positionResp) {

        address _trader = _msgSender();
        Position.Data memory oldPosition = getPosition(address(_positionManager), _trader);

        if (_quantity.abs() < oldPosition.quantity.abs()) {
            uint256 reduceMarginRequirement = oldPosition.margin * _quantity.abs() / oldPosition.quantity.abs();
            int256 totalQuantity = positionMap[address(_positionManager)][_trader].quantity + _quantity;
            (positionResp.exchangedPositionSize,) = openMarketOrder(_positionManager, _quantity.abs(), _side);

            (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(_positionManager, _trader, PnlCalcOption.SPOT_PRICE, oldPosition);
            positionResp.realizedPnl = unrealizedPnl * int256(positionResp.exchangedPositionSize) / oldPosition.quantity;
            // NEW FUNCTION handleMarginInOpenReverse
            uint256 remainMargin = handleMarginInOpenReverse(address(_positionManager), _trader, reduceMarginRequirement);
            positionResp.exchangedQuoteAssetAmount = _quantity.abs() * oldPosition.getEntryPrice(address(_positionManager)) / _positionManager.getBaseBasisPoint();
            // NOTICE margin to vault can be negative
            // checked margin to vault
            positionResp.marginToVault = - (int256(reduceMarginRequirement) + positionResp.realizedPnl);
            // NOTICE calc unrealizedPnl after open reverse
            positionResp.unrealizedPnl = unrealizedPnl - positionResp.realizedPnl;
            {
                positionResp.position = Position.Data(
                    totalQuantity,
                    remainMargin,
                    handleNotionalInOpenReverse(address(_positionManager), _trader, positionResp.exchangedQuoteAssetAmount),
                    0,
                    block.number,
                    _leverage
                );
            }
            return positionResp;
        }
        // if new position is larger then close old and open new
        return closeAndOpenReversePosition(_positionManager, _side, _quantity, _leverage, oldPosition.openNotional);
    }

    function closeAndOpenReversePosition(
        IPositionManager _positionManager,
        Position.Side _side,
        int256 _quantity,
        uint256 _leverage,
        uint256 _oldOpenNotional
    ) internal returns (PositionResp memory positionResp) {
        address _trader = _msgSender();
        PositionResp memory closePositionResp = internalClosePosition(_positionManager, _trader, PnlCalcOption.SPOT_PRICE, false);
        if (_quantity - closePositionResp.exchangedPositionSize == 0) {
            positionResp = closePositionResp;
        } else {
            PositionResp memory increasePositionResp = increasePosition(_positionManager, _side, _quantity - closePositionResp.exchangedPositionSize, _leverage);
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
        bool isInOpenLimit
    ) internal returns (PositionResp memory positionResp) {
        Position.Data memory oldPosition = getPosition(address(_positionManager), _trader);
        //        uint256 _currentPrice = _positionManager.getPrice();
        (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(_positionManager, _trader, _pnlCalcOption, oldPosition);
        uint256 openMarketQuantity = oldPosition.quantity.abs();
        require(openMarketQuantity != 0, "IQIC");
        if (isInOpenLimit){
            uint256 liquidityInCurrentPip = uint256(_positionManager.getLiquidityInCurrentPip());
            openMarketQuantity = liquidityInCurrentPip > oldPosition.quantity.abs() ? oldPosition.quantity.abs() : liquidityInCurrentPip;
        }

//         positionResp = PositionHouseFunction.internalClosePosition(address(_positionManager), _trader, _pnlCalcOption, oldPosition, openMarketQuantity);


        if (oldPosition.quantity > 0) {
            //sell
            (positionResp.exchangedPositionSize, positionResp.exchangedQuoteAssetAmount) = openMarketOrder(_positionManager, openMarketQuantity, Position.Side.SHORT);
        } else {
            // buy
            (positionResp.exchangedPositionSize, positionResp.exchangedQuoteAssetAmount) = openMarketOrder(_positionManager, openMarketQuantity, Position.Side.LONG);
        }

        uint256 remainMargin = oldPosition.margin;

        positionResp.realizedPnl = unrealizedPnl;
        // NOTICE remainMargin can be negative
        // unchecked: should be -(remainMargin + unrealizedPnl) and update remainMargin with fundingPayment
        positionResp.marginToVault = -((int256(remainMargin) + positionResp.realizedPnl + manualMargin[address(_positionManager)][_trader]) < 0 ? 0 : (int256(remainMargin) + positionResp.realizedPnl + manualMargin[address(_positionManager)][_trader]));
        positionResp.unrealizedPnl = 0;
        canClaimAmountMap[address(_positionManager)][_trader] = 0;
        clearPosition(_positionManager, _trader);
    }

    function handleMarketQuantityInLimitOrder(address _positionManager, address _trader, uint256 _newQuantity, uint256 _newNotional, uint256 _leverage, bool _isBuy) internal {
        Position.Data memory newData;
        Position.Data memory marketPositionData = positionMap[_positionManager][_trader];
        Position.Data memory totalPositionData = getPosition(_positionManager, _trader);
        int256 newPositionSide = _isBuy == true ? int256(1) : int256(- 1);
        if (newPositionSide * totalPositionData.quantity >= 0) {
//            newData = Position.Data(
//                marketPositionData.quantity.sumWithUint256(_newQuantity),
//                handleMarginInIncrease(address(_positionManager), _trader, _newNotional / _leverage),
//                handleNotionalInIncrease(address(_positionManager), _trader, _newNotional),
//            // TODO update latest cumulative premium fraction
//                0,
//                block.number,
//                _leverage
//            );
            if (newPositionSide * marketPositionData.quantity >= 0) {
                newData = Position.Data(
//                    marketPositionData.quantity >= 0 ? marketPositionData.quantity + int256(_newQuantity) : marketPositionData.quantity - int256(_newQuantity),
                    marketPositionData.quantity.sumWithUint256(_newQuantity),
                    handleMarginInIncrease(address(_positionManager), _trader, _newNotional / _leverage),
                    handleNotionalInIncrease(address(_positionManager), _trader, _newNotional),
                // TODO update latest cumulative premium fraction
                    0,
                    block.number,
                    _leverage
                );
            } else {
                newData = Position.Data(
//                    marketPositionData.quantity <= 0 ? marketPositionData.quantity + int256(_newQuantity) : marketPositionData.quantity - int256(_newQuantity),
                    marketPositionData.quantity.minusWithUint256(_newQuantity),
                    handleMarginInIncrease(address(_positionManager), _trader, _newNotional / _leverage),
                    handleNotionalInIncrease(address(_positionManager), _trader, _newNotional),
                // TODO update latest cumulative premium fraction
                    0,
                    block.number,
                    _leverage
                );
            }
        } else {
//            newData = Position.Data(
//                marketPositionData.quantity.minusWithUint256(_newQuantity),
//                handleMarginInOpenReverse(address(_positionManager), _trader, totalPositionData.margin * _newQuantity / totalPositionData.quantity.abs()),
//                handleNotionalInOpenReverse(address(_positionManager), _trader, _newNotional),
//            // TODO update latest cumulative premium fraction
//                0,
//                block.number,
//                _leverage
//            );
            if (newPositionSide * marketPositionData.quantity >= 0) {
                newData = Position.Data(
//                    marketPositionData.quantity >= 0 ? marketPositionData.quantity + int256(_newQuantity) : marketPositionData.quantity - int256(_newQuantity),
                    marketPositionData.quantity.sumWithUint256(_newQuantity),
                    handleMarginInOpenReverse(address(_positionManager), _trader, totalPositionData.margin * _newQuantity / totalPositionData.quantity.abs()),
                    handleNotionalInOpenReverse(address(_positionManager), _trader, _newNotional),
                // TODO update latest cumulative premium fraction
                    0,
                    block.number,
                    _leverage
                );
            } else {
                newData = Position.Data(
//                    marketPositionData.quantity <= 0 ? marketPositionData.quantity + int256(_newQuantity) : marketPositionData.quantity - int256(_newQuantity),
                    marketPositionData.quantity.minusWithUint256(_newQuantity),
                    handleMarginInOpenReverse(address(_positionManager), _trader, totalPositionData.margin * _newQuantity / totalPositionData.quantity.abs()),
                    handleNotionalInOpenReverse(address(_positionManager), _trader, _newNotional),
                // TODO update latest cumulative premium fraction
                    0,
                    block.number,
                    _leverage
                );
            }
        }
        positionMap[_positionManager][_trader].update(
            newData
        );
    }

    function handleNotionalInOpenReverse(address _positionManager, address _trader, uint256 exchangedQuoteAmount) internal returns (uint256 openNotional) {
        Position.Data memory marketPositionData = positionMap[_positionManager][_trader];
        Position.Data memory totalPositionData = getPosition(_positionManager, _trader);
        openNotional = PositionHouseFunction.handleNotionalInOpenReverse(exchangedQuoteAmount, marketPositionData, totalPositionData);

    }

    function handleMarginInOpenReverse(address _positionManager, address _trader, uint256 reduceMarginRequirement) internal returns (uint256 margin) {
        Position.Data memory marketPositionData = positionMap[_positionManager][_trader];
        Position.Data memory totalPositionData = getPosition(_positionManager, _trader);

        margin = PositionHouseFunction.handleMarginInOpenReverse(reduceMarginRequirement, marketPositionData, totalPositionData);

    }

    function handleNotionalInIncrease(address _positionManager, address _trader, uint256 exchangedQuoteAmount) internal returns (uint256 openNotional) {
        Position.Data memory marketPositionData = positionMap[_positionManager][_trader];
        Position.Data memory totalPositionData = getPosition(_positionManager, _trader);

        openNotional = PositionHouseFunction.handleNotionalInIncrease(exchangedQuoteAmount, marketPositionData, totalPositionData);
    }

    function handleMarginInIncrease(address _positionManager, address _trader, uint256 increaseMarginRequirement) internal returns (uint256 margin) {
        Position.Data memory marketPositionData = positionMap[_positionManager][_trader];
        Position.Data memory totalPositionData = getPosition(_positionManager, _trader);

        margin = PositionHouseFunction.handleMarginInIncrease(
            increaseMarginRequirement,
            marketPositionData,
            totalPositionData);
    }

    function getListOrderPending(IPositionManager _positionManager, address _trader) public view returns (LimitOrderPending[] memory){

        return PositionHouseFunction.getListOrderPending(
            address(_positionManager),
            _trader,
            limitOrders[address(_positionManager)][_trader],
            reduceLimitOrders[address(_positionManager)][_trader]);

    }

    // TODO can move to position house function
    function getPosition(
        address positionManager,
        address _trader
    ) public view returns (Position.Data memory positionData){
        positionData = positionMap[positionManager][_trader];
        PositionLimitOrder.Data[] memory _limitOrders = limitOrders[positionManager][_trader];
        PositionLimitOrder.Data[] memory _reduceOrders = reduceLimitOrders[positionManager][_trader];
        IPositionManager _positionManager = IPositionManager(positionManager);
        for (uint i = 0; i < _limitOrders.length; i++) {
            if (_limitOrders[i].pip != 0) {
                positionData = _accumulateLimitOrderToPositionData(_positionManager, _limitOrders[i], positionData, _limitOrders[i].entryPrice, _limitOrders[i].reduceQuantity);
            }
        }
        for (uint i = 0; i < _reduceOrders.length; i++) {
            if (_reduceOrders[i].pip != 0) {
                positionData = _accumulateLimitOrderToPositionData(_positionManager, _reduceOrders[i], positionData, _reduceOrders[i].entryPrice, _reduceOrders[i].reduceQuantity);
            }
        }
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
        Position.Data memory oldPosition
    ) public view returns
    (
        uint256 positionNotional,
        int256 unrealizedPnl
    ){
        // TODO remove function getPosition
        oldPosition = getPosition(address(positionManager), _trader);
//        (positionNotional, unrealizedPnl) = PositionHouseFunction.getPositionNotionalAndUnrealizedPnl(address(positionManager), _trader, _pnlCalcOption, oldPosition);

        uint256 oldPositionNotional = oldPosition.openNotional;
        if (_pnlCalcOption == PositionHouse.PnlCalcOption.SPOT_PRICE) {
            positionNotional = positionManager.getPrice() * oldPosition.quantity.abs() / positionManager.getBaseBasisPoint();
        }
        else if (_pnlCalcOption == PositionHouse.PnlCalcOption.TWAP) {
            // TODO get twap price
        }
        else {
            // TODO get oracle price
        }

        if (oldPosition.side() == Position.Side.LONG) {
            unrealizedPnl = int256(positionNotional) - int256(oldPositionNotional);
        } else {
            unrealizedPnl = int256(oldPositionNotional) - int256(positionNotional);
        }
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
//        (uint256 maintenanceMargin, int256 marginBalance, uint256 marginRatio) = PositionHouseFunction.calcMaintenanceDetail(positionData, maintenanceMarginRatio, unrealizedPnl);
        maintenanceMargin = (positionData.margin - uint256(manualMargin[address(_positionManager)][_trader])) * maintenanceMarginRatio / 100;
        marginBalance = int256(positionData.margin) + unrealizedPnl;
        if (marginBalance <= 0) {
            marginRatio = 100;
        } else {
            marginRatio = maintenanceMargin * 100 / uint256(marginBalance);
        }
    }

    //    function getLatestCumulativePremiumFraction(IPositionManager _positionManager) public view returns (int256) {
    //        //        uint256 len = positionManagerMap[address(_positionManager)].cumulativePremiumFraction.length;
    //        //        if (len > 0) {
    //        //            return positionManagerMap[address(_positionManager)].cumulativePremiumFraction[len - 1];
    //        //        }
    //        return 0;
    //    }

    //    function payFunding(IPositionManager _positionManager) external onlyOwner {
    //        //            requirePositionManager(_positionManager, true);
    //
    //        int256 premiumFraction = _positionManager.settleFunding();
    //        //            positionManagerMap[address(_positionManager)].cumulativePremiumFraction.push(premiumFraction + getLatestCumulativePremiumFraction(_positionManager));
    //    }

    function calcFee(
        address _trader,
        IPositionManager _positionManager,
        uint256 _positionNotional
    ) internal returns (uint256) {
            // TODO undo comment calcFee
//        return _positionManager.calcFee(_positionNotional);
        return 0;
    }

    function withdraw(IPositionManager _positionManager, address _trader, uint256 amount) internal {
        insuranceFund.withdraw(address(_positionManager.getQuoteAsset()), _trader, amount);
    }

    function deposit(IPositionManager _positionManager, address _trader, uint256 amount) internal {
        insuranceFund.deposit(address(_positionManager.getQuoteAsset()), _trader, amount);


//        insuranceFund.updateTotalFee(fee);
    }

    //
    // REQUIRE FUNCTIONS
    //
    //    function requirePositionManager(
    //        IPositionManager positionManager
    //    ) private view {
    //
    //        //PMNO : Position Manager Not Open
    //        require(positionManager.open() == true, "PMNO");
    //    }

    // TODO define criteria
//    function requireMoreMarginRatio(uint256 _marginRatio) private view {
//        require(_marginRatio >= partialLiquidationRatio, "NEMR");
//    }

//    function requirePositionSize(
//        int256 _quantity
//    ) private pure {
//        require(_quantity != 0, "IQIC");
//    }

    //
    // INTERNAL FUNCTION OF POSITION HOUSE
    //

    function openMarketOrder(
        IPositionManager _positionManager,
        uint256 _quantity,
        Position.Side _side
    ) internal returns (int256 exchangedQuantity, uint256 openNotional) {
        address _trader = _msgSender();

//        (int256 exchangedQuantity, uint256 openNotional) = PositionHouseFunction.openMarketOrder(address(_positionManager), _quantity, _side, _trader);
        uint256 exchangedSize;

        (exchangedSize, openNotional) = _positionManager.openMarketPosition(_quantity, _side == Position.Side.LONG);
        require(exchangedSize == _quantity, "NELQ");
        exchangedQuantity = _side == Position.Side.LONG ? int256(exchangedSize) : - int256(exchangedSize);
    }


    // TODO update function parameter to positionManager, oldPositionData, marginDelta
    //    function calcRemainMarginWithFundingPayment(
    //        uint256 deltaMargin
    //    ) internal view returns (uint256 remainMargin, uint256 fundingPayment, int256 latestCumulativePremiumFraction){
    //
    //        remainMargin = uint256(deltaMargin);
    //    }

    // new function
    //    function calcRemainMarginWithFundingPaymentNew(
    //        IPositionManager _positionManager, Position.Data memory oldPosition, int256 deltaMargin
    //    ) internal view returns (uint256 remainMargin, uint256 badDebt, int256 fundingPayment, int256 latestCumulativePremiumFraction){
    //
    //        // calculate fundingPayment
    //        latestCumulativePremiumFraction = getLatestCumulativePremiumFraction(_positionManager);
    //        if (oldPosition.quantity != 0) {
    //            fundingPayment = (latestCumulativePremiumFraction - oldPosition.lastUpdatedCumulativePremiumFraction) * oldPosition.quantity;
    //        }
    //
    //        // calculate remain margin, if remain margin is negative, set to zero and leave the rest to bad debt
    //        if (deltaMargin + fundingPayment >= 0) {
    //            remainMargin = uint256(deltaMargin + fundingPayment);
    //        } else {
    //            badDebt = uint256(- fundingPayment - deltaMargin);
    //        }
    //
    //        fundingPayment = 0;
    //        latestCumulativePremiumFraction = 0;
    //    }


    // TODO can move to position house function
    function partialLiquidate(
        IPositionManager _positionManager,
        Position.Side _side,
        int256 _quantity,
        Position.Data memory _oldPosition,
        address _trader
    ) internal returns (PositionResp memory positionResp){
//        Position.Data memory oldPosition = getPosition(address(_positionManager), _trader);
        (positionResp.exchangedPositionSize,) = openMarketOrder(_positionManager, _quantity.abs(), _side);
        positionResp.exchangedQuoteAssetAmount = _quantity.abs() * (_oldPosition.openNotional / _oldPosition.quantity.abs());
        (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(_positionManager, _trader, PnlCalcOption.SPOT_PRICE, _oldPosition);
        // TODO need to calculate remain margin with funding payment
        uint256 remainMargin = _oldPosition.margin * (100 - liquidationFeeRatio) / 100;
        // unchecked
        positionResp.marginToVault = int256(_oldPosition.margin) - int256(remainMargin);
        positionResp.unrealizedPnl = unrealizedPnl;
        debtPosition[address(_positionManager)][_trader].updateDebt(
            - _quantity,
            _oldPosition.margin - remainMargin,
            positionResp.exchangedQuoteAssetAmount
        );
        return positionResp;
    }

    function _accumulateLimitOrderToPositionData(
        IPositionManager _positionManager,
        PositionLimitOrder.Data memory limitOrder,
        Position.Data memory positionData,
        uint256 entryPrice,
        uint256 reduceQuantity) internal view returns (Position.Data memory) {

        return PositionHouseFunction.accumulateLimitOrderToPositionData(address(_positionManager), limitOrder, positionData, entryPrice, reduceQuantity);
    }
}
