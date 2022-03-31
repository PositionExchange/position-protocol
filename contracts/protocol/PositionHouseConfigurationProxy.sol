// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract PositionHouseConfigurationProxy is Initializable, OwnableUpgradeable {
    uint256 public maintenanceMarginRatio;
    uint256 public partialLiquidationRatio;
    uint256 public liquidationFeeRatio;
    uint256 public liquidationPenaltyRatio;

    function initialize(
        uint256 _maintenanceMarginRatio,
        uint256 _partialLiquidationRatio,
        uint256 _liquidationFeeRatio,
        uint256 _liquidationPenaltyRatio
   ) public initializer {
        __Ownable_init();
        maintenanceMarginRatio = _maintenanceMarginRatio;
        partialLiquidationRatio = _partialLiquidationRatio;
        liquidationFeeRatio = _liquidationFeeRatio;
        liquidationPenaltyRatio = _liquidationPenaltyRatio;
    }

}
