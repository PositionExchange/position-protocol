// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

contract PositionHouseConfigurationProxy is Initializable, OwnableUpgradeable {
    uint256 public maintenanceMarginRatio;
    uint256 public partialLiquidationRatio;
    uint256 public liquidationFeeRatio;
    uint256 public liquidationPenaltyRatio;

    event LiquidationPenaltyRatioUpdated(uint256 oldLiquidationPenaltyRatio, uint256 newLiquidationPenaltyRatio);
    event PartialLiquidationRatioUpdated(uint256 oldPartialLiquidationLiquid,uint256 newPartialLiquidationLiquid);


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

    function getLiquidationRatio() public view returns (uint256, uint256) {
        return (liquidationFeeRatio, liquidationPenaltyRatio);
    }


    // OWNER UPDATE VARIABLE STORAGE
    function updatePartialLiquidationRatio(uint256 _partialLiquidationRatio)
        external
        onlyOwner
    {
        emit PartialLiquidationRatioUpdated(partialLiquidationRatio, _partialLiquidationRatio);
        partialLiquidationRatio = _partialLiquidationRatio;
    }

    function updateLiquidationPenaltyRatio(uint256 _liquidationPenaltyRatio)
        external
        onlyOwner
    {
        emit LiquidationPenaltyRatioUpdated(liquidationPenaltyRatio, _liquidationPenaltyRatio);
        liquidationPenaltyRatio = _liquidationPenaltyRatio;
    }
}
