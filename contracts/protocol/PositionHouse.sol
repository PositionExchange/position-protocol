pragma solidity ^0.8.0;

import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "../interfaces/IPositionManager.sol";
import "./libraries/position/Position.sol";
import "hardhat/console.sol";

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

    modifier whenNotPause(){
        //TODO implement
        _;
    }

    function initialize(
        uint256 _maintenanceMarginRatio
    ) public initializer {

        maintenanceMarginRatio = _maintenanceMarginRatio;

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

    function initialize() public initializer {

    }

    function openMarketPosition(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _quantity,
        uint256 _leverage
    ) external whenNotPause nonReentrant {
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

    function addMargin(IPositionManager _positionManager, uint256 _marginAdded) external {

        address _trader = _msgSender();

        Position.Data memory positionData = getPosition(address(_positionManager), _trader);


        positionData.margin = positionData.margin + _marginAdded;

        positionMap[address(_positionManager)][_trader].update(
            positionData
        );

        // TODO transfer money from trader to protocol


        emit AddMargin(_trader, _marginAdded, _positionManager);

    }

    function removeMargin(IPositionManager _positionManager, uint256 _marginRemoved) external {

        address _trader = _msgSender();

        Position.Data memory positionData = getPosition(address(_positionManager), _trader);


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
            // TODO update function latestCumulativePremiumFraction
            (uint256 remainMargin, uint256 fundingPayment, uint256 latestCumulativePremiumFraction) =
            calcRemainMarginWithFundingPayment(oldPosition.margin, int256(oldPosition.margin + increaseMarginRequirement));

            (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(_positionManager, _trader, PnlCalcOption.SPOT_PRICE);

            // update positionResp
            positionResp.exchangedQuoteAssetAmount = _quantity * _currentPrice;
            positionResp.unrealizedPnl = unrealizedPnl;
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
            positionResp.unrealizedPnl = 0;
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
        uint256 _currentPrice = _positionManager.getPrice();
        (,int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(_positionManager, _trader, _pnlCalcOption);
        (
        uint256 remainMargin,
        uint256 fundingPayment,
        uint256 latestCumulativePremiumFraction
        ) = calcRemainMarginWithFundingPayment(oldPosition.margin, unrealizedPnl);

        positionResp.exchangedPositionSize = oldPosition.quantity;
        positionResp.realizedPnl = unrealizedPnl;
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
        (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(positionManager, _trader, _pnlCalcOption);
        // NOTICE get maintenance margin of positionManager
        // calculate marginBalance = initialMargin + unrealizedPnl
        // maintenanceMargin = initialMargin * maintenanceMarginRatio
        // if maintenanceMargin / marginBalance = 100% then the position will be liquidate
    }


    //
    // REQUIRE FUNCTIONS
    //

    function requirePositionManager(
        IPositionManager positionManager,
        bool open
    ) private view {

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
