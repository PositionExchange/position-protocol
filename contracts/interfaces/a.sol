// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;


import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../protocol/libraries/helpers/Errors.sol";
//import "../protocol/position/PositionHouse.sol";

interface IAmm {

    enum Status  {OPENING, CLOSED, CANCEL, PARTIAL_FILLED}
    enum Side  {BUY, SELL}
    struct PositionOpenMarket {
        // Type order BUY or SELL
        Side side;
        // leverage 0x -> 20x
        uint256 leverage;
        // amount of quote
        uint256 amountAssetQuote;
        // amount of base
        uint256 amountAssetBase;
        // margin of position
        uint256 margin;
    }

    /**
     * @notice asset direction, used in getInputPrice, getOutputPrice, swapInput and swapOutput
     * @param ADD_TO_AMM add asset to Amm
     * @param REMOVE_FROM_AMM remove asset from Amm
     */
    struct LiquidityChangedSnapshot {
        uint256 cumulativeNotional;
        // the base/quote reserve of amm right before liquidity changed
        uint256 quoteAssetReserve;
        uint256 baseAssetReserve;
        // total position size owned by amm after last snapshot taken
        // `totalPositionSize` = currentBaseAssetReserve - lastLiquidityChangedHistoryItem.baseAssetReserve + prevTotalPositionSize
        uint256 totalPositionSize;
    }

    struct IncreaseLiquidityParams {
        uint256 tokenId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct AmmState {
        uint256 price;
        int256 tick;
        bool unlocked;
    }
    /// IAmmState
    //    AmmState public ammState;




    /// @notice Increases the amount of liquidity in a position, with tokens paid by the `msg.sender`
    /// @param params tokenId The ID of the token for which liquidity is being increased,
    /// amount0Desired The desired amount of token0 to be spent,
    /// amount1Desired The desired amount of token1 to be spent,
    /// amount0Min The minimum amount of token0 to spend, which serves as a slippage check,
    /// amount1Min The minimum amount of token1 to spend, which serves as a slippage check,
    /// deadline The time by which the transaction must be included to effect the change
    /// @return liquidity The new liquidity amount as a result of the increase
    /// @return amount0 The amount of token0 to acheive resulting liquidity
    /// @return amount1 The amount of token1 to acheive resulting liquidity
    //    function increaseLiquidity(IncreaseLiquidityParams calldata params)
    //    external
    //    payable
    //    returns (
    //        uint128 liquidity,
    //        uint256 amount0,
    //        uint256 amount1
    //    );

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    //    mapping(address => PositionOpenMarket) positionMarketMap;

    // tickID => Tick
    //    mapping(int256 => Tick) tickOrder;


    struct TickOrder {
        uint256 liquidity;
        uint256 filledLiquidity;
        uint256 filledIndex;
        uint256 currentIndex;
        // indexID => Order trader
        mapping(uint256 => Order) order;

    }


    struct Order {
        // Type order BUY or SELL
        Side side;
        // leverage 0x -> 20x
        uint256 leverage;
        // limit price
        uint256 limitPrice;
        // amount of quote
        uint256 amountAssetQuote;
        // amount of base
        uint256 amountAssetBase;

        uint256 amountLiquidity;

        // margin of position
        uint256 margin;

        // amount remain
        // if NOT FILLED: orderLiquidityRemain = amountLiquidity of order
        // if PARTIAL FILLED: orderLiquidityRemain < amountLiquidity
        // if FILLED: orderLiquidityRemain = 0;
        uint256 orderLiquidityRemain;
        Status status;
    }


    struct Position {
        uint256 index;
        int256 tick;
    }

    struct LiquidityDetail {
        uint256 liquidity;
        uint256 baseReserveAmount;
        uint256 quoteReserveAmount;
    }


    struct OpenMarketState {
        // the quote amount remaining to be swap
        uint256 quoteRemainingAmount;
        // the quote amount already swapped
        uint256 quoteCalculatedAmount;
        // the base amount remaining to be swap
        uint256 baseRemainingAmount;
        // the base amount already swapped
        uint256 baseCalculatedAmount;
        // current price
        uint256 price;
        // current tick
        int256 tick;
    }

    struct StepComputations {
        // the price at the beginning of the step
        uint256 priceStart;
        // the next tick to swap to from the current tick in the swap direction
        int256 tickNext;
        // whether tickNext is initialized or not
        bool initialized;
        // price for the next tick (1/0)
        uint256 priceNext;
        // how much is being swapped in in this step
        uint256 quoteCalculatedAmount;
        // how much is being swapped out
        uint256 baseCalculatedAmount;
    }


    struct ParamsOpenMarket {
        Side side;
        uint256 quoteAmount;
        uint256 baseAmount;
        uint256 leverage;
        uint256 margin;
        address _trader;
    }





    /// @notice Decreases the amount of liquidity in a position and accounts it to the position
    /// @param params tokenId The ID of the token for which liquidity is being decreased,
    /// amount The amount by which liquidity will be decreased,
    /// amount0Min The minimum amount of token0 that should be accounted for the burned liquidity,
    /// amount1Min The minimum amount of token1 that should be accounted for the burned liquidity,
    /// deadline The time by which the transaction must be included to effect the change
    /// @return amount0 The amount of token0 accounted to the position's tokens owed
    /// @return amount1 The amount of token1 accounted to the position's tokens owed
    //    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
    //    external
    //    payable
    //    returns (uint256 amount0, uint256 amount1);

    enum Dir {ADD_TO_AMM, REMOVE_FROM_AMM}



    function openLimit(
        uint256 _amountAssetBase,
        uint256 _amountAssetQuote,
        uint256 _limitPrice,
        uint256 _margin,
        Side _side,
        int256 _tick,
        uint256 _leverage) external returns (uint256);
    //
    function openMarket(ParamsOpenMarket memory paramsOpenMarket) external;
    //
    //
    //
    //
    function addMargin(address _trader, uint256 _addedMargin) external;
    //
    function removeMargin(uint256 index, int256 tick, uint256 _removedMargin) external;
    //
    function cancelOrder(address _trader, uint256 _index, int256 _tick) external;


    function cancelAllOrder(address _trader) external;

    //
    //    function getIsWaitingOrder(int256 _tick, uint256 _index) external view returns (bool);

    function getIsOrderExecuted(int256 _tick, uint256 _index) external view returns (bool);

    function getTotalPositionSize() external view returns (uint256);

    function getCurrentTick() external view returns (int256);

    function settleFunding() external view returns (uint256);

    function quoteAsset() external view returns (IERC20);

    function addPositionMap(address _trader, int256 tick, uint256 index) external;

    function closePosition(address _trader) external;

    function getPrice() external view returns (uint256 price);

    function getReserve() external view returns (uint256 quoteReserveAmount, uint256 baseReserveAmount);

    function getPnL(address _trader) external view returns (int256);

    // For test
    function queryPositions(address _trader) external view returns (Position[] memory position);

    function getOrder(address _trader, int256 tick, uint256 index) external view returns (Order memory order);

}
