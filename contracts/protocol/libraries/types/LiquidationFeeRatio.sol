pragma solidity ^0.8.8;

type LiquidationFeeRatio is uint256;

library LiquidationFeeRatioMath {
    function toUint(LiquidationFeeRatio self) internal pure returns (uint256) {
        return LiquidationFeeRatio.unwrap(self);
    }

    function getLiquidatorFee(LiquidationFeeRatio self, uint256 _liquidationPenalty) internal pure returns (uint256) {
        return (_liquidationPenalty * toUint(self)) / 2 / 100;
    }

    function getRemainMargin(LiquidationFeeRatio self, uint256 _margin) internal pure returns (uint256) {
        return (_margin * (100 - toUint(self))) / 100;
    }
}