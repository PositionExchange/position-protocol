//// SPDX-License-Identifier: agpl-3.0
//pragma solidity 0.8.0;
//
//
//import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
//import "../protocol/position/PositionHouse.sol";
//
//interface IAmm is IERC20 {
//
//
//    enum Status  {OPENING, CLOSED, CANCEL}
//    enum Side  {BUY, SELL}
//    /**
//     * @notice asset direction, used in getInputPrice, getOutputPrice, swapInput and swapOutput
//     * @param ADD_TO_AMM add asset to Amm
//     * @param REMOVE_FROM_AMM remove asset from Amm
//     */
//    struct LiquidityChangedSnapshot {
//        uint256 cumulativeNotional;
//        // the base/quote reserve of amm right before liquidity changed
//        uint256 quoteAssetReserve;
//        uint256 baseAssetReserve;
//        // total position size owned by amm after last snapshot taken
//        // `totalPositionSize` = currentBaseAssetReserve - lastLiquidityChangedHistoryItem.baseAssetReserve + prevTotalPositionSize
//        uint256 totalPositionSize;
//    }
//
//    struct IncreaseLiquidityParams {
//        uint256 tokenId;
//        uint256 amount0Desired;
//        uint256 amount1Desired;
//        uint256 amount0Min;
//        uint256 amount1Min;
//        uint256 deadline;
//    }
//
//    /// @notice Increases the amount of liquidity in a position, with tokens paid by the `msg.sender`
//    /// @param params tokenId The ID of the token for which liquidity is being increased,
//    /// amount0Desired The desired amount of token0 to be spent,
//    /// amount1Desired The desired amount of token1 to be spent,
//    /// amount0Min The minimum amount of token0 to spend, which serves as a slippage check,
//    /// amount1Min The minimum amount of token1 to spend, which serves as a slippage check,
//    /// deadline The time by which the transaction must be included to effect the change
//    /// @return liquidity The new liquidity amount as a result of the increase
//    /// @return amount0 The amount of token0 to acheive resulting liquidity
//    /// @return amount1 The amount of token1 to acheive resulting liquidity
//    function increaseLiquidity(IncreaseLiquidityParams calldata params)
//    external
//    payable
//    returns (
//        uint128 liquidity,
//        uint256 amount0,
//        uint256 amount1
//    );
//
//    struct DecreaseLiquidityParams {
//        uint256 tokenId;
//        uint128 liquidity;
//        uint256 amount0Min;
//        uint256 amount1Min;
//        uint256 deadline;
//    }
//
//    // tickID => Tick
//    mapping(int16 => Tick) tickOrder;
//
//
//    struct Tick {
//        int256 liquidity;
//        int256 filledLiquidity;
//        uint256 filledIndex;
//        uint256 currentIndex;
//        // indexID => Order trader
//        mapping(uint256 => Order) order;
//
//    }
//
//
//    struct Order {
//        // Type order BUY or SELL
//        Side side;
//        // leverage 0x -> 20x
//        uint256 leverage;
//        // limit price
//        uint256 limitPrice;
//        // amount of quote
//        uint256 amountAssetQuote;
//        // amount of base
//        uint256 amountAssetBase;
//
//        // margin of position
//        uint256 margin;
//
//        Status status;
//    }
//
//
//
//    /// @notice Decreases the amount of liquidity in a position and accounts it to the position
//    /// @param params tokenId The ID of the token for which liquidity is being decreased,
//    /// amount The amount by which liquidity will be decreased,
//    /// amount0Min The minimum amount of token0 that should be accounted for the burned liquidity,
//    /// amount1Min The minimum amount of token1 that should be accounted for the burned liquidity,
//    /// deadline The time by which the transaction must be included to effect the change
//    /// @return amount0 The amount of token0 accounted to the position's tokens owed
//    /// @return amount1 The amount of token1 accounted to the position's tokens owed
//    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
//    external
//    payable
//    returns (uint256 amount0, uint256 amount1);
//
//    enum Dir {ADD_TO_AMM, REMOVE_FROM_AMM}
//
//    //    function addLiquidity() external;
//
//    //    function removeLiquidity() external;
//
//    function openLimit(uint256 amountAssetBase,
//        uint256 amountAssetQuote,
//        uint256 limitAmountPriceBase,
//        Side side,
//        int24 tick,
//        uint8 leverage) external;
//
//    function openMarket() external;
//
//    function queryOrder() external;
//
//    function getIsWaitingOrder(uint256 tick, uint256 index) external view returns(bool memory);
//
//
//    function addMargin(uint256 index, uint256 tick, uint256 _addedMargin) external;
//
//    function removeMargin(uint256 index, uint256 tick, uint256 _removedMargin) external;
//
//    function cancelOrder(uint256 index, uint256 tick) external;
//
//
//    function getTotalPositionSize() external view returns (uint256 memory);
//}
