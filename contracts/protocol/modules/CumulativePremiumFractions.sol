// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "../libraries/position/Position.sol";

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

    function getCumulativePremiumFractions(address _pmAddress) public view virtual returns (int256[] memory) {
        return cumulativePremiumFractions[_pmAddress];
    }

    function calcRemainMarginWithFundingPayment(
        address _positionManager,
        Position.Data memory _oldPosition,
        uint256 _pMargin
    )
    internal
    view
    returns (
        uint256 remainMargin,
        uint256 badDebt,
        int256 fundingPayment,
        int256 latestCumulativePremiumFraction
    )
    {
        // calculate fundingPayment
        latestCumulativePremiumFraction = getLatestCumulativePremiumFraction(
            _positionManager
        );
        if (_oldPosition.quantity != 0) {
            fundingPayment =
            (latestCumulativePremiumFraction -
            _oldPosition.lastUpdatedCumulativePremiumFraction) *
            _oldPosition.quantity;
        }

        // calculate remain margin, if remain margin is negative, set to zero and leave the rest to bad debt
        if (int256(_pMargin) + fundingPayment >= 0) {
            remainMargin = uint256(int256(_pMargin) + fundingPayment);
        } else {
            badDebt = uint256(-fundingPayment - int256(_pMargin));
        }
    }

    function _add(address _pmAddress, int256 _premiumFraction) internal {
        cumulativePremiumFractions[_pmAddress].push(
            _premiumFraction +
            getLatestCumulativePremiumFraction(_pmAddress)
        );
    }

}
