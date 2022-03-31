// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../interfaces/IPositionHouse.sol";
import "./libraries/position/Position.sol";
import "./libraries/types/PositionHouseStorage.sol";
import {PositionHouseFunction} from "./libraries/position/PositionHouseFunction.sol";

contract PositionHouseViewer is Initializable, OwnableUpgradeable {
    IPositionHouse positionHouse;
    function initialize(IPositionHouse _positionHouse) public initializer {
        __Ownable_init();
        positionHouse = _positionHouse;
    }

    function getClaimAmount(address _pmAddress, address _trader)
    public
    view
    returns (int256 totalClaimableAmount)
    {
        Position.Data memory positionData = positionHouse.getPosition(_pmAddress, _trader);
        return
        PositionHouseFunction.getClaimAmount(
            _pmAddress,
            _trader,
            positionData,
            positionHouse.positionMap(_pmAddress, _trader),
            positionHouse._getLimitOrders(_pmAddress, _trader),
            positionHouse._getReduceLimitOrders(_pmAddress, _trader),
            positionHouse.getClaimableAmount(_pmAddress, _trader),
            positionHouse._getManualMargin(_pmAddress, _trader)
        );
    }

    function getListOrderPending(
        IPositionManager _positionManager,
        address _trader
    ) public view returns (PositionHouseStorage.LimitOrderPending[] memory) {
        address _pmAddress = address(_positionManager);
        return
        PositionHouseFunction.getListOrderPending(
            _pmAddress,
            _trader,
            positionHouse._getLimitOrders(_pmAddress, _trader),
            positionHouse._getReduceLimitOrders(_pmAddress, _trader)
        );
    }

    function getNextFundingTime(IPositionManager _positionManager) external view returns (uint256) {
        return _positionManager.getNextFundingTime();
    }

    function getCurrentFundingRate(IPositionManager _positionManager) external view returns (int256) {
        return _positionManager.getCurrentFundingRate();
    }

//
//    function getMaintenanceDetail(
//        IPositionManager _positionManager,
//        address _trader,
//        PositionHouseStorage.PnlCalcOption _calcOption
//    )
//    public
//    view
//    returns (
//        uint256 maintenanceMargin,
//        int256 marginBalance,
//        uint256 marginRatio
//    )
//    {
//        address _pmAddress = address(_positionManager);
//        Position.Data memory positionData = getPosition(_pmAddress, _trader);
//        (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(
//            _positionManager,
//            _trader,
//            _calcOption,
//            positionData
//        );
//        (
//        uint256 remainMarginWithFundingPayment,
//        ,
//        ,
//
//        ) = calcRemainMarginWithFundingPayment(
//            _pmAddress,
//            positionData,
//            positionData.margin
//        );
//        maintenanceMargin =
//        ((remainMarginWithFundingPayment -
//        uint256(manualMargin[_pmAddress][_trader])) *
//        maintenanceMarginRatio) /
//        100;
//        marginBalance = int256(remainMarginWithFundingPayment) + unrealizedPnl;
//        marginRatio = marginBalance <= 0
//        ? 100
//        : (maintenanceMargin * 100) / uint256(marginBalance);
//    }
//
//    function getPositionNotionalAndUnrealizedPnl(
//        IPositionManager _positionManager,
//        address _trader,
//        PositionHouseStorage.PnlCalcOption _pnlCalcOption,
//        Position.Data memory _oldPosition
//    ) public view returns (uint256 positionNotional, int256 unrealizedPnl) {
//        (positionNotional, unrealizedPnl) = PositionHouseFunction
//        .getPositionNotionalAndUnrealizedPnl(
//            address(_positionManager),
//            _trader,
//            _pnlCalcOption,
//            _oldPosition
//        );
//    }
//
//    function getFundingPaymentAmount(IPositionManager _positionManager, address _trader) external view returns (int256 fundingPayment) {
//        address _pmAddress = address(_positionManager);
//        Position.Data memory positionData = positionHouse.getPosition(_pmAddress, _trader);
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


}
