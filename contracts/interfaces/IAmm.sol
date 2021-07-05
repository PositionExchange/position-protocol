// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;


import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IAmm {
    /**
     * @notice asset direction, used in getInputPrice, getOutputPrice, swapInput and swapOutput
     * @param ADD_TO_AMM add asset to Amm
     * @param REMOVE_FROM_AMM remove asset from Amm
     */
    enum Dir {ADD_TO_AMM, REMOVE_FROM_AMM}

    function openLimitOrder() external;

    function openMarketOrder() external;

    function queryOrder() external;

}
