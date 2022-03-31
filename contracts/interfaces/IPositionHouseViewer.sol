// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "./IPositionManager.sol";
import "../protocol/libraries/types/PositionHouseStorage.sol";

interface IPositionHouseViewer {
    function getMaintenanceDetail(
        IPositionManager _positionManager,
        address _trader,
        PositionHouseStorage.PnlCalcOption _calcOption
    )
    external
    view
    returns (
        uint256 maintenanceMargin,
        int256 marginBalance,
        uint256 marginRatio
    );

    function getPositionNotionalAndUnrealizedPnl(
        IPositionManager _positionManager,
        address _trader,
        PositionHouseStorage.PnlCalcOption _pnlCalcOption,
        Position.Data memory _oldPosition
    ) external view returns (uint256 positionNotional, int256 unrealizedPnl);


    function getRemovableMargin(
        IPositionManager _positionManager,
        address _trader
    ) external view returns (uint256);
}
