// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;


interface IPositionStrategyOrder {
    function unsetTPAndSL(address _pmAddress) external;

    function unsetTPOrSL(address _pmAddress, bool _isHigherPrice) external;

    function unsetTPAndSLWhenClosePosition(address _pmAddress, address _trader) external;

    function getTPSLDetail(address _pmAddress, address _trader) external view returns (uint120 lowerThanPrice, uint120 higherThanPrice);

    function hasTPOrSL(address _pmAddress, address _trader) external view returns (bool);
}