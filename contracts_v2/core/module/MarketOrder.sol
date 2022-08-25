// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import {PositionHouseFunction} from "../libraries/position/PositionHouseFunction.sol";
import {PositionMath} from "../libraries/position/PositionMath.sol";
import "../libraries/position/PositionLimitOrder.sol";
import "../libraries/helpers/Quantity.sol";
import "../libraries/helpers/Int256Math.sol";
import "../libraries/types/PositionHouseStorage.sol";
import {Errors} from "../libraries/helpers/Errors.sol";
import "./Base.sol";

abstract contract MarketOrder is PositionHouseStorage, Base {
    using PositionLimitOrder for mapping(address => mapping(address => PositionLimitOrder.Data[]));
    using Quantity for int256;
    using Int256Math for int256;
    using Quantity for int128;

    using Position for Position.Data;
    using Position for Position.LiquidatedData;
    using PositionHouseFunction for MarketOrder;

    event OpenMarket(
        address trader,
        int256 quantity,
        uint16 leverage,
        uint256 entryPrice,
        IPositionManager positionManager
    );

    function _internalOpenMarketPosition(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _quantity,
        uint16 _leverage,
        Position.Data memory oldPosition,
        address _trader
    ) internal {
        address _pmAddress = address(_positionManager);
        _requireOrderSideAndQuantity(_pmAddress, _trader, _side, _quantity, oldPosition.quantity);
        int256 pQuantity = _side == Position.Side.LONG
        ? int256(_quantity)
        : -int256(_quantity);
        //leverage must be greater than old position and in range of allowed leverage
        require(
            _leverage >= oldPosition.leverage &&
            _leverage <= _positionManager.getLeverage() &&
            _leverage > 0,
            Errors.VL_INVALID_LEVERAGE
        );
        PositionResp memory pResp;
        // check if old position quantity is the same side with the new one
        if (oldPosition.quantity == 0 || oldPosition.side() == _side) {
            pResp = increasePosition(
                _pmAddress,
                _side,
                int256(_quantity),
                _leverage,
                _trader,
                oldPosition,
                positionMap[_pmAddress][_trader],
                getLatestCumulativePremiumFraction(_pmAddress)
            );
            require(_checkMaxNotional(pResp.exchangedQuoteAssetAmount, configNotionalKey[_pmAddress], _leverage), Errors.VL_EXCEED_MAX_NOTIONAL);
        } else {
            pResp = openReversePosition(
                _positionManager,
                _side,
                pQuantity,
                _leverage,
                _trader,
                oldPosition
            );
        }
        // update position state
        positionMap[_pmAddress][_trader].update(pResp.position);
        if (pResp.marginToVault > 0) {
            //transfer from trader to vault
            _deposit(_pmAddress, _trader, pResp.marginToVault.abs(), pResp.fee);
        } else if (pResp.marginToVault < 0) {
            // withdraw from vault to user
            _withdraw(_pmAddress, _trader, pResp.marginToVault.abs());
        }
        emit OpenMarket(
            _trader,
            pQuantity,
            _leverage,
            pResp.entryPrice,
            _positionManager
        );
    }

    function _internalCloseMarketPosition(address _pmAddress, address _trader, uint256 _quantity) internal {
        Position.Data memory _positionDataWithManualMargin = getPositionWithManualMargin(_pmAddress, _trader, getPosition(_pmAddress, _trader));
        require(
            _quantity <= _positionDataWithManualMargin.quantity.abs(),
            Errors.VL_INVALID_CLOSE_QUANTITY
        );
        _internalOpenMarketPosition(
            IPositionManager(_pmAddress),
            _positionDataWithManualMargin.quantity > 0
            ? Position.Side.SHORT
            : Position.Side.LONG,
            _quantity,
            _positionDataWithManualMargin.leverage,
            _positionDataWithManualMargin,
            _trader
        );
    }

    function _internalClosePosition(
        IPositionManager _positionManager,
        address _trader,
        PnlCalcOption _pnlCalcOption,
        Position.Data memory _oldPosition
    ) internal returns (PositionResp memory positionResp) {
        address _pmAddress = address(_positionManager);
        uint256 openMarketQuantity = _oldPosition.quantity.abs();

        (
        positionResp.exchangedPositionSize,
        positionResp.exchangedQuoteAssetAmount,
        positionResp.entryPrice,
        positionResp.fee
        ) = PositionHouseFunction.openMarketOrder(
            _pmAddress,
            openMarketQuantity,
            _oldPosition.quantity > 0
            ? Position.Side.SHORT
            : Position.Side.LONG
        );
        positionResp.realizedPnl = PositionHouseFunction.calculatePnlWhenClose(_oldPosition.quantity, positionResp.exchangedPositionSize, _oldPosition.openNotional, positionResp.exchangedQuoteAssetAmount);
        positionResp.marginToVault = -positionResp.realizedPnl
        .add(_getClaimAmount(_pmAddress, _trader, _oldPosition))
        .kPositive();

        clearPosition(_pmAddress, _trader);
    }

    function increasePosition(
        address _pmAddress,
        Position.Side _side,
        int256 _quantity,
        uint16 _leverage,
        address _trader,
    // position data included manual margin
        Position.Data memory _positionData,
        Position.Data memory _positionDataWithoutLimit,
        int128 _latestCumulativePremiumFraction
    ) internal returns (PositionResp memory positionResp) {
        _positionData.margin -= getAddedMargin(_pmAddress, _trader).abs();
        {
            positionResp = PositionHouseFunction.increasePosition(
                _pmAddress,
                _side,
                _quantity,
                _leverage,
                _trader,
                _positionData,
                _positionDataWithoutLimit,
                _latestCumulativePremiumFraction
            );
        }
    }

    function openReversePosition(
        IPositionManager _positionManager,
        Position.Side _side,
        int256 _quantity,
        uint16 _leverage,
        address _trader,
        Position.Data memory _oldPosition
    ) internal returns (PositionResp memory positionResp) {
        address _pmAddress = address(_positionManager);
        if (_quantity.abs() < _oldPosition.quantity.abs()) {
            int256 _manualAddedMargin = _getManualMargin(_pmAddress, _trader);
            {
                positionResp = PositionHouseFunction.openReversePosition(
                    _pmAddress,
                    _side,
                    _quantity,
                    _leverage,
                    _trader,
                    _oldPosition,
                    positionMap[_pmAddress][_trader],
                    getLatestCumulativePremiumFraction(_pmAddress),
                    _manualAddedMargin
                );
                manualMargin[_pmAddress][_trader] = _manualAddedMargin * (_oldPosition.quantity.absInt() - _quantity.absInt()) / _oldPosition.quantity.absInt();
                return positionResp;
            }
        }
        // if new position is larger then close old and open new
        PositionResp memory closePositionResp = _internalClosePosition(
            _positionManager,
            _trader,
            PnlCalcOption.SPOT_PRICE,
            _oldPosition
        );
        positionResp = closePositionResp;
        return positionResp;
    }
}