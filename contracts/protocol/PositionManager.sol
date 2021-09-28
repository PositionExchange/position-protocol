pragma solidity ^0.8.0;

import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


import "./libraries/position/TickPosition.sol";
import "./libraries/position/LimitOrder.sol";
import "./libraries/position/LiquidityBitmap.sol";

import "hardhat/console.sol";
// TODO upgradable
contract PositionManager is Initializable, ReentrancyGuardUpgradeable, OwnableUpgradeable {
    using TickPosition for TickPosition.Data;
    using LiquidityBitmap for mapping(int128 => uint256);
    uint256 public basisPoint = 100; //0.01
    uint256 public constant BASE_BASIC_POINT = 10000;

    struct SingleSlot {
        // percentage in point
        int128 pip;
    }

    IERC20 quoteAsset;


    // Max finding word can be 3000
    int128 public maxFindingWordsIndex = 10;

    SingleSlot public singleSlot;
    mapping(int128 => TickPosition.Data) public tickPosition;
    mapping(int128 => uint256) public tickStore;
    // a packed array of boolean, where liquidity is filled or not
    mapping(int128 => uint256) public liquidityBitmap;
    //    mapping(uint64 => LimitOrder.Data) orderQueue;
    event Swap(address account, uint256 indexed amountIn, uint256 indexed amountOut);
    event LimitOrderCreated(uint256 indexed orderId, int128 pip, uint128 size, bool isBuy);

    modifier whenNotPause(){
        //TODO implement
        _;
    }

    modifier onlyCounterParty(){
        //TODO implement
        _;
    }

    constructor(
        int128 initialPip,
        address _quoteAsset
    ) {
        singleSlot.pip = initialPip;
        quoteAsset = IERC20(_quoteAsset);

    }

    function getCurrentPip() public view returns (int128) {
        return singleSlot.pip;
    }

    function getPrice() public view returns (uint256) {
        return uint256(uint128(singleSlot.pip)) * BASE_BASIC_POINT / basisPoint;
    }

    function calcAdjustMargin(uint256 adjustMargin) public view returns (uint256) {
        return adjustMargin * BASE_BASIC_POINT;
    }

    function hasLiquidity(int128 pip) public view returns (bool) {
        return liquidityBitmap.hasLiquidity(pip);
    }

    function getPendingOrderDetail(int128 pip, uint64 orderId) public view returns (
        bool isFilled,
        bool isBuy,
        uint256 size,
        uint256 partialFilled

    ){
        (isFilled, isBuy, size, partialFilled) = tickPosition[pip].getQueueOrder(orderId);

        if (!liquidityBitmap.hasLiquidity(pip)) {
            isFilled = true;
            partialFilled = 0;
        }
    }

    function currentPositionData(address _trader) external view returns (
        uint256 size,
        uint256 margin,
        uint256 openNotional
    ){
        //        return;
    }

    function currentPositionPrice(address _trader) internal view returns (uint256) {
        //get overage of ticks
        return 0;
    }

    function openLimitPosition(int128 pip, uint128 size, bool isBuy) external whenNotPause onlyCounterParty returns (uint256 orderId) {
        //        require(pip != singleSlot.pip, "!!");
        //call market order instead
        if (isBuy && singleSlot.pip != 0) {
            require(pip <= singleSlot.pip, "!B");
        } else {
            require(pip >= singleSlot.pip, "!S");
        }
        //TODO validate pip
        // convert tick to price
        // save at that pip has how many liquidity
        bool hasLiquidity = liquidityBitmap.hasLiquidity(pip);
        orderId = tickPosition[pip].insertLimitOrder(size, hasLiquidity, isBuy);
        if (!hasLiquidity) {
            //set the bit to mark it has liquidity
            liquidityBitmap.toggleSingleBit(pip, true);
        }
        // TODO insert order to queue then return
        emit LimitOrderCreated(orderId, pip, size, isBuy);
    }

    struct SwapState {
        uint256 remainingSize;
        // the tick associated with the current price
        int128 pip;
    }

    struct StepComputations {
        int128 pipNext;
    }


    function openMarketPosition(uint256 size, bool isBuy) external whenNotPause onlyCounterParty returns (uint256 sizeOut) {
        require(size != 0, "!S");
        // TODO lock
        // get current tick liquidity
        console.log("start market order, size: ", size, "is buy: ", isBuy);
        SwapState memory state = SwapState({
        remainingSize : size,
        pip : singleSlot.pip
        });
        int128 startPip;
        console.log("start pip", uint128(startPip));
        bool isPartialFill;
        // TODO find words has liquidity first here
        while (state.remainingSize != 0) {
            StepComputations memory step;
            // find the next tick has liquidity
            (step.pipNext) = liquidityBitmap.findHasLiquidityInMultipleWords(
                state.pip,
                maxFindingWordsIndex,
                !isBuy
            );
            console.log("SWAP: state pip", uint128(state.pip));
            console.log("SWAP: next pip", uint256(uint128(step.pipNext)));
            if (startPip == 0) startPip = step.pipNext;
            if (step.pipNext == 0) {
                // no more next pip
                // state pip back 1 pip
                if (isBuy) {
                    state.pip--;
                } else {
                    state.pip++;
                }
                break;
            }
            // get liquidity at a tick index
            uint128 liquidity = tickPosition[step.pipNext].liquidity;
            console.log("SWAP: liquidity", uint256(liquidity));
            if (liquidity > state.remainingSize) {
                // pip position will partially filled and stop here
                tickPosition[step.pipNext].partiallyFill(uint120(state.remainingSize));
                state.remainingSize = 0;
                state.pip = step.pipNext;
                isPartialFill = true;
            } else {
                console.log("remain size > liquidity");
                // order in that pip will be fulfilled
                state.remainingSize = state.remainingSize - liquidity;
                // NOTICE toggle current state to uninitialized after fulfill liquidity
                liquidityBitmap.toggleSingleBit(state.pip, false);
                // increase pip
                state.pip = state.remainingSize > 0 ? (isBuy ? step.pipNext + 1 : step.pipNext - 1) : step.pipNext;
            }
            console.log("SWAP: Remaining size: ", state.remainingSize);
        }
        if (singleSlot.pip != state.pip) {
            // all ticks in shifted range must be marked as filled
            if (!(isPartialFill && startPip == state.pip)) {
                // example pip partiallyFill in pip 200
                // current pip should be set to 200
                // but should not marked pip 200 doesn't have liquidity
                liquidityBitmap.unsetBitsRange(startPip, isPartialFill ? (isBuy ? state.pip - 1 : state.pip + 1) : state.pip);
            }
            singleSlot.pip = state.pip;
            // TODO write a checkpoint that we shift a range of ticks
        }
        sizeOut = size - state.remainingSize;
        console.log("Final size state: ", size, sizeOut, state.remainingSize);
        console.log("SWAP: final pip", uint256(uint128(state.pip)));
        emit Swap(msg.sender, size, sizeOut);
    }

    function getQuoteAsset() public view returns (IERC20) {
        return quoteAsset;
    }
}
