pragma solidity ^0.8.0;

import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "../interfaces/IPositionManager.sol";
import "./libraries/position/Position.sol";
import "hardhat/console.sol";
import "./PositionManager.sol";

contract PositionHouse is Initializable, ReentrancyGuardUpgradeable, OwnableUpgradeable
{
    using Position for Position.Data;
    //    enum Side {LONG, SHORT}

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

        uint256 exchangedPositionSize;

        uint256 exchangedQuoteAssetAmount;

        uint256 fundingPayment;

    }

    // Mapping from position manager address of each pair to position data of each trader
    mapping(address => mapping(address => Position.Data)) public positionMap;

    //    mapping(address => mapping(address => )  )

    uint256 maintenanceMarginRatio;
    uint256 maintenanceMarginRatioConst = 3;
    uint256 partialLiquidationRatio;

    modifier whenNotPause(){
        //TODO implement
        _;
    }

    event OpenMarket(
        address trader,
        uint256 quantity,
        Position.Side side,
        uint256 leverage,
        uint256 priceMarket,
        IPositionManager positionManager
    );
    event OpenLimit(
        address trader,
        uint256 quantity,
        Position.Side side,
        uint256 leverage,
        uint256 priceLimit,
        IPositionManager positionManager
    );

    event ChangeMaintenanceMarginRatio (
        uint256 newMaintenanceMarginRatio
    );

    event AddMargin(address trader, uint256 marginAdded, IPositionManager positionManager);

    event RemoveMargin(address trader, uint256 marginRemoved, IPositionManager positionManager);

    function initialize(
        uint256 _maintenanceMarginRatio
    ) public initializer {
        maintenanceMarginRatio = _maintenanceMarginRatio;


    }

    function openMarketPosition(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _quantity,
        uint256 _leverage
    ) public whenNotPause nonReentrant {
        //check input
        address _trader = _msgSender();
        //TODO check is new Position
        //        bool isNewPosition = isNewPosition(_positionManager, _trader);
        Position.Data memory oldPosition = getPosition(address(_positionManager), _trader);
        PositionResp memory positionResp;
        if (oldPosition.quantity == 0 || oldPosition.side == _side) {
            console.log("increasePosition ");
            positionResp = increasePosition(_positionManager, _side, _quantity, _leverage);
        } else {
            console.log('open reverse');
            // TODO adjust old position
            positionResp = openReversePosition(_positionManager, _side, _quantity, _leverage);

        }
        // update position sate
        positionMap[address(_positionManager)][_trader].update(
            positionResp.position
        );

        // TODO transfer money from trader or pay margin + profit to trader

        if (positionResp.marginToVault > 0) {
            //TODO transfer from trader to vault
        } else if (positionResp.marginToVault < 0) {
            // TODO withdraw to user
        }

        emit OpenMarket(_trader, _quantity, _side, _leverage, positionResp.exchangedQuoteAssetAmount / _quantity, _positionManager);
    }

    function openLimitPosition(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _quantity,
        uint256 _limitPrice,
        uint256 _leverage
    ) external whenNotPause nonReentrant {

        address _trader = _msgSender();


        //        emit OpenLimit(_trader, _quantity, _side, _leverage, positionResp.exchangedQuoteAssetAmount / _quantity, _positionManager);


        // TODO transfer money from trader
    }

    function closePosition(
        IPositionManager _positionManager
    ) public {

        // check conditions
        requirePositionManager(_positionManager, true);

        address _trader = _msgSender();
        Position.Data memory positionData = getPosition(address(_positionManager), _trader);

        uint256 oldPositionLeverage = positionData.openNotional / positionData.margin;
        PositionResp memory positionResp;
        if (positionData.side == Position.Side.LONG) {
            openMarketPosition(_positionManager, Position.Side.SHORT, positionData.quantity, oldPositionLeverage);
        } else {
            openMarketPosition(_positionManager, Position.Side.LONG, positionData.quantity, oldPositionLeverage);
        }
    }


    function liquidate(
        IPositionManager _positionManager,
        address _trader
    ) external {
        requirePositionManager(_positionManager, true);
        (uint256 maintenanceMargin, int256 marginBalance, uint256 marginRatio) = getMaintenanceDetail(_positionManager, _trader);

        requireMoreMarginRatio(marginRatio);

        PositionResp memory positionResp;
        uint256 liquidationPenalty;
//        {
//            uint256 feeToLiquidator;
//            uint256 feeToInsuranceFund;
//            if (marginRatio >= partialLiquidationRatio) {
//
//            }
//        }

    }

    function addMargin(IPositionManager _positionManager, uint256 _marginAdded) external {

        address _trader = _msgSender();
        Position.Data memory positionData = getPosition(address(_positionManager), _trader);
        positionData.margin = positionData.margin + _positionManager.calcAdjustMargin(_marginAdded);

        positionMap[address(_positionManager)][_trader].update(
            positionData
        );

        // TODO transfer money from trader to protocol


        emit AddMargin(_trader, _marginAdded, _positionManager);

    }

    function removeMargin(IPositionManager _positionManager, uint256 _marginRemoved) external {

        address _trader = _msgSender();

        Position.Data memory positionData = getPosition(address(_positionManager), _trader);

        _marginRemoved = _positionManager.calcAdjustMargin(_marginRemoved);


        //        console.log("positionData.margin ", positionData.margin);
        require(positionData.margin > _marginRemoved, "Margin remove not than old margin");

        (uint256 remainMargin, ,) =
        calcRemainMarginWithFundingPayment(positionData.margin, int256(positionData.margin - _marginRemoved));

        positionData.margin = remainMargin;

        positionMap[address(_positionManager)][_trader].update(
            positionData
        );


        // TODO transfer money back to trader

    }

    function clearPosition(IPositionManager _positionManager, address _trader) internal {
        positionMap[address(_positionManager)][_trader].clear();
    }

    function increasePosition(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _quantity,
        uint256 _leverage
    ) public returns (PositionResp memory positionResp) {
        address _trader = _msgSender();
        Position.Data memory oldPosition = getPosition(address(_positionManager), _trader);
        console.log("increase Position quantity ", _quantity);
        positionResp.exchangedPositionSize = _positionManager.openMarketPosition(_quantity, _side == Position.Side.LONG);

        if (positionResp.exchangedPositionSize > 0) {
            uint256 _newSize = oldPosition.quantity + positionResp.exchangedPositionSize;
            uint256 _currentPrice = _positionManager.getPrice();
            uint256 increaseMarginRequirement = _quantity * _currentPrice / _leverage;
            console.log(' increaseMarginRequirement : ', increaseMarginRequirement);
            // TODO update function latestCumulativePremiumFraction
            (uint256 remainMargin, uint256 fundingPayment, uint256 latestCumulativePremiumFraction) =
            calcRemainMarginWithFundingPayment(oldPosition.margin, int256(oldPosition.margin + increaseMarginRequirement));

            (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(_positionManager, _trader, PnlCalcOption.SPOT_PRICE);

            // update positionResp
            positionResp.exchangedQuoteAssetAmount = _quantity * _currentPrice;
            positionResp.unrealizedPnl = unrealizedPnl;
            positionResp.realizedPnl = 0;
            positionResp.marginToVault = int256(increaseMarginRequirement);
            positionResp.fundingPayment = fundingPayment;
            positionResp.position = Position.Data(
                _side,
                _newSize,
                remainMargin,
                oldPosition.openNotional + positionResp.exchangedQuoteAssetAmount,
                latestCumulativePremiumFraction,
                block.number
            );
        }
    }

    function openReversePosition(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _quantity,
        uint256 _leverage
    ) internal returns (PositionResp memory positionResp) {
        address _trader = _msgSender();
        PositionResp memory positionResp;
        // TODO calc pnl before check margin to open reverse
        Position.Data memory oldPosition = getPosition(address(_positionManager), _trader);
        // margin required to reduce
        if (_quantity < oldPosition.quantity) {
            uint256 reduceMarginRequirement = oldPosition.margin * _quantity / oldPosition.quantity;
            // reduce old position only
            positionResp.exchangedPositionSize = _positionManager.openMarketPosition(_quantity, _side == Position.Side.LONG);
            uint256 _entryPrice = oldPosition.getEntryPrice();
            (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(_positionManager, _trader, PnlCalcOption.SPOT_PRICE);
            positionResp.realizedPnl = unrealizedPnl * int256(positionResp.exchangedPositionSize) / int256(oldPosition.quantity);
            // update old position
            (uint256 remainMargin, uint256 fundingPayment, uint256 latestCumulativePremiumFraction) =
            calcRemainMarginWithFundingPayment(oldPosition.margin, int256(oldPosition.margin - reduceMarginRequirement));

            positionResp.exchangedQuoteAssetAmount = _quantity * _entryPrice;
            positionResp.fundingPayment = fundingPayment;
            // NOTICE margin to vault can be negative
            positionResp.marginToVault = - (int256(reduceMarginRequirement) + positionResp.realizedPnl);

            // NOTICE calc unrealizedPnl after open reverse
            positionResp.unrealizedPnl = unrealizedPnl - positionResp.realizedPnl;
            positionResp.position = Position.Data(
                oldPosition.side,
                oldPosition.quantity - _quantity,
                remainMargin,
                oldPosition.openNotional - _quantity * _entryPrice,
                0,
                0
            );
            return positionResp;
        }
        //        }
        // if new position is larger then close old and open new
        return closeAndOpenReversePosition(_positionManager, _side, _quantity, _leverage);
    }

    function closeAndOpenReversePosition(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _quantity,
        uint256 _leverage
    ) internal returns (PositionResp memory positionResp) {
        address _trader = _msgSender();
        // TODO change to TWAP
        PositionResp memory closePositionResp = internalClosePosition(_positionManager, _trader, PnlCalcOption.SPOT_PRICE);
        uint256 _currentPrice = _positionManager.getPrice();
        uint256 openNotional = _quantity * _currentPrice - closePositionResp.exchangedQuoteAssetAmount;
        // if remain exchangedQuoteAssetAmount is too small (eg. 1wei) then the required margin might be 0
        // then the positionHouse will stop opening position
        if (openNotional < _leverage) {
            positionResp = closePositionResp;
        } else {
            PositionResp memory increasePositionResp = increasePosition(_positionManager, _side, openNotional / _currentPrice, _leverage);
            positionResp = PositionResp({
            position : increasePositionResp.position,
            exchangedQuoteAssetAmount : closePositionResp.exchangedQuoteAssetAmount + increasePositionResp.exchangedQuoteAssetAmount,
            fundingPayment : closePositionResp.fundingPayment + increasePositionResp.fundingPayment,
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
        PnlCalcOption _pnlCalcOption
    ) internal returns (PositionResp memory positionResp) {
        Position.Data memory oldPosition = getPosition(address(_positionManager), _trader);
        requirePositionSize(oldPosition.quantity);
        if (oldPosition.side == Position.Side.LONG) {
            positionResp.exchangedPositionSize = _positionManager.openMarketPosition(oldPosition.quantity, false);
        } else {
            positionResp.exchangedPositionSize = _positionManager.openMarketPosition(oldPosition.quantity, true);
        }
        uint256 _currentPrice = _positionManager.getPrice();
        (,int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(_positionManager, _trader, _pnlCalcOption);
        console.log("unreazlied pnl ", uint256(unrealizedPnl));
        (
        uint256 remainMargin,
        uint256 fundingPayment,
        uint256 latestCumulativePremiumFraction
        ) = calcRemainMarginWithFundingPayment(oldPosition.margin, unrealizedPnl);

        positionResp.realizedPnl = unrealizedPnl;
        console.log("line 391 position house");
        console.log("close position realized pnl", uint256(- unrealizedPnl));
        positionResp.fundingPayment = fundingPayment;
        // NOTICE remainMargin can be negative
        positionResp.marginToVault = int256(remainMargin);
        positionResp.unrealizedPnl = 0;
        positionResp.exchangedQuoteAssetAmount = oldPosition.quantity * _currentPrice;
        clearPosition(_positionManager, _trader);
    }

    function getPosition(
        address positionManager,
        address _trader
    ) public view returns (Position.Data memory positionData){
        return positionMap[positionManager][_trader];
    }

    function updatePosition(
        address _trader,
        Position.Side _side,
        uint256 _quantity,
        uint256 _leverage
    ) external {


    }

    function calcRemainMarginWithFundingPayment(
        uint256 oldPositionMargin, int256 deltaMargin
    ) internal view returns (uint256 remainMargin, uint256 fundingPayment, uint256 latestCumulativePremiumFraction){

        remainMargin = uint256(deltaMargin);
        fundingPayment = 0;
        latestCumulativePremiumFraction = 0;
    }

    function getPositionNotionalAndUnrealizedPnl(
        IPositionManager positionManager,
        address _trader,
        PnlCalcOption _pnlCalcOption
    ) public view returns
    (
        uint256 positionNotional,
        int256 unrealizedPnl
    ){
        Position.Data memory position = getPosition(address(positionManager), _trader);
        uint256 oldPositionNotional = position.openNotional;
        if (_pnlCalcOption == PnlCalcOption.TWAP) {
            // TODO get twap price
        } else if (_pnlCalcOption == PnlCalcOption.SPOT_PRICE) {
            console.log("=== Quality: %s, Price %s", position.quantity, positionManager.getPrice());
            positionNotional = positionManager.getPrice() * position.quantity;
        } else {
            // TODO get oracle price
        }
        if (position.side == Position.Side.LONG) {
            unrealizedPnl = int256(positionNotional) - int256(oldPositionNotional);
        } else {
            unrealizedPnl = int256(oldPositionNotional) - int256(positionNotional);
        }

    }


    function isNewPosition(
        IPositionManager _positionManager,
        address _trader
    ) internal view returns (bool) {
        return positionMap[address(_positionManager)][_trader].quantity != 0;
    }

    function getLiquidationPriceType1(
        address positionManager,
        address _trader
    ) public view returns (uint256 liquidationPrice){
        Position.Data memory positionData = getPosition(positionManager, _trader);
        uint256 oldPositionNotional = positionData.openNotional;
        uint256 oldPositionMargin = positionData.margin;
        uint256 oldPositionSize = positionData.quantity;
        if (positionData.side == Position.Side.LONG) {
            liquidationPrice = (oldPositionNotional - oldPositionMargin) / oldPositionSize;
        } else {
            liquidationPrice = (oldPositionMargin + oldPositionNotional) / oldPositionSize;
        }
    }

    function getLiquidationPriceType2(
        IPositionManager positionManager,
        address _trader,
        PnlCalcOption _pnlCalcOption
    ) public view returns (uint256 liquidationPrice){
        Position.Data memory positionData = getPosition(address(positionManager), _trader);
        (uint256 maintenanceMargin, ,) = getMaintenanceDetail(positionManager, _trader);
        // NOTICE get maintenance margin of positionManager
        // calculate marginBalance = initialMargin + unrealizedPnl
        // maintenanceMargin = initialMargin * maintenanceMarginRatio
        // if maintenanceMargin / marginBalance = 100% then the position will be liquidate
        if (positionData.side == Position.Side.LONG) {
            //        int256(positionNotional) - int256(oldPositionNotional) = positionData.margin * maintenanceMarginRatioConst - positionData.margin
            //        => positionData.quantity * liquidatePrice - positionData.openNotional = positionData.margin * maintenanceMarginRatioConst - positionData.margin
            liquidationPrice = (maintenanceMargin - positionData.margin + positionData.openNotional) / positionData.quantity;
        } else {
            //        int256(oldPositionNotional) - int256(positionNotional) = positionData.margin * maintenanceMarginRatioConst - positionData.margin
            //        => positionData.openNotional - positionData.quantity * liquidatePrice = positionData.margin * maintenanceMarginRatioConst - positionData.margin
            liquidationPrice = (positionData.openNotional - maintenanceMargin + positionData.margin) / positionData.quantity;
        }
    }

    function getMaintenanceDetail(
        IPositionManager positionManager,
        address _trader
    ) public view returns (uint256 maintenanceMargin, int256 marginBalance, uint256 marginRatio) {
        Position.Data memory positionData = getPosition(address(positionManager), _trader);
        // TODO update maintenanceMarginRatioConst
        maintenanceMargin = positionData.margin * maintenanceMarginRatioConst / 100;
        (,int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(positionManager, _trader, PnlCalcOption.SPOT_PRICE);
        marginBalance = int256(positionData.margin) + unrealizedPnl;
        marginRatio = maintenanceMargin / uint256(marginBalance) * 100;
    }


    //
    // REQUIRE FUNCTIONS
    //

    function requirePositionManager(
        IPositionManager positionManager,
        bool open
    ) private view {

    }

    function requireMoreMarginRatio(uint256 marginRatio) private view {
        require(marginRatio >= 100, "Margin ratio not meet criteria");
    }

    function requirePositionSize(
        uint256 _quantity
    ) private pure {
        require(_quantity != 0, "positionSize is 0");
    }


    function changeMaintenanceMarginRatio(uint256 newMaintenanceMarginRatio) external initializer {
        maintenanceMarginRatio = newMaintenanceMarginRatio;
        emit ChangeMaintenanceMarginRatio(newMaintenanceMarginRatio);
    }


}
