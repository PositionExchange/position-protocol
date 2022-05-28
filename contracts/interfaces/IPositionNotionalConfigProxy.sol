// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;


interface IPositionNotionalConfigProxy {
    function getMaxNotional(bytes32 key, uint16 leverage) external returns (uint256);
}