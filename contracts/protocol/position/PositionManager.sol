pragma solidity ^0.8.0;
import {BlockContext} from "../libraries/helpers/BlockContext.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "../libraries/position/TickPosition.sol";
import "../libraries/position/TickStore.sol";

import "hardhat/console.sol";

contract PositionManager {
    using TickPosition for TickPosition.Data;
    using TickStore for mapping(int128 => uint256);
    uint256 public basisPoint = 10001; //1.0001
    uint256 public constant basisPointBase = 100;
    struct SingleSlot {
        // percentage in point
        int128 pip;
    }
    SingleSlot public singleSlot;
    mapping(int256 => TickPosition.Data) public tickPosition;
    mapping(int128 => uint256) public tickStore;
    // a packed array of boolean, where liquidity is filled or not
    mapping(int128 => uint256) public liquidityBitmap;

    modifier whenNotPause(){
        //TODO implement
        _;
    }

    modifier onlyCounterParty(){
        //TODO implement
        _;
    }

    function currentPositionData(address _trader) external view returns (
        uint256 size,
        uint256 margin,
        uint256 openNotional
    ){
//        return;
    }

    function currentPositionPrice(address _trader) internal view returns(uint256) {
        //get overage of ticks
        return 0;
    }

    function openLimitPosition(int256 tick, uint256 size, bool isBuy) external whenNotPause onlyCounterParty {
//        require(tick != singleSlot.pip, "!!"); //call market order instead
//        require(isBuy && tick < singleSlot.pip, "!B");
//        require(!isBuy && tick > singleSlot.pip, "!B");
//        //TODO validate tick
//        // convert tick to price
//        uint256 tickToPrice = 0;
//        tickPosition[tick].insertLimit(tickToPrice, size);

    }

    struct SwapState {
        int256 remainingSize;
        // the amount already swapped out/in of the output/input asset
        int256 amountCalculated;
        // the tick associated with the current price
        int24 tick;
        // the current liquidity in range
        uint128 liquidity;
    }

    struct StepComputations {
        // the price at the beginning of the step
        uint160 sqrtPriceStartX96;
        // the next tick to swap to from the current tick in the swap direction
        int24 tickNext;
        // whether tickNext is initialized or not
        bool initialized;
        uint64 nextLiquidity;
        // sqrt(price) for the next tick (1/0)
        uint160 sqrtPriceNextX96;
        // how much is being swapped in in this step
        uint256 amountIn;
        // how much is being swapped out
        uint256 amountOut;
        // how much fee is being paid in
        uint256 feeAmount;
    }


    function openMarketPosition(uint256 size, bool isLong) external whenNotPause onlyCounterParty {
//        require(size != 0, "!S");
//        // TODO lock
//        // get current tick liquidity
//        TickPosition.Data storage tickData = tickPosition[singleSlot.pip];
//
//        SwapState memory state = SwapState({
//            remainingSize: size,
//            amountCalculated: 0,
//            tick: singleSlot.pip,
//            liquidity: 0
//        });
//        while (state.remainingSize != 0){
//            StepComputations memory step;
//            (step.tickNext, step.initialized) = tickStore.getNextInitializedTick(
//                state.tick,
//                1,
//                isLong
//            );
//            if(step.initialized){
//                step.nextLiquidity = tickData[step.nextLiquidity].liquidity;
//                if(step.nextLiquidity >= state.remainingSize){
//                    // size <= liquidity => fill all
//                    state.amountCalculated = state.amountCalculated.add(state.remainingSize);
//                    state.remainingSize = 0;
//                }else{
//                    state.remainingSize = state.remainingSize.sub(step.nextLiquidity);
//                    state.amountCalculated = state.amountCalculated.add(step.nextLiquidity);
//                    state.tick = isLong ? step.tickNext : step.tickNext - 1;
//                }
//            }else{
//
//            }
//        }
//        if(singleSlot.pip != state.tick){
//            // all ticks in shifted range must be marked as filled
//            uint256 tickShifted = isLong ? state.tick - singleSlot.pip : singleSlot.pip - state.tick;
//            singleSlot.pip = state.tick;
//            // TODO write a checkpoint that we shift a range of ticks
//        }

    }

}
