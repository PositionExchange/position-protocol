// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

abstract contract CumulativePremiumFractions {
    // Cumulative premium fraction
    mapping(address => int256[]) private cumulativePremiumFractions;

    function getLatestCumulativePremiumFraction(
        address _positionManager
    ) public view returns (int256) {
        // save gas
        int256[] memory _fractions = cumulativePremiumFractions[_positionManager];
        uint256 len = _fractions.length;
        if (len > 0) {
            return
            _fractions[len - 1];
        }
        return 0;
    }

    function getCumulativePremiumFractions(address _pmAddress) public view returns (int256[] memory) {
        return cumulativePremiumFractions[_pmAddress];
    }

    function _add(address _pmAddress, int256 _premiumFraction) internal {
        cumulativePremiumFractions[_pmAddress].push(
            _premiumFraction +
            getLatestCumulativePremiumFraction(_pmAddress)
        );
    }

}
