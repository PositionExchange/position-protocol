// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;

import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "../interfaces/IPositionHouse.sol";
import "../interfaces/IPositionHouseViewer.sol";
import "./libraries/types/PositionStrategyOrderStorage.sol";
import {Errors} from "./libraries/helpers/Errors.sol";

contract PositionStrategyOrder is
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    PositionStrategyOrderStorage
{
    using Position for Position.Data;

    event TakeProfitAndStopLossOrderCreated(address pmAddress, address trader, uint128 higherThanPrice, uint128 lowerThanPrice);
    event TakeProfitAndStopLossOrderCanceled(address pmAddress, address trader);
    event TakeProfitAndStopLossOrderTriggered(address pmAddress, address trader);

    function initialize(
        IPositionHouse _positionHouse,
        IPositionHouseViewer _positionHouseViewer
    ) public initializer {
        __ReentrancyGuard_init();
        __Ownable_init();
        positionHouse = _positionHouse;
        positionHouseViewer = _positionHouseViewer;
    }

    function setTakeProfitAndStopLoss(address _pmAddress, uint128 _higherThanPrice, uint128 _lowerThanPrice) external {
        address _trader = msg.sender;
        Position.Data memory positionData = positionHouseViewer.getPosition(_pmAddress, _trader);
        require(positionData.quantity != 0, Errors.VL_MUST_HAVE_POSITION);
        takeProfitAndStopLoss[_pmAddress][_trader].lowerThanPrice = uint120(_lowerThanPrice);
        takeProfitAndStopLoss[_pmAddress][_trader].higherThanPrice = uint120(_higherThanPrice);
        takeProfitAndStopLoss[_pmAddress][_trader].__dummy = 1;
        emit TakeProfitAndStopLossOrderCreated(_pmAddress, _trader, _higherThanPrice, _lowerThanPrice);
    }

    function unsetTakeProfitAndStopLoss(address _pmAddress) external {
        address _trader = msg.sender;
        _internalUnsetTpSl(_pmAddress, _trader);
        emit TakeProfitAndStopLossOrderCanceled(_pmAddress, _trader);
    }

    function getTakeProfitAndStopLoss(address _pmAddress, address _trader) public view returns (uint120 lowerThanPrice, uint120 higherThanPrice) {
        TakeProfitAndStopLoss memory takeProfitAndStopLoss = takeProfitAndStopLoss[_pmAddress][_trader];
        lowerThanPrice = takeProfitAndStopLoss.lowerThanPrice;
        higherThanPrice = takeProfitAndStopLoss.higherThanPrice;
    }

    function triggerMarketOrder(IPositionManager _positionManager, address _trader) external {

    }

    function _internalUnsetTpSl(address _pmAddress, address _trader) internal {
        takeProfitAndStopLoss[_pmAddress][_trader].lowerThanPrice = 0;
        takeProfitAndStopLoss[_pmAddress][_trader].higherThanPrice = 0;
    }

}