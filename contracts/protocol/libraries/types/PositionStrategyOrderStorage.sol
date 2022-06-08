// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;
import "../../../interfaces/IPositionHouse.sol";
import "../../../interfaces/IPositionHouseViewer.sol";


abstract contract PositionStrategyOrderStorage {
    using Position for Position.Data;

    enum SetTPSLOption {
        BOTH,
        ONLY_HIGHER,
        ONLY_LOWER
    }

    struct TPSLCondition {
        uint120 higherPip;
        uint120 lowerPip;
        uint8 __dummy;
    }

    mapping (address => bool) public validatedTriggerers;
    mapping (address => mapping(address => TPSLCondition)) public TPSLMap;
    IPositionHouse public positionHouse;
    IPositionHouseViewer public positionHouseViewer;

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[49] private __gap;
}