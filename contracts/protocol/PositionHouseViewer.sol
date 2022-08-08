// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../interfaces/IPositionHouse.sol";
import "./libraries/position/Position.sol";
import "./libraries/types/PositionHouseStorage.sol";
import {PositionHouseFunction} from "./libraries/position/PositionHouseFunction.sol";
import "../interfaces/IPositionHouseConfigurationProxy.sol";
import {Int256Math} from "./libraries/helpers/Int256Math.sol";
import {PositionMath} from "./libraries/position/PositionMath.sol";

contract PositionHouseViewer is Initializable, OwnableUpgradeable {
    using Int256Math for int256;
    using Quantity for int256;
    using Position for Position.Data;
    IPositionHouse public positionHouse;
    IPositionHouseConfigurationProxy public positionHouseConfigurationProxy;
    function initialize(IPositionHouse _positionHouse, IPositionHouseConfigurationProxy _positionHouseConfigurationProxy) public initializer {
        __Ownable_init();
        positionHouse = _positionHouse;
        positionHouseConfigurationProxy = _positionHouseConfigurationProxy;
    }

    function getClaimAmount(address _pmAddress, address _trader)
    public
    view
    returns (int256 totalClaimableAmount)
    {
        return
        PositionHouseFunction.getClaimAmount(
            _pmAddress,
            positionHouse.getAddedMargin(_pmAddress, _trader),
            positionHouse.getDebtPosition(_pmAddress, _trader),
            positionHouse.positionMap(_pmAddress, _trader),
            positionHouse._getLimitOrders(_pmAddress, _trader),
            positionHouse._getReduceLimitOrders(_pmAddress, _trader),
            positionHouse.getLimitOrderPremiumFraction(_pmAddress, _trader),
            positionHouse.getLatestCumulativePremiumFraction(_pmAddress)
        );
    }

    function getClaimableAmountParams(address _pmAddress, address _trader)
    public view returns (
        int256 _manualMargin,
        Position.LiquidatedData memory _positionLiquidatedData,
        Position.Data memory _positionDataWithoutLimit,
        PositionLimitOrder.Data[] memory _limitOrders,
        PositionLimitOrder.Data[] memory _reduceLimitOrders
    ) {
        return (
            positionHouse.getAddedMargin(_pmAddress, _trader),
            positionHouse.getDebtPosition(_pmAddress, _trader),
            positionHouse.positionMap(_pmAddress, _trader),
            positionHouse._getLimitOrders(_pmAddress, _trader),
            positionHouse._getReduceLimitOrders(_pmAddress, _trader)
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

    function getAddedMargin(
        address _pmAddress,
        address _trader
    ) public view returns (int256) {
        return positionHouse.getAddedMargin(_pmAddress, _trader);
    }

    function getRemovableMargin(
        IPositionManager _positionManager,
        address _trader
    ) public view returns (uint256) {
        int256 _marginAdded = positionHouse.getAddedMargin(address(_positionManager), _trader);
        (
        uint256 maintenanceMargin,
        int256 marginBalance,
        ,
        ) = getMaintenanceDetail(_positionManager, _trader, PositionHouseStorage.PnlCalcOption.TWAP);
        int256 _remainingMargin = marginBalance - int256(maintenanceMargin);
        return
        uint256(
            _marginAdded <= _remainingMargin
            ? _marginAdded
            : _remainingMargin.kPositive()
        );
    }

    function getMaintenanceDetail(
        IPositionManager _positionManager,
        address _trader,
        PositionHouseStorage.PnlCalcOption _calcOption
    )
    public
    view
    returns (
        uint256 maintenanceMargin,
        int256 marginBalance,
        uint256 marginRatio,
        uint256 liquidationPip
    )
    {
        address _pmAddress = address(_positionManager);
        Position.Data memory _positionData = getPositionWithoutManualMargin(_pmAddress, _trader);
        Position.Data memory _positionDataWithManualMargin = getPosition(_pmAddress, _trader);
        (, int256 unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(
            _positionManager,
            _trader,
            _calcOption,
            _positionDataWithManualMargin
        );
        (
        uint256 remainMarginWithFundingPayment,
        ,
        ) = PositionHouseFunction.calcRemainMarginWithFundingPayment(
            _positionData,
            _positionDataWithManualMargin.margin,
            positionHouse.getLatestCumulativePremiumFraction(_pmAddress)
        );
        maintenanceMargin =
            ((remainMarginWithFundingPayment -
            uint256(positionHouse.getAddedMargin(_pmAddress, _trader)))
            * positionHouseConfigurationProxy.maintenanceMarginRatio()) / 100;
        marginBalance = int256(remainMarginWithFundingPayment) + unrealizedPnl;
        marginRatio = marginBalance <= 0
        ? 100
        : (maintenanceMargin * 100) / uint256(marginBalance);
        if (_positionDataWithManualMargin.quantity == 0) {
            marginRatio = 0;
        }
        if (_positionDataWithManualMargin.quantity != 0)
        {
            (uint64 baseBasisPoint, uint64 basisPoint) = _positionManager.getBasisPointFactors();
            liquidationPip = PositionMath.calculateLiquidationPip(_positionDataWithManualMargin.quantity, _positionDataWithManualMargin.margin, _positionDataWithManualMargin.openNotional, maintenanceMargin, basisPoint);
        }
    }

    function getPositionNotionalAndUnrealizedPnl(
        IPositionManager _positionManager,
        address _trader,
        PositionHouseStorage.PnlCalcOption _pnlCalcOption,
        Position.Data memory _oldPosition
    ) public view returns (uint256 positionNotional, int256 unrealizedPnl) {
        (positionNotional, unrealizedPnl) = PositionHouseFunction
        .getPositionNotionalAndUnrealizedPnl(
            address(_positionManager),
            _trader,
            _pnlCalcOption,
            _oldPosition
        );
    }

    function getPositionAndUnreliablePnl(
        IPositionManager _positionManager,
        address _trader,
        PositionHouseStorage.PnlCalcOption _pnlCalcOption
    ) public view returns (Position.Data memory position, uint256 positionNotional, int256 unrealizedPnl) {
        position = getPosition(address(_positionManager), _trader);
        (positionNotional, unrealizedPnl) = getPositionNotionalAndUnrealizedPnl(_positionManager, _trader, _pnlCalcOption, position);
    }

    function getFundingPaymentAmount(IPositionManager _positionManager, address _trader) external view returns (int256 fundingPayment) {
        address _pmAddress = address(_positionManager);
        Position.Data memory _positionData = getPositionWithoutManualMargin(_pmAddress, _trader);
        uint256 manualAddedMargin = getAddedMargin(_pmAddress, _trader).abs();
        (
        ,
        ,
         fundingPayment
        ) = PositionHouseFunction.calcRemainMarginWithFundingPayment(
            _positionData,
            _positionData.margin + manualAddedMargin,
            positionHouse.getLatestCumulativePremiumFraction(_pmAddress)
        );
    }

    function getPosition(address _pmAddress, address _trader) public view returns (Position.Data memory positionData) {
        positionData = positionHouse.getPosition(_pmAddress, _trader);
        positionData.margin += uint256(positionHouse.getAddedMargin(_pmAddress, _trader));
    }

    function getPositionWithoutManualMargin(address _pmAddress, address _trader) public view returns (Position.Data memory positionData) {
        positionData = positionHouse.getPosition(_pmAddress, _trader);
    }
}
