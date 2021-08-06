// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;


/// @title Amm state that can change
/// contain all of variables that used in amm
interface IAmmState {
    /// contain variables that describe current major state of amm
    /// price is the current price of the amm calculated by (reserveAmountQuote/reserveAmountBase)
    /// tick is the current tick of the amm, according to the last tick transition that was run
    /// unlocked whether the pool is currently locked to reentrancy
    function ammState() external view returns (
        uint256 price,
        uint256 tick,
        bool unlocked
    );

    /// contain variables that describe information about liquidity of amm
    function liquidityDetail() external view returns (
        uint256 liquidity,
        uint256 baseReserveAmount,
        uint256 quoteReserveAmount
    );


}
