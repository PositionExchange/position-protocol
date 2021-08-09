// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

import {IAmm} from "./a.sol";


interface IPositionHouse {


    event CancelOrder(
        address amm,
        uint256 index,
        int256 tick
    );


    event OpenLimitOrder(
        address amm,
        address trader,
        int256  tick,
        uint256 index

    );
    // @notice enum

    enum TypeOrder  {MARKET, LIMIT, STOP_LIMIT}



    /// @notice This struct is used for avoiding stack too deep error when passing too many var between functions
    struct PositionResp {
        IAmm.Position position;
        // the quote asset amount trader will send if open position, will receive if close
        uint256 exchangedQuoteAssetAmount;
        // if realizedPnl + realizedFundingPayment + margin is negative, it's the abs value of it
        uint256 badDebt;
        // the base asset amount trader will receive if open position, will send if close
        int256 exchangedPositionSize;
        // funding payment incurred during this position response
        int256 fundingPayment;
        // realizedPnl = unrealizedPnl * closedRatio
        int256 realizedPnl;
        // positive = trader transfer margin to vault, negative = trader receive margin from vault
        // it's 0 when internalReducePosition, its addedMargin when internalIncreasePosition
        // it's min(0, oldPosition + realizedFundingPayment + realizedPnl) when internalClosePosition
        uint256 marginToVault;
        // unrealized pnl after open position
        int256 unrealizedPnlAfter;
    }


    struct AddLiquidityLimitParams {
        address token0;
        address token1;
        uint24 fee;
        address recipient;
        //        int24 tickLower;
        //        int24 tickUpper;
        int24 tick;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
    }


    struct StopLimitOrderParams {
        IAmm _amm;
        uint256 _amount;
        uint256 _limitPrice;
        uint256 _stopPrice;
        IAmm.Side _side;
        int24 _tick;
        uint8 _leverage;
    }

//    event OpenMarket(
//        address amm,
//        address trader,
//
//
//    );


//    function addMargin(IAmm _amm, uint256 _addedMargin) public;
//
//    function removeMargin(IAmm _amm, uint256 removedMargin) public;

}

