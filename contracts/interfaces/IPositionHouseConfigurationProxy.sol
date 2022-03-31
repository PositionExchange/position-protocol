// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

interface IPositionHouseConfigurationProxy {
    function maintenanceMarginRatio() external view returns(uint256);
    function partialLiquidationRatio() external view returns(uint256);
    function liquidationFeeRatio() external view returns(uint256);
    function liquidationPenaltyRatio() external view returns(uint256);
}
