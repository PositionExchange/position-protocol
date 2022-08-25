// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import {PositionHouseFunction} from "../libraries/position/PositionHouseFunction.sol";
import {PositionMath} from "../libraries/position/PositionMath.sol";
import "../libraries/position/PositionLimitOrder.sol";
import "../libraries/helpers/Quantity.sol";
import "../libraries/helpers/Int256Math.sol";
import "../libraries/types/PositionHouseStorage.sol";
import {Errors} from "../libraries/helpers/Errors.sol";

abstract contract Base {
    function getDebtPosition(address _pmAddress, address _trader)
    public
    view
    virtual
    returns (Position.LiquidatedData memory);

    function getPositionWithManualMargin(address _pmAddress, address _trader, Position.Data memory _positionData)
    public
    view
    virtual
    returns (Position.Data memory);

    function getPosition(address _pmAddress, address _trader)
    public
    view
    virtual
    returns (Position.Data memory);

    function getAddedMargin(address _positionManager, address _trader)
    public
    view
    virtual
    returns (int256);

    function getLatestCumulativePremiumFraction(address _pmAddress)
    public
    view
    virtual
    returns (int128);

    function _requireOrderSideAndQuantity(
        address _pmAddress,
        address _trader,
        Position.Side _side,
        uint256 _quantity,
        int256 _positionQuantity
    ) internal virtual view;

    function _getClaimAmount(
        address _pmAddress,
        address _trader,
        Position.Data memory _positionData
    ) internal view virtual returns (int256);

    function _updatePositionMap(
        address _pmAddress,
        address _trader,
        Position.Data memory newData
    ) internal virtual;

    function clearPosition(
        address _pmAddress,
        address _trader
    ) internal virtual;

    function _checkMaxNotional(
        uint256 _notional,
        bytes32 _key,
        uint16 _leverage
    ) internal virtual returns (bool);

    function _getPositionMap(address _pmAddress, address _trader)
    internal
    view
    virtual
    returns (Position.Data memory);

    function _getManualMargin(address _pmAddress, address _trader)
    internal
    view
    virtual
    returns (int256);

    function _withdraw(
        address positionManager,
        address trader,
        uint256 amount
    ) internal virtual;

    function _deposit(
        address positionManager,
        address trader,
        uint256 amount,
        uint256 fee
    ) internal virtual;
}