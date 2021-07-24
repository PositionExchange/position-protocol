// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

import "../protocol/position/Amm.sol";


interface IPositionHouse {


    event CancelOrder(
        address amm,
        address trader,
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


    function addMargin(Amm _amm, uint256 _addedMargin) external;

    function removeMargin(Amm _amm, uint256 removedMargin) external;

}

