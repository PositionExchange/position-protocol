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

        uint256 marginToVault;

        int256 realizedPnl;

        int256 unrealizedPnl;

        uint256 exchangedPositionSize;

        uint256 exchangedQuoteAssetAmount;

        uint256 fundingPayment;

    }

    mapping(address => mapping(address => Position.Data)) public positionMap;

    modifier whenNotPause(){
        //TODO implement
        _;
    }

    function initialize() public initializer {

    }

    function openMarketPosition(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _size,
        uint256 _leverage
    ) external whenNotPause nonReentrant {
        //check input
        address _trader = _msgSender();
        //TODO check is new Position
        //        bool isNewPosition = isNewPosition(_positionManager, _trader);
        Position.Data memory oldPosition = getPosition(address(_positionManager), _trader);
        PositionResp memory positionResp;
        if (oldPosition.size == 0 || oldPosition.side == _side) {
            positionResp = increasePosition(_positionManager, _side, _size, _leverage);
        } else {

            // TODO adjust old position
            positionResp = openReversePosition(_positionManager, _side, _size, _leverage);
        }
        // update position sate
        positionMap[address(_positionManager)][_trader].update(
            positionResp.position
        );
    }

    function openLimitPosition(
        IPositionManager positionManager,
        Position.Side side,
        uint256 size,
        uint256 limitPrice,
        uint256 leverage
    ) external {


    }

    function increasePosition(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _size,
        uint256 _leverage
    ) public returns (PositionResp memory positionResp) {
        address _trader = _msgSender();
        Position.Data memory oldPosition = getPosition(address(_positionManager), _trader);
        positionResp.exchangedPositionSize = _positionManager.openMarketPosition(_size * _leverage, _side == Position.Side.LONG);
        if (positionResp.exchangedPositionSize > 0) {
            uint256 _newSize = oldPosition.size + positionResp.exchangedPositionSize / _leverage;
            uint256 _currentPrice = _positionManager.getPrice();
            uint256 increaseMarginRequirement = _size * _currentPrice / _leverage;
            // TODO update function latestCumulativePremiumFraction
            (uint256 remainMargin, uint256 fundingPayment, uint256 latestCumulativePremiumFraction) =
            calcRemainMarginWithFundingPayment(oldPosition.margin, int256(increaseMarginRequirement));
            // TODO function getUnrealizedPnl
            (,int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(_positionManager, _trader, PnlCalcOption.SPOT_PRICE);

            // update positionResp
            positionResp.exchangedQuoteAssetAmount = (_size * _leverage) * _currentPrice;
            positionResp.unrealizedPnl = unrealizedPnl;
            positionResp.marginToVault = increaseMarginRequirement;
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
        uint256 _size,
        uint256 _leverage
    ) internal returns (PositionResp memory positionResp) {
        address _trader = _msgSender();

        (uint256 oldPositionNotional, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(_positionManager, _trader, PnlCalcOption.SPOT_PRICE);
        PositionResp memory positionResp;
        uint256 _currentPrice = _positionManager.getPrice();
        // reduce position if old position is larger
        uint256 newNotional = _size * _currentPrice * _leverage;

        if (oldPositionNotional > newNotional) {
            Position.Data memory oldPosition = getPosition(address(_positionManager), _trader);
            positionResp.exchangedPositionSize = _positionManager.openMarketPosition(_size * _leverage, _side == Position.Side.LONG);
            // margin required to reduce
            uint256 reduceMarginRequirement = _size * _currentPrice / _leverage;
            positionResp.realizedPnl = (unrealizedPnl * int256(positionResp.exchangedPositionSize)) / int256(oldPosition.size);
            console.log("releaszedPnl %s", uint256(positionResp.realizedPnl));
            console.log("reduceMarginRequirement %s", (reduceMarginRequirement));
            console.log("old margin %s", (oldPosition.margin));
            // update old position
            (uint256 remainMargin, uint256 fundingPayment, uint256 latestCumulativePremiumFraction) =
            calcRemainMarginWithFundingPayment(oldPosition.margin, (positionResp.realizedPnl - int256(reduceMarginRequirement)));
            positionResp.position = Position.Data(
                oldPosition.side,
                oldPosition.size - _size,
                remainMargin,
                oldPosition.openNotional - newNotional,
                0,
                0
            );
            console.log("return remainMargin", remainMargin);
            return positionResp;
        }
        // if new position is larger then close old and open new
        return closeAndOpenReversePosition();
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
        uint256 _size,
        uint256 _leverage
    ) external {


    }

    function getUnrealizedPnl() internal view returns (int256 unrealizedPnl) {
        unrealizedPnl = 0;
    }

    function closeAndOpenReversePosition() internal view returns (PositionResp memory positionResp) {

    }

    function calcRemainMarginWithFundingPayment(uint256 oldPositionMargin, int256 deltaMargin) internal view returns (uint256 remainMargin, uint256 fundingPayment, uint256 latestCumulativePremiumFraction){
        remainMargin = uint256(int256(oldPositionMargin) + deltaMargin);
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
            positionNotional = positionManager.getPrice() * position.size * (position.openNotional/position.margin);
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
        return positionMap[address(_positionManager)][_trader].size != 0;
    }


}
