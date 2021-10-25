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
import {IChainLinkPriceFeed} from "../interfaces/IChainLinkPriceFeed.sol";

import "hardhat/console.sol";

contract PositionManager is Initializable, ReentrancyGuardUpgradeable, OwnableUpgradeable {
    using TickPosition for TickPosition.Data;
    using LiquidityBitmap for mapping(int128 => uint256);
    uint256 public basisPoint = 100; //0.01
    uint256 public constant BASE_BASIC_POINT = 10000;
    // fee = quoteAssetAmount / tollRatio (means if fee = 0.001% then tollRatio = 100000)
    uint256 tollRatio = 100000;

    uint256 public fundingPeriod;
    uint256 public nextFundingTime;
    uint256 public spotPriceTwapInterval;
    bytes32 public priceFeedKey;
    IChainLinkPriceFeed public priceFeed;

    struct SingleSlot {
        // percentage in point
        int128 pip;
        //0: not set
        //1: buy
        //2: sell
        uint8 isFullBuy;
    }

    IERC20 quoteAsset;


    // Max finding word can be 3500
    int128 public maxFindingWordsIndex = 1000;

    SingleSlot public singleSlot;
    mapping(int128 => TickPosition.Data) public tickPosition;
    mapping(int128 => uint256) public tickStore;
    // a packed array of boolean, where liquidity is filled or not
    mapping(int128 => uint256) public liquidityBitmap;
    //    mapping(uint64 => LimitOrder.Data) orderQueue;

    event Swap(address account, uint256 indexed amountIn, uint256 indexed amountOut);
    event LimitOrderCreated(uint64 orderId, int128 pip, uint128 size, bool isBuy);
    event UpdateMaxFindingWordsIndex(int128 newMaxFindingWordsIndex);
    event UpdateBasicPoint(uint256 newBasicPoint);
    event UpdateTollRatio(uint256 newTollRatio);



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

    function pipToPrice(int128 pip) public view returns (uint256) {
        return uint256(uint128(pip)) * BASE_BASIC_POINT / basisPoint;
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
            // Should return the latest partialFilled
            // in order to know how many quantity amount is filled to the limit order by market order
            //            partialFilled = 0;
        }
        if (size != 0 && size == partialFilled) {
            isFilled = true;
        }
    }

    /**
     * @notice calculate total fee (including toll and spread) by input quoteAssetAmount
     * @param _positionNotional quoteAssetAmount
     * @return total tx fee
     */
    function calcFee(uint256 _positionNotional) external view returns (uint256)
    {
        return _positionNotional == 0 ? 0 : _positionNotional / tollRatio;
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

    function cancelLimitOrder(int128 pip, uint64 orderId) external returns (uint256) {
        tickPosition[pip].cancelLimitOrder(orderId);
        return 1;
    }

    function closeLimitOrder(int128 pip, uint64 orderId, uint256 _amountClose) external returns (uint256 amountClose) {
        amountClose = tickPosition[pip].closeLimitOrder(orderId, _amountClose);
    }


    function openLimitPosition(int128 pip, uint128 size, bool isBuy) external whenNotPause onlyCounterParty returns (uint64 orderId, uint256 sizeOut, uint256 openNotional, bool hasOpenMarket) {
        if (isBuy && singleSlot.pip != 0) {
            require(pip <= singleSlot.pip, "!B");
        } else {
            require(pip >= singleSlot.pip, "!S");
        }
        SingleSlot memory _singleSlot = singleSlot;
        bool hasLiquidity = liquidityBitmap.hasLiquidity(pip);
        //save gas
        if (pip == _singleSlot.pip && hasLiquidity && _singleSlot.isFullBuy != (isBuy ? 1 : 2) ) {
            // open market
            (sizeOut, openNotional) = openMarketPositionWithMaxPip(size, isBuy, uint128(pip));
            hasOpenMarket == true;
        }
//        else if (!isBuy && pip <= _singleSlot.pip) {
//            //open market sell
//
//        }
//        else {
//            // open limit only
//
//        }
        if (size > sizeOut){
            if(pip == _singleSlot.pip && _singleSlot.isFullBuy != (isBuy ? 1 : 2)){
                singleSlot.isFullBuy = isBuy ? 1 : 2;
            }
            //TODO validate pip
            // convert tick to price
            // save at that pip has how many liquidity
            orderId = tickPosition[pip].insertLimitOrder(uint120(size - uint128(sizeOut)), hasLiquidity, isBuy);
            console.log("pip, hasLiquidity", uint256(uint128(pip)), hasLiquidity);
            if (!hasLiquidity) {
                //set the bit to mark it has liquidity
                liquidityBitmap.toggleSingleBit(pip, true);
            }
        }
        // TODO update emit event
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

    enum CurrentLiquiditySide {
        NotSet,
        Buy,
        Sell
    }

    function openMarketPositionWithMaxPip(uint256 size, bool isBuy, uint128 maxPip) public whenNotPause onlyCounterParty returns (uint256 sizeOut, uint256 openNotional) {
        return _internalOpenMarketOrder(size, isBuy, maxPip);
    }

    function openMarketPosition(uint256 size, bool isBuy) external whenNotPause onlyCounterParty returns (uint256 sizeOut, uint256 openNotional) {
        return _internalOpenMarketOrder(size, isBuy, 0);
    }

    function _internalOpenMarketOrder(uint256 size, bool isBuy, uint128 maxPip) internal returns (uint256 sizeOut, uint256 openNotional) {
        require(size != 0, "!S");
        // TODO lock
        // get current tick liquidity
        console.log("start market order, size: ", size, "is buy: ", isBuy);
        SingleSlot memory _initialSingleSlot = singleSlot;
        //save gas
        SwapState memory state = SwapState({
        remainingSize : size,
        pip : _initialSingleSlot.pip
        });
        int128 startPip;
        //        int128 startWord = _initialSingleSlot.pip >> 8;
        //        int128 wordIndex = startWord;
        bool isPartialFill;
        uint8 isFullBuy = 0;
        bool isSkipFirstPip;
        CurrentLiquiditySide currentLiquiditySide = CurrentLiquiditySide(_initialSingleSlot.isFullBuy);
        console.log("> SWAP: CurrentLiquiditySide:", uint256(currentLiquiditySide));
        if (currentLiquiditySide != CurrentLiquiditySide.NotSet) {
            if (isBuy)
            // if buy and latest liquidity is buy. skip current pip
                isSkipFirstPip = currentLiquiditySide == CurrentLiquiditySide.Buy;
            else
            // if sell and latest liquidity is sell. skip current pip
                isSkipFirstPip = currentLiquiditySide == CurrentLiquiditySide.Sell;
        }
        while (state.remainingSize != 0) {
            console.log("while again");
            console.log("state pip", uint128(state.pip), isSkipFirstPip);
            StepComputations memory step;
            // updated findHasLiquidityInMultipleWords, save more gas
            (step.pipNext) = liquidityBitmap.findHasLiquidityInMultipleWords(
                state.pip,
                maxFindingWordsIndex,
                !isBuy
            );
            console.log("SWAP: state pip", uint128(state.pip));
            console.log("SWAP: next pip", uint256(uint128(step.pipNext)));
            if (maxPip != 0 && uint128(step.pipNext) != maxPip) break;
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
            else {
                if (!isSkipFirstPip) {
                    if (startPip == 0) startPip = step.pipNext;

                    // get liquidity at a tick index
                    uint128 liquidity = tickPosition[step.pipNext].liquidity;
                    console.log("SWAP: liquidity", uint256(liquidity));
                    console.log("SWAP: state.remainingSize", uint256(state.remainingSize));
                    //                  if (_initialSingleSlot.isFullBuy == 0 || isBuy != (_initialSingleSlot.isFullBuy == 2)) {
                    if (liquidity > state.remainingSize) {
                        // pip position will partially filled and stop here
                        console.log("partialFilled to pip | amount", uint256(uint128(step.pipNext)), uint256(state.remainingSize));
                        tickPosition[step.pipNext].partiallyFill(uint120(state.remainingSize));
                        openNotional += state.remainingSize * pipToPrice(step.pipNext);
                        state.remainingSize = 0;
                        state.pip = step.pipNext;
                        isPartialFill = true;
                        isFullBuy = uint8(!isBuy ? CurrentLiquiditySide.Buy : CurrentLiquiditySide.Sell);
                    } else if (state.remainingSize > liquidity) {
                        console.log("remain size > liquidity");
                        // order in that pip will be fulfilled
                        state.remainingSize = state.remainingSize - liquidity;
                        // NOTICE toggle current state to uninitialized after fulfill liquidity
                        //                    liquidityBitmap.toggleSingleBit(state.pip, false);
                        //                        liquidityBitmap.toggleSingleBit(step.pipNext, false);
                        // increase pip
                        openNotional += liquidity * pipToPrice(step.pipNext);
                        //                        startWord = wordIndex;
                        state.pip = state.remainingSize > 0 ? (isBuy ? step.pipNext + 1 : step.pipNext - 1) : step.pipNext;
                    } else {
                        // remaining size = liquidity
                        // only 1 pip should be toggled, so we call it directly here
                        liquidityBitmap.toggleSingleBit(step.pipNext, false);
                        openNotional += state.remainingSize * pipToPrice(step.pipNext);
                        state.remainingSize = 0;
                        state.pip = step.pipNext;
                        isFullBuy = 0;
                    }
                } else {
                    isSkipFirstPip = false;
                    state.pip = isBuy ? step.pipNext + 1 : step.pipNext - 1;
                }
            }
        }
        if (_initialSingleSlot.pip != state.pip) {
            // all ticks in shifted range must be marked as filled
            if (!(isPartialFill && startPip == state.pip)) {
                // example pip partiallyFill in pip 200
                // current pip should be set to 200
                // but should not marked pip 200 doesn't have liquidity
                console.log("startPip > state.pip", uint256(uint128(startPip)), uint256(uint128(state.pip)));
                liquidityBitmap.unsetBitsRange(startPip, isPartialFill ? (isBuy ? state.pip - 1 : state.pip + 1) : state.pip);
            }
            // TODO write a checkpoint that we shift a range of ticks
        }
        singleSlot.pip = state.pip;
        singleSlot.isFullBuy = isFullBuy;
        sizeOut = size - state.remainingSize;
        console.log("********************************************************************************");
        console.log("Final size state: size, sizeOut, remainingSize", size, sizeOut, state.remainingSize);
        console.log("Final size state: openNotional", openNotional);
        console.log("SWAP: final pip", uint256(uint128(state.pip)));
        console.log("********************************************************************************");
        emit Swap(msg.sender, size, sizeOut);
    }

    function getQuoteAsset() public view returns (IERC20) {
        return quoteAsset;
    }


    function updateMaxFindingWordsIndex(int128 _newMaxFindingWordsIndex) public onlyOwner {
        maxFindingWordsIndex = _newMaxFindingWordsIndex;
        emit  UpdateMaxFindingWordsIndex(_newMaxFindingWordsIndex);
    }

    function updateBasicPoint(uint256 _newBasicPoint) public onlyOwner {
        basisPoint = _newBasicPoint;
        emit UpdateBasicPoint(_newBasicPoint);
    }

    function updateTollRatio(uint256 newTollRatio) public onlyOwner {
        tollRatio = newTollRatio;
        emit UpdateTollRatio(newTollRatio);
    }

    /**
     * @notice get underlying twap price provided by oracle
     * @return underlying price
     */
    function getUnderlyingTwapPrice(uint256 _intervalInSeconds) public view returns (uint256) {
        return priceFeed.getTwapPrice(priceFeedKey, _intervalInSeconds)*BASE_BASIC_POINT;
    }



}
