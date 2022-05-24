pragma solidity ^0.8.0;


library PipConversionMath {
    // TODO comment explain
    function toPrice(uint128 pip, uint64 baseBasicPoint, uint64 basisPoint) internal pure returns (uint256) {
        return (uint256(pip) * baseBasicPoint) / basisPoint;
    }

    /// @dev return the Position margin calculated base on quantity, leverage and basisPoint
    function calMargin(uint128 pip, uint256 uQuantity, uint16 leverage, uint64 basisPoint) internal pure returns (int256) {
        // margin = quantity * pipToPrice (pip) / baseBasicPoint / leverage
        // => margin = quantity * pip * baseBasicPoint / basisPoint / baseBasicPoint / leverage
        // do some math => margin = quantity * pip / (leverage * basisPoint)
        return int256(uQuantity * uint256(pip) / (leverage * basisPoint));
    }

    function toNotional(uint128 pip, uint64 baseBasisPoint, uint64 basisPoint) internal pure returns(uint256){
        return uint256(pip) * baseBasisPoint / basisPoint;
    }

}
