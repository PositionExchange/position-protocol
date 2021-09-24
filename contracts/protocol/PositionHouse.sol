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
        bool isNewPosition = isNewPosition(_positionManager, _trader);
        PositionResp memory positionResp;
        if (isNewPosition) {
            positionResp = increasePosition(_positionManager, _side, _size, _leverage);
        } else {
            // TODO adjust old position
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

    function adjustPosition() internal returns (PositionResp memory positionResp) {

    }

    function increasePosition(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _size,
        uint256 _leverage
    ) internal returns (PositionResp memory positionResp) {
        address trader = _msgSender();
        Position.Data memory oldPosition = getPosition(address(_positionManager), trader);
        positionResp.exchangedPositionSize = _positionManager.openMarketPosition(_size * _leverage, _side == Position.Side.LONG);
        uint256 _newSize = oldPosition.size + positionResp.exchangedPositionSize / _leverage;
        console.log("PositionHouse. New Size: ", _newSize);
        uint256 _currentPrice = _positionManager.getPrice();
        uint256 increaseMarginRequirement = _size * _currentPrice / _leverage;
        // TODO update function latestCumulativePremiumFraction
        (uint256 remainMargin, uint256 fundingPayment, uint256 latestCumulativePremiumFraction) =
        calcRemainMarginWithFundingPayment(oldPosition.margin, increaseMarginRequirement);
        // TODO function getUnrealizedPnl
        (int256 unrealizedPnl) = getUnrealizedPnl();

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

    function openReversePosition(
        IPositionManager _positionManager,
        address _trader,
        Position.Side _side,
        uint256 _openNotional,
        uint256 _leverage
    ) internal returns (PositionResp memory positionResp) {
        (uint256 oldPositionNotional, uint256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl();
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

    function calcRemainMarginWithFundingPayment(uint256 oldPositionMargin, uint256 newPositionMargin) internal view returns (uint256 remainMargin, uint256 fundingPayment, uint256 latestCumulativePremiumFraction){
        remainMargin = oldPositionMargin + newPositionMargin;
        fundingPayment = 0;
        latestCumulativePremiumFraction = 0;
    }

    function getPositionNotionalAndUnrealizedPnl() internal view returns (uint256 oldPositionNotional, uint256 unrealizedPnl){
        oldPositionNotional = 0;
        unrealizedPnl = 0;
    }

    function isNewPosition(
        IPositionManager _positionManager,
        address _trader
    ) internal view returns (bool) {
        return positionMap[address(_positionManager)][_trader].size != 0;
    }


}
