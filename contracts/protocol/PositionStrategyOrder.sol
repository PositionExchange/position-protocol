// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;

import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "../interfaces/IPositionHouse.sol";
import "../interfaces/IPositionHouseViewer.sol";
import "../interfaces/IPositionManager.sol";
import "./libraries/types/PositionStrategyOrderStorage.sol";
import {Errors} from "./libraries/helpers/Errors.sol";

contract PositionStrategyOrder is
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    PositionStrategyOrderStorage
{
    using Position for Position.Data;

    event TPSLCreated(address pmAddress, address trader, uint128 higherThanPrice, uint128 lowerThanPrice);
    event TPOrSlCanceled(address pmAddress, address trader, bool isHigherPrice);
    event TPAndSLCanceled(address pmAddress, address trader);
    event TPSLTriggered(address pmAddress, address trader);

    function initialize(
        IPositionHouse _positionHouse,
        IPositionHouseViewer _positionHouseViewer
    ) public initializer {
        __ReentrancyGuard_init();
        __Ownable_init();
        positionHouse = _positionHouse;
        positionHouseViewer = _positionHouseViewer;
    }

    function setTPSL(address _pmAddress, uint128 _higherThanPrice, uint128 _lowerThanPrice) external {
        address _trader = msg.sender;
        Position.Data memory positionData = positionHouseViewer.getPosition(_pmAddress, _trader);
        require(positionData.quantity != 0, Errors.VL_MUST_HAVE_POSITION);
        TPSLMap[_pmAddress][_trader].lowerThanPrice = uint120(_lowerThanPrice);
        TPSLMap[_pmAddress][_trader].higherThanPrice = uint120(_higherThanPrice);
        TPSLMap[_pmAddress][_trader].__dummy = 1;
        emit TPSLCreated(_pmAddress, _trader, _higherThanPrice, _lowerThanPrice);
    }

    function unsetTPOrSL(address _pmAddress, bool _isHigherPrice) external {
        address _trader = msg.sender;
        if (_isHigherPrice) {
            TPSLMap[_pmAddress][_trader].higherThanPrice = 0;
        } else {
            TPSLMap[_pmAddress][_trader].lowerThanPrice = 0;
        }
        emit TPOrSlCanceled(_pmAddress, _trader, _isHigherPrice);
    }

    function unsetTPAndSL(address _pmAddress) external {
        address _trader = msg.sender;
        _internalUnsetTPAndSL(_pmAddress, _trader);
        emit TPAndSLCanceled(_pmAddress, _trader);
    }

    function unsetTPAndSLWhenClosePosition(address _pmAddress, address _trader) external onlyPositionHouse {
        _internalUnsetTPAndSL(_pmAddress, _trader);
        emit TPAndSLCanceled(_pmAddress, _trader);
    }

    function getTPSLDetail(address _pmAddress, address _trader) public view returns (uint120 lowerThanPrice, uint120 higherThanPrice) {
        TPSLCondition memory condition = TPSLMap[_pmAddress][_trader];
        lowerThanPrice = condition.lowerThanPrice;
        higherThanPrice = condition.higherThanPrice;
    }

    function hasTPOrSL(address _pmAddress, address _trader) public view returns (bool) {
        TPSLCondition memory condition = TPSLMap[_pmAddress][_trader];
        return condition.lowerThanPrice != 0 || condition.higherThanPrice != 0;
    }

    function triggerTPSL(IPositionManager _positionManager, address _trader) external onlyValidatedTriggerer{
        address _pmAddress = address(_positionManager);
        uint128 currentPip = _positionManager.getCurrentPip();
        TPSLCondition memory condition = TPSLMap[_pmAddress][_trader];
        require(reachTPSL(condition, currentPip), Errors.VL_MUST_REACH_CONDITION);
        positionHouse.triggerClosePosition(_positionManager, _trader);
        emit TPSLTriggered(_pmAddress, _trader);
    }

    function _internalUnsetTPAndSL(address _pmAddress, address _trader) internal {
        TPSLMap[_pmAddress][_trader].lowerThanPrice = 0;
        TPSLMap[_pmAddress][_trader].higherThanPrice = 0;
    }

    function updateValidatedTriggererStatus(address _triggerer, bool _isValidated) external onlyOwner {
        validatedTriggerers[_triggerer] = _isValidated;
    }


    // REQUIRE FUNCTION
    function reachTPSL(TPSLCondition memory condition, uint128 currentPip) internal returns (bool) {
        return currentPip <= condition.lowerThanPrice || currentPip >= condition.higherThanPrice;
    }

    modifier onlyPositionHouse() {
        require(msg.sender == address(positionHouse), Errors.VL_ONLY_POSITION_HOUSE);
        _;
    }

    modifier onlyValidatedTriggerer() {
        require(validatedTriggerers[msg.sender], Errors.VL_ONLY_VALIDATED_TRIGGERS);
        _;
    }
}