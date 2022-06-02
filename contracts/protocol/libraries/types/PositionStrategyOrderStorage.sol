// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;
import "../../../interfaces/IPositionHouse.sol";
import "../../../interfaces/IPositionHouseViewer.sol";


abstract contract PositionStrategyOrderStorage {
    using Position for Position.Data;

    struct TakeProfitAndStopLoss {
        uint120 higherThanPrice;
        uint120 lowerThanPrice;
        uint8 __dummy;
    }

    mapping (address => mapping(address => TakeProfitAndStopLoss)) public takeProfitAndStopLoss;
    IPositionHouse public positionHouse;
    IPositionHouseViewer public positionHouseViewer;
}