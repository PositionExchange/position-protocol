// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

import {IAmm} from "./a.sol";


interface IPositionHouse {


    event CancelOrder(
        address amm,
        uint256 index,
        uint256 tick
    );


    event OpenLimitOrder(
        address amm,
        address trader,
        address amountBase,
        address amountQoute,
        address tick,
        address index

    );

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

