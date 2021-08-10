// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;
/**
*  @title This contract for each pair
* Function for Amm in here
*/
import {BlockContext} from "../libraries/helpers/BlockContext.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAmm} from "../../interfaces/a.sol";
import {IChainLinkPriceFeed} from "../../interfaces/IChainLinkPriceFeed.sol";
import {Errors} from "../libraries/helpers/Errors.sol";
import {Calc} from "../libraries/math/Calc.sol";
import {PriceMath} from "../libraries/math/PriceMath.sol";
import {TickMath} from "../libraries/math/TickMath.sol";
import {TickBitmap} from "../libraries/math/TickBitmap.sol";
import {ComputeAmountMath} from "../libraries/math/ComputeAmountMath.sol";
import "./PositionHouse.sol";
import "../libraries/amm/PositionLimit.sol";
import "../libraries/amm/Tick.sol";
import "./PositionHouse.sol";
//import "../../interfaces/IAmmState.sol";
import "hardhat/console.sol";

contract Amm is IAmm, BlockContext {
    using SafeMath for uint256;
    using Calc for uint256;

    // variable
    uint256 public spotPriceTwapInterval;
    uint256 public fundingPeriod;
    uint256 public fundingBufferPeriod;
    uint256 fundingRate;
    // update during every swap and used when shutting amm down. it's trader's total base asset size
    //    IChainLinkPriceFeed public priceFeed;
    IERC20 public override quoteAsset;
    /// list of all tick index
    //    mapping(uint256 => Tick.Info) public override ticks;
    /// bitmap of all tick, show initialized ticks
    mapping(int256 => uint256) public tickBitmap;

    /// IAmmState
    LiquidityDetail public  liquidityDetail;
    //    bool public open;
    uint256 public nextFundingTime;
    bytes32 public priceFeedKey;
    AmmState public ammState;
    mapping(address => PositionOpenMarket) positionMarketMap;

    // tickID => Tick
    mapping(int256 => TickOrder) tickOrder;
    uint256[] cumulativePremiumFractions;
    // address _trader => Position
    mapping(address => Position[]) positionMap;

    /**
    * @notice event in amm
    * List event in amm
    */
    event SwapInput(Dir dir, uint256 quoteAssetAmount, uint256 baseAssetAmount);
    event SwapOutput(Dir dir, uint256 quoteAssetAmount, uint256 baseAssetAmount);
    event FundingRateUpdated(uint256 rate, uint256 underlyingPrice);
    event CancelOrder(int256 tick, uint256 index);

    event OpenLimitOrder(int256 tick, uint256 index);
    event OpenMarketOrder(int256 tick, uint256 index);

    /**
     * @notice MODIFIER
    */

    modifier onlyOpen() {
        require(true, Errors.A_AMM_IS_OPEN);
        _;
    }
    //    modifier onlyCounterParty() {
    //        require(counterParty == _msgSender(), Errors.A_AMM_CALLER_IS_NOT_COUNTER_PARTY);
    //        _;
    //    }
    function testTickInitialize() public view returns (int256){
        return ammState.tick;

    }

    function queryPositions(address _trader) external override view returns (Position[] memory positions){
        positions = positionMap[_trader];

    }

    function getOrder(address _trader, int256 tick, uint256 index) external override view returns (Order memory order){
        order = tickOrder[tick].order[index];
    }

    function initialize(
        uint256 startPrice,
        uint256 _quoteAssetReserve,
        uint256 _baseAssetReserve,
    //        uint256 _tradeLimitRatio,
    //        uint256 _fundingPeriod,
    //        IChainLinkPriceFeed _priceFeed,
    //        bytes32 _priceFeedKey,
    //        address _quoteAsset,
    //        uint256 _fluctuationLimitRatio,
    //        uint256 _tollRatio,
    //        uint256 _spreadRatio,
        uint256 sqrtStartPrice

    ) public {

        require(
            _quoteAssetReserve != 0 &&
            _baseAssetReserve != 0 &&
            //            _tradeLimitRatio != 0 &&
            //            _fundingPeriod != 0 &&
            //            address(_priceFeed) != address(0) &&
            //            _quoteAsset != address(0) &&
            sqrtStartPrice != 0,

            Errors.VL_INVALID_AMOUNT
        );

        spotPriceTwapInterval = 1 hours;
        // initialize tick
        int256 tick = TickMath.getTickAtPrice(sqrtStartPrice);

        //        console.log("Start tick %s", tick);
        console.log("Sender balance is %s tokens");

        ammState = AmmState({
        price : sqrtStartPrice,
        tick : tick,
        unlocked : true
        });


        //        console.log("hello");
        //
        //        quoteAsset = IERC20(_quoteAsset);
        //
        //
        //        spotPriceTwapInterval = 1 hours;
    }

    function getLiquidityDetail() internal view returns (uint256 liquidity, uint256 quoteReserveAmount, uint256 baseReserveAmount) {
        liquidity = liquidityDetail.liquidity;
        quoteReserveAmount = liquidityDetail.quoteReserveAmount;
        baseReserveAmount = liquidityDetail.baseReserveAmount;
    }

    function setLiquidityDetail(uint256 quoteReserveAmount, uint256 baseReserveAmount) external {
        liquidityDetail.quoteReserveAmount = quoteReserveAmount;
        liquidityDetail.baseReserveAmount = baseReserveAmount;
        liquidityDetail.liquidity = quoteReserveAmount.mul(baseReserveAmount);
    }
    // margin =_amountAssetQuote / _leverage
    //
    function openLimit(
        uint256 _amountAssetBase,
        uint256 _amountAssetQuote,
        uint256 _limitPrice,
        uint256 _margin,
        Side _side,
        int256 _tick,
        uint256 _leverage) external override returns (uint256){

        // TODO require openLimit
        require(_amountAssetBase != 0 &&
            _amountAssetQuote != 0, "Require difference 0");


        // TODO calc liquidity added

        uint256 liquidityAdded = _amountAssetQuote.mul(_amountAssetBase);
        console.log("liquidityAdded %s", liquidityAdded);

        //        console.log("tick  %s", _tick);


        tickOrder[_tick].liquidity = tickOrder[_tick].liquidity.add(liquidityAdded);


        console.log("abc %s", tickOrder[_tick].liquidity);

        uint256 nextIndex = tickOrder[_tick].currentIndex.add(1);

        tickOrder[_tick].order[nextIndex] = Order({
        side : _side,
        leverage : _leverage,
        amountAssetQuote : _amountAssetQuote,
        amountAssetBase : _amountAssetBase,
        limitPrice : _limitPrice,
        amountLiquidity : liquidityAdded,

        //TODO edit orderLiquidityRemain
        orderLiquidityRemain : _amountAssetQuote,
        margin : _margin,
        status : Status.OPENING
        });

        emit  OpenLimitOrder(_tick, nextIndex);
        return nextIndex;
        //        return 0;

    }


    function openMarket(
        ParamsOpenMarket memory paramsOpenMarket
    ) external override {
        require(paramsOpenMarket.quoteAmount != 0, 'Invalid amount');

        AmmState memory ammStateStart = ammState;

        require(ammStateStart.unlocked, 'Amm is locked');

        ammState.unlocked = false;
        bool sideBuy = paramsOpenMarket.side == Side.BUY ? true : false;
        (uint256 liquidity, uint256 quoteReserveAmount, uint256 baseReserveAmount) = getLiquidityDetail();

        OpenMarketState memory state = OpenMarketState({
        quoteRemainingAmount : paramsOpenMarket.quoteAmount,
        quoteCalculatedAmount : 0,
        baseRemainingAmount : LiquidityMath.getBaseAmountByQuote(paramsOpenMarket.quoteAmount, sideBuy, liquidity, quoteReserveAmount, baseReserveAmount),
        baseCalculatedAmount : 0,
        price : ammStateStart.price,
        tick : ammStateStart.tick
        });

        while (state.quoteRemainingAmount != 0) {
            StepComputations memory step;
            step.priceStart = state.price;
            (step.tickNext, step.initialized) = TickBitmap.nextInitializedTickWithinOneWord(
                tickBitmap,
                state.tick,
            // true if buy, false if sell
                sideBuy
            );
            // TODO update function getPriceAtTick in TickMath library
            // get price for the next tick
            step.priceNext = TickMath.getPriceAtTick(step.tickNext);
            // TODO check function mostSignificantBit
            // TODO check if current tick is fulfill
            // if not try to fill all of the remaining amount then calculate next step
            // compute values to swap to the target tick or point where quote remaining amount is exhausted
            (state.price, step.quoteCalculatedAmount, step.baseCalculatedAmount) = ComputeAmountMath.computeSwapStep(
                step.priceStart,
                step.priceNext,
                liquidityDetail.liquidity,
                state.quoteRemainingAmount
            );

            state.quoteCalculatedAmount = state.quoteCalculatedAmount.add(step.quoteCalculatedAmount);
            state.quoteRemainingAmount = state.quoteRemainingAmount.sub(step.quoteCalculatedAmount);
            state.baseRemainingAmount = state.baseRemainingAmount.sub(step.baseCalculatedAmount);
            state.baseCalculatedAmount = state.baseCalculatedAmount.add(step.baseCalculatedAmount);

            updateReserve(step.quoteCalculatedAmount, step.baseCalculatedAmount, sideBuy);

            // shift tick if we reached the next tick's price
            if (state.price == step.priceNext) {
                // if the tick is initialized, run the tick transition
                if (step.initialized) {
                    // TODO check limit order in this tick
                    uint256 unfilledLiquidity = tickOrder[step.tickNext].liquidity.sub(tickOrder[step.tickNext].filledLiquidity);
                    uint256 remainingLiquidity = state.quoteRemainingAmount.mul(state.baseRemainingAmount);
                    if (remainingLiquidity < unfilledLiquidity) {
                        tickOrder[step.tickNext].filledLiquidity = tickOrder[step.tickNext].filledLiquidity.add(remainingLiquidity);

                        uint256 filledIndex = tickOrder[step.tickNext].filledIndex;
                        tickOrder[step.tickNext].filledLiquidity = tickOrder[step.tickNext].filledLiquidity.add(remainingLiquidity);

                        while (remainingLiquidity != 0) {
                            if (tickOrder[step.tickNext].order[filledIndex].status == Status.PARTIAL_FILLED) {
                                remainingLiquidity.sub(tickOrder[step.tickNext].order[filledIndex].orderLiquidityRemain);
                                //                                tickOrder[step.tickNext].order[filledIndex].status = Status.OPENING;
                                //                                tickOrder[step.tickNext].order[filledIndex].orderLiquidityRemain = 0;
                                filledIndex = filledIndex.add(1);

                            } else if (tickOrder[step.tickNext].order[filledIndex].status == Status.OPENING) {
                                if (remainingLiquidity > tickOrder[step.tickNext].order[filledIndex].orderLiquidityRemain) {
                                    remainingLiquidity = remainingLiquidity.sub(tickOrder[step.tickNext].order[filledIndex].orderLiquidityRemain);
                                    filledIndex = filledIndex.add(1);

                                } else {
                                    tickOrder[step.tickNext].order[filledIndex].orderLiquidityRemain = tickOrder[step.tickNext].order[filledIndex].orderLiquidityRemain.sub(remainingLiquidity);
                                    tickOrder[step.tickNext].order[filledIndex].status = Status.PARTIAL_FILLED;
                                    remainingLiquidity = 0;

                                }

                            }
                        }
                        state.quoteCalculatedAmount = state.quoteCalculatedAmount.add(state.quoteRemainingAmount);
                        state.baseCalculatedAmount = state.baseCalculatedAmount.add(state.baseRemainingAmount);
                        (state.quoteRemainingAmount, state.baseRemainingAmount) = (0, 0);

                        tickOrder[step.tickNext].filledIndex = filledIndex;


                    } else {
                        tickOrder[step.tickNext].filledLiquidity = tickOrder[step.tickNext].filledLiquidity.add(unfilledLiquidity);
                        tickOrder[step.tickNext].filledIndex = tickOrder[step.tickNext].currentIndex;
                        state.quoteCalculatedAmount = state.quoteCalculatedAmount.add(Calc.sqrt(unfilledLiquidity.mul(state.price)));
                        state.quoteRemainingAmount = state.quoteRemainingAmount.sub(Calc.sqrt(unfilledLiquidity.mul(state.price)));
                        state.baseRemainingAmount = state.baseRemainingAmount.sub(Calc.sqrt(unfilledLiquidity.div(state.price)));
                        state.baseCalculatedAmount = state.baseCalculatedAmount.add(Calc.sqrt(unfilledLiquidity.div(state.price)));
                        // TODO calculate remaining amount after fulfill this tick's liquidity
                        state.tick = step.tickNext;
                        TickBitmap.flipTick(tickBitmap, state.tick);
                    }
                }
            } else if (state.price < step.priceNext) {
                state.tick = TickMath.getTickAtPrice(state.price);
            }
        }

                if (state.tick != ammStateStart.tick) {
                    (ammState.tick, ammState.price) = (
                    state.tick,
                    state.price
                    );
                }
                updateReserve(state.quoteCalculatedAmount, state.baseCalculatedAmount, true);

        //TODO open position market
        PositionOpenMarket memory position = positionMarketMap[paramsOpenMarket._trader];

        // TODO position.side == side
        if (position.side == paramsOpenMarket.side) {

            //TODO increment position
            // same side
            positionMarketMap[paramsOpenMarket._trader].margin = positionMarketMap[paramsOpenMarket._trader].margin.add(paramsOpenMarket.margin);
            positionMarketMap[paramsOpenMarket._trader].amountAssetQuote = positionMarketMap[paramsOpenMarket._trader].amountAssetQuote.add(paramsOpenMarket.quoteAmount);
            positionMarketMap[paramsOpenMarket._trader].amountAssetBase = positionMarketMap[paramsOpenMarket._trader].amountAssetBase.add(paramsOpenMarket.baseAmount);


        } else {
            // TODO decrement position
            if (paramsOpenMarket.margin > positionMarketMap[paramsOpenMarket._trader].margin) {
                // open reserve position
                if (position.side == Side.BUY) {
                    positionMarketMap[paramsOpenMarket._trader].side = Side.SELL;

                } else {
                    positionMarketMap[paramsOpenMarket._trader].side = Side.SELL;
                }

            }
            positionMarketMap[paramsOpenMarket._trader].margin = positionMarketMap[paramsOpenMarket._trader].margin.sub(paramsOpenMarket.margin);
            positionMarketMap[paramsOpenMarket._trader].amountAssetQuote = positionMarketMap[paramsOpenMarket._trader].amountAssetQuote.add(paramsOpenMarket.quoteAmount);
            positionMarketMap[paramsOpenMarket._trader].amountAssetBase = positionMarketMap[paramsOpenMarket._trader].amountAssetBase.add(paramsOpenMarket.baseAmount);
        }
        ammState.unlocked = true;
    }

    function cancelOrder(address _trader, uint256 _index, int256 _tick) external override {
        require(_index > tickOrder[_tick].filledIndex, 'Require not filled open yet');


        tickOrder[_tick].liquidity = tickOrder[_tick].liquidity.sub(tickOrder[_tick].order[_index].amountLiquidity);
        tickOrder[_tick].order[_index].status = Status.CANCEL;

        for (uint256 i = 0; i < positionMap[_trader].length; i++) {

            if (positionMap[_trader][i].index == _index) {
                positionMap[_trader][i] = positionMap[_trader][positionMap[_trader].length - 1];
                positionMap[_trader].pop();

            }
        }


        emit CancelOrder(_tick, _index);
    }


    function cancelAllOrder(address _trader) external override {

        for (uint256 i = 0; i < positionMap[_trader].length; i++) {

            if (positionMap[_trader][i].index < tickOrder[positionMap[_trader][i].tick].filledIndex) {

                int256 _tick = positionMap[_trader][i].tick;
                uint256 _index = positionMap[_trader][i].index;
                tickOrder[_tick].liquidity = tickOrder[_tick].liquidity.sub(tickOrder[_tick].order[_index].amountLiquidity);
                tickOrder[_tick].order[_index].status = Status.CANCEL;

                positionMap[_trader][i] = positionMap[_trader][positionMap[_trader].length - 1];
                positionMap[_trader].pop();

            }
        }

    }

    function addPositionMap(address _trader, int256 tick, uint256 index) external override {
        positionMap[_trader].push(Position({
        index : index,
        tick : tick})
        );
    }

    function closePosition(address _trader) external override {

        // TODO require close position


        // TODO close position
        // calc PnL, transfer money
        //


        //        Position[] memory templePosition;

        for (uint256 i = 0; i < positionMap[_trader].length; i++) {
            int256 tickOrder = positionMap[_trader][i].tick;
            uint256 indexOrder = positionMap[_trader][i].index;

            if (getIsWaitingOrder(tickOrder, indexOrder) == true) {
                //                templePosition.push(Position(indexOrder, tickOrder));
            }
        }

        //        positionMap[_trader] = templePosition;
    }

    function addMargin(uint256 index, int256 tick, uint256 _amountAdded) public {
        require(
            _amountAdded != 0,
            Errors.VL_INVALID_AMOUNT
        );
        // TODO addMargin, cal position
        tickOrder[tick].order[index].margin = tickOrder[tick].order[index].margin.add(_amountAdded);

    }

    function removeMargin(uint256 index, int256 tick, uint256 _amountRemoved) external override {
        require(
            _amountRemoved != 0,
            Errors.VL_INVALID_AMOUNT
        );
        // TODO removeMargin, calc
        tickOrder[tick].order[index].margin = tickOrder[tick].order[index].margin.sub(_amountRemoved);
    }

    function getPnL(address owner, uint256 index, int256 tick) public view returns(uint256) {
//        requireAmm(_amm, true);


        return 0;
    }

    function updateReserve(
        uint256 _quoteAssetAmount,
        uint256 _baseAssetAmount,
        bool sideBuy
    ) internal {
        if (sideBuy == true) {
            liquidityDetail.quoteReserveAmount = liquidityDetail.quoteReserveAmount.add(_quoteAssetAmount);
            liquidityDetail.baseReserveAmount = liquidityDetail.baseReserveAmount.sub(_baseAssetAmount);
        } else {
            liquidityDetail.quoteReserveAmount = liquidityDetail.quoteReserveAmount.sub(_quoteAssetAmount);
            liquidityDetail.baseReserveAmount = liquidityDetail.baseReserveAmount.add(_baseAssetAmount);
        }
        liquidityDetail.liquidity = liquidityDetail.quoteReserveAmount.mul(liquidityDetail.baseReserveAmount);
    }

    function updateFundingRate(
        uint256 _premiumFraction,
        uint256 _underlyingPrice
    ) private {
        fundingRate = _premiumFraction.div(_underlyingPrice);
        emit FundingRateUpdated(fundingRate, _underlyingPrice);
    }

    function getIsWaitingOrder(int256 _tick, uint256 _index) public view returns (bool)
    {
        //        return tickOrder[_tick].order[_index].status == Status.OPENING && tickOrder[_tick].filledIndex < _index;
        return true;
    }

    function getIsOrderExecuted(int256 _tick, uint256 _index) external view override returns (bool) {

        if (_index > tickOrder[_tick].filledIndex) {
            return false;
        }
        return true;
    }

    function getReserve() external view returns (uint256, uint256){
        //        return (quoteReserve, baseReserve);getIsWaitingOrder
        return (0, 0);
    }

    function getTotalPositionSize() external view override returns (uint256) {

        //        return totalPositionSize;
        return 0;
    }

    function getCurrentTick() external view override returns (int256) {
        return ammState.tick;
    }

    function settleFunding() external view override returns (uint256){
        //
        //        require(_blockTimestamp() >= nextFundingTime, Errors.A_AMM_SETTLE_TO_SOON);
        //        // premium = twapMarketPrice - twapIndexPrice
        //        // timeFraction = fundingPeriod(1 hour) / 1 day
        //        // premiumFraction = premium * timeFraction
        //        uint256 underlyingPrice = getUnderlyingTwapPrice(spotPriceTwapInterval);
        //        uint256 premium = getTwapPrice(spotPriceTwapInterval).sub(underlyingPrice);
        //        uint256 premiumFraction = premium.mul(fundingPeriod).div(uint256(1 days));
        //
        //        // update funding rate = premiumFraction / twapIndexPrice
        //        //        updateFundingRate(premiumFraction, underlyingPrice);
        //
        //        // in order to prevent multiple funding settlement during very short time after network congestion
        //        uint256 minNextValidFundingTime = _blockTimestamp().add(fundingBufferPeriod);
        //
        //        // floor((nextFundingTime + fundingPeriod) / 3600) * 3600
        //        uint256 nextFundingTimeOnHourStart = nextFundingTime.add(fundingPeriod).div(1 hours).mul(1 hours);
        //
        //        // max(nextFundingTimeOnHourStart, minNextValidFundingTime)
        //        //        nextFundingTime = nextFundingTimeOnHourStart > minNextValidFundingTime
        //        //        ? nextFundingTimeOnHourStart
        //        //        : minNextValidFundingTime;
        //
        //        // DEPRECATED only for backward compatibility before we upgrade PositionHouse
        //        // reset funding related states
        //        uint256 baseAssetDeltaThisFundingPeriod = 0;
        //
        //        return premiumFraction;
        return 0;
    }

//    function swapInput(
//        Dir _dirOfQuote,
//        uint256 _quoteAssetAmount,
//        uint256 _baseAssetAmountLimit,
//        bool _canOverFluctuationLimit
//    ) external returns (uint256) {
//        //        if (_quoteAssetAmount == 0) {
//        //            return 0;
//        //        }
//        //        if (_dirOfQuote == Dir.REMOVE_FROM_AMM) {
//        //            require(
//        //                quoteReserve.mul(tradeLimitRatio) >= _quoteAssetAmount,
//        //                "over trading limit"
//        //            );
//        //        }
//        //        uint256 baseAssetAmount = getInputPrice(_dirOfQuote, _quoteAssetAmount);
//        //        //TODO base asset amount limit
//        //
//        //        updateReserve(_dirOfQuote, _quoteAssetAmount, baseAssetAmount, _canOverFluctuationLimit);
//        //        emit SwapInput(_dirOfQuote, _quoteAssetAmount, baseAssetAmount);
//        //        return baseAssetAmount;
//    }
//
//    function swapOutput(
//        Dir _dirOfBase,
//        uint256 _baseAssetAmount,
//        uint256 _quoteAssetAmountLimit
//    ) external returns (uint256) {
//        //        if (_baseAssetAmount == 0) {
//        //            return 0;
//        //        }
//        //        if (_dirOfBase == Dir.REMOVE_FROM_AMM) {
//        //            require(
//        //                baseReserve.mul(tradeLimitRatio) >= _baseAssetAmount,
//        //                "over trading limit"
//        //            );
//        //        }
//        //
//        //        uint256 quoteAssetAmount = getOutputPrice(_dirOfBase, _baseAssetAmount);
//        //        //TODO quote asset amount limit
//        //
//        //        updateReserve(_dirOfBase, quoteAssetAmount, _baseAssetAmount, true);
//        //        emit SwapOutput(_dirOfBase, quoteAssetAmount, _baseAssetAmount);
//        //        return quoteAssetAmount;
//
//
//        return 0;
//    }

    /**
     * @notice get underlying price provided by oracle
     * @return underlying price
     */
    function getUnderlyingPrice() public view returns (uint256) {
        //        return Decimal.decimal(priceFeed.getPrice(priceFeedKey));
        return 0;
    }

    /**
     * @notice get underlying twap price provided by oracle
     * @return underlying price
     */
    function getUnderlyingTwapPrice(uint256 _intervalInSeconds) public view returns (uint256) {
        //        return Decimal.decimal(priceFeed.getTwapPrice(priceFeedKey, _intervalInSeconds));
        return 0;
    }

    /**
     * @notice get spot price based on current quote/base asset reserve.
     * @return spot price
     */
    function getSpotPrice() public view returns (uint256) {
        //        return quoteAssetReserve.divD(baseAssetReserve);
        return 0;
    }

    /**
     * @notice get twap price
     */
    function getTwapPrice(uint256 _intervalInSeconds) public view returns (uint256) {
        //        return implGetReserveTwapPrice(_intervalInSeconds);
        return 0;
    }

}