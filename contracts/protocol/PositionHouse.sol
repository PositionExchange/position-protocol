// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;

import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "../interfaces/IPositionManager.sol";
import "./libraries/position/Position.sol";
import {PositionHouseBase} from "./bases/PositionHouseBase.sol";

contract PositionHouse is
    PositionHouseBase
{
    function openMarketPosition(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _quantity,
        uint16 _leverage
    ) public override nonReentrant {
        PositionHouseBase.openMarketPosition(
            _positionManager,
            _side,
            _quantity,
            _leverage
        );
    }

    function openLimitOrder(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _uQuantity,
        uint128 _pip,
        uint16 _leverage
    ) public override nonReentrant {
        PositionHouseBase.openLimitOrder(
            _positionManager,
            _side,
            _uQuantity,
            _pip,
            _leverage
        );
    }

    function closePosition(
        IPositionManager _positionManager,
        uint256 _quantity
    ) public override nonReentrant {
        PositionHouseBase.closePosition(
            _positionManager,
            _quantity
        );
    }

    function instantlyClosePosition(
        IPositionManager _positionManager,
        uint256 _quantity
    ) public override nonReentrant {
        PositionHouseBase.instantlyClosePosition(
            _positionManager,
            _quantity
        );
    }

    function closeLimitPosition(
        IPositionManager _positionManager,
        uint128 _pip,
        uint256 _quantity
    ) public override nonReentrant {
        PositionHouseBase.closeLimitPosition(
            _positionManager,
            _pip,
            _quantity
        );
    }

    function liquidate(
        IPositionManager _positionManager,
        address _trader
    ) public nonReentrant {
        PositionHouseBase._internalLiquidate(
            _positionManager,
            _trader,
            0
        );
    }

    // TODO remove after hot fix funding rate
    function hotFixUpdateFundingRate(
        address _pmAddress,
        address[] memory _traders
    ) external onlyOwner {
        // reset latest premium fraction
        _resetLatestCumulativePremiumFractions(_pmAddress);
        // push new cumulative premium fraction
        payFunding(IPositionManager(_pmAddress));
        int128 latestCumulativePremiumFraction = getLatestCumulativePremiumFraction(_pmAddress);
        for (uint i = 0; i < _traders.length; i++) {
            _updatePremiumFractionInPositionData(_pmAddress, _traders[i], latestCumulativePremiumFraction);
        }
    }

    function _updatePremiumFractionInPositionData(
        address _pmAddress,
        address _trader,
        int128 _latestCumulativePremiumFraction
    ) internal {
        positionMap[_pmAddress][_trader].lastUpdatedCumulativePremiumFraction = _latestCumulativePremiumFraction;
    }
}