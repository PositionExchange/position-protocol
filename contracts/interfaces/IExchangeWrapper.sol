// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

pragma experimental ABIEncoderV2;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IExchangeWrapper {
    function swapInput(
        IERC20 inputToken,
        IERC20 outputToken,
        uint256  inputTokenSold,
        uint256  minOutputTokenBought,
        uint256  maxPrice
    ) external returns (uint256 );

    function swapOutput(
        IERC20 inputToken,
        IERC20 outputToken,
        uint256  outputTokenBought,
        uint256  maxInputTokeSold,
        uint256  maxPrice
    ) external returns (uint256 );

    function getInputPrice(
        IERC20 inputToken,
        IERC20 outputToken,
        uint256  inputTokenSold
    ) external view returns (uint256 );

    function getOutputPrice(
        IERC20 inputToken,
        IERC20 outputToken,
        uint256  outputTokenBought
    ) external view returns (uint256 );

    function getSpotPrice(IERC20 inputToken, IERC20 outputToken) external view returns (uint256 );
}
