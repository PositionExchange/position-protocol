// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

import "../protocol/position/Amm.sol";


interface IPositionHouse {


    function addMargin(Amm _amm, uint256 _addedMargin) external;

    function removeMargin(Amm _amm, uint256 removedMargin) external;

}

