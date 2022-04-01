// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;

import "../protocol/libraries/position/Position.sol";
import "../protocol/libraries/position/PositionLimitOrder.sol";

interface IPositionHouse {
    function getPosition(address _pmAddress, address _trader)
    external
    view
    returns (Position.Data memory positionData);

    function positionMap(address _pmAddress, address _trader) external view returns (Position.Data memory positionData);

    function _getLimitOrders(address _pmAddress, address _trader)
    external
    view
    returns (PositionLimitOrder.Data[] memory);

    function _getReduceLimitOrders(address _pmAddress, address _trader)
    external
    view
    returns (PositionLimitOrder.Data[] memory);

    function _getManualMargin(address _pmAddress, address _trader)
    external
    view
    returns (int256);

    function getClaimableAmount(address _pmAddress, address _trader)
    external
    view
    returns (uint256);

    function getLatestCumulativePremiumFraction(address _pmAddress)
    external
    view
    returns (int128);

    function getAddedMargin(address _positionManager, address _trader)
    external
    view
    returns (int256);
}
