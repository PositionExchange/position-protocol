// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "../libraries/position/Position.sol";
import {PositionMath} from "../libraries/position/PositionMath.sol";
import {PositionHouseFunction} from "../libraries/position/PositionHouseFunction.sol";

abstract contract CumulativePremiumFractions {
    // avoid calling to position manager
    int256 private constant PREMIUM_FRACTION_DENOMINATOR = 10**10;
    // Cumulative premium fraction
    mapping(address => int128[]) private cumulativePremiumFractions;

//    event FundingPaid(
//        int256 premiumFraction,
//        int256 newestCumulativePremiumFraction,
//        address positionManager,
//        address caller,
//        uint256 blockTimestamp
//    );

    function payFunding(IPositionManager _positionManager) external {
        address _pmAddress = address(_positionManager);
        int256 premiumFraction = _positionManager.settleFunding();
        int128 newestCumulativePremiumFraction = int128(premiumFraction) +
            getLatestCumulativePremiumFraction(_pmAddress);
        cumulativePremiumFractions[_pmAddress].push(
            newestCumulativePremiumFraction
        );
//        emit FundingPaid(
//            premiumFraction,
//            newestCumulativePremiumFraction,
//            address(_positionManager),
//            msg.sender,
//            block.timestamp
//        );
    }

    // TODO remove once fix the funding for limit order issue
//    function _resetLatestCumulativePremiumFractions(address _positionManager) internal {
//        cumulativePremiumFractions[_positionManager].push(0);
//    }

    function getLatestCumulativePremiumFraction(address _positionManager)
        public
        view
        virtual
        returns (int128)
    {
        // save gas
        int128[] memory _fractions = cumulativePremiumFractions[
            _positionManager
        ];
        uint256 len = _fractions.length;
        if (len > 0) {
            return _fractions[len - 1];
        }
        return 0;
    }

//    function getCumulativePremiumFractions(address _pmAddress)
//        public
//        view
//        virtual
//        returns (int128[] memory)
//    {
//        return cumulativePremiumFractions[_pmAddress];
//    }

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
        (remainMargin, badDebt, fundingPayment) = PositionHouseFunction.calcRemainMarginWithFundingPayment(_oldPosition, _pMargin, latestCumulativePremiumFraction);
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[49] private __gap;
}
