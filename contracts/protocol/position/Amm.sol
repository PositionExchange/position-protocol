// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;
/**
*  @title This contract for each pair
* Function for Amm in here
*/
import {BlockContext} from "../libraries/helpers/BlockContext.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IAmm} from "../../interfaces/IAmm.sol";
import {IChainLinkPriceFeed} from "../../interfaces/IChainLinkPriceFeed.sol";
import {Errors} from "../libraries/helpers/Errors.sol";
import {Calc} from "../libraries/math/Calc.sol";
import {SqrtPriceMath} from "../libraries/math/PriceMath.sol";
import {TickMath} from "../libraries/math/TickMath.sol";
import {ComputeAmountMath} from "../libraries/math/ComputeAmountMath.sol";
import "./PositionHouse.sol";
import "../libraries/amm/PositionLimit.sol";
import "../libraries/amm/Tick.sol";
import "./PositionHouse.sol";
import "../../interfaces/IAmmState.sol";

contract Amm is IAmm, IAmmState, BlockContext {
    using SafeMath for uint256;
    using Calc for uint256;

    // variable
    uint256 public spotPriceTwapInterval;
    uint256 public fundingPeriod;
    uint256 public fundingBufferPeriod;
    uint256 fundingRate;
    uint256 tradeLimitRatio;
    // update during every swap and used when shutting amm down. it's trader's total base asset size
    uint256 public totalPositionSize;
    IChainLinkPriceFeed public priceFeed;


    /// list of all tick index
    mapping(uint256 => Tick.Info) public override ticks;
    /// bitmap of all tick, show initialized ticks
    mapping(int16 => uint256) public override tickBitmap;
    ///
    mapping(bytes32 => PositionLimit.Info) public override positions;

    mapping(address => uint) public balances;

    struct AmmState {
        uint256 price;
        int24 tick;
        bool unlocked;
    }

    struct LiquidityDetail {
        uint256 liquidity;
        uint256 baseReserveAmount;
        uint256 quoteReserveAmount;
    }

    /// IAmmState
    AmmState public override ammState;

    /// IAmmState
    LiquidityDetail public override liquidityDetail;

    bool public override open;
    uint256 public nextFundingTime;
    bytes32 public priceFeedKey;


    struct ModifyPositionParams {
        // the address that owns the position
        address trader;
        // tick
        int24 tick;
        // any change in liquidity
        int128 liquidityDelta;
    }

    /**
    * @notice event in amm
    * List event in amm
    */
    event SwapInput(Dir dir, uint256 quoteAssetAmount, uint256 baseAssetAmount);
    event SwapOutput(Dir dir, uint256 quoteAssetAmount, uint256 baseAssetAmount);
    event FundingRateUpdated(int256 rate, uint256 underlyingPrice);
    event CancelOrder(uint256 tick, uint256 index);

    event OpenLimitOrder(uint256 tick, uint256 index);
    event OpenMarketOrder(uint256 tick, uint256 index);

    /**
     * @notice MODIFIER
    */

    modifier onlyOpen() {
        require(open, Errors.A_AMM_IS_OPEN);
        _;
    }
    modifier onlyCounterParty() {
        require(counterParty == _msgSender(), Errors.A_AMM_CALLER_IS_NOT_COUNTER_PARTY);
        _;
    }

    function initialize(
        uint256 startPrice,

    // from exchange
        uint256 _quoteAssetReserve,
        uint256 _baseAssetReserve,
        uint256 _tradeLimitRatio,
        uint256 _fundingPeriod,
        IChainLinkPriceFeed _priceFeed,
        bytes32 _priceFeedKey,
        address _quoteAsset,
        uint256 _fluctuationLimitRatio,
        uint256 _tollRatio,
        uint256 _spreadRatio) public {
        require(
            _quoteAssetReserve != 0 &&
            _tradeLimitRatio != 0 &&
            _baseAssetReserve != 0 &&
            _fundingPeriod != 0 &&
            address(_priceFeed) != address(0) &&
            _quoteAsset != address(0),

            sqrtStartPrice != 0,

            Errors.VL_INVALID_AMOUNT
        );

        spotPriceTwapInterval = 1 hours;
        // initialize tick
        int24 tick = TickMath.getTickAtSqrtRatio(sqrtPriceX96);
        slot0 = Slot0({
        sqrtPriceX96 : sqrtPriceX96,
        tick : tick,
        unlocked : true
        });

        spotPriceTwapInterval = 1 hours;
        setQuoteReserve(_quoteAssetReserve);
        setBaseReserve(_baseAssetReserve);
        priceFeedKey = _priceFeedKey;
        priceFeed = _priceFeed;
    }

    // margin =_amountAssetQuote / _leverage
    //
    function openLimit(
        uint256 _amountAssetBase,
        uint256 _amountAssetQuote,
        uint256 _margin,
        uint256 _limitAmountPriceBase,
        Side _side,
        int24 _tick,
        uint8 _leverage) public{

        // TODO require openLimit
        require(_amountAssetBase != 0 &&
            _amountAssetQuote != 0, "Require difference 0");


        // TODO calc liquidity added

        uint256 liquidityAdded = _amountAssetQuote;


        tickOrder[_tick].liquidity += liquidityAdded;

        uint256 nextIndex = tickOrder[_tick].currentIndex + 1;


        tickOrder[_tick].order[nextIndex] = Order({
        side : _side,
        leverage : _leverage,
        amountAssetQuote : _amountAssetQuote,
        amountAssetBase : _amountAssetBase,
        status : Status.OPENING,
        margin : _amountAssetQuote.div(_leverage)
        });


        emit  OpenLimitOrder(_tick, nextIndex);


    }


    struct OpenMarketState {
        // the amount remaining to be swapped in/out of the input/output asset
        uint256 amountRemaining;
        // the amount already swapped out/in of the output/input asset
        uint256 amountCalculated;
        // current price
        uint256 price;
        // current tick
        uint256 tick;
    }

    struct StepComputations {
        // the price at the beginning of the step
        uint256 priceStart;
        // the next tick to swap to from the current tick in the swap direction
        uint256 tickNext;
        // whether tickNext is initialized or not
        bool initialized;
        // price for the next tick (1/0)
        uint256 priceNext;
        // how much is being swapped in in this step
        uint256 quoteCalculatedAmount;
        // how much is being swapped out
        uint256 baseCalculatedAmount;

    }

    function openMarket(
        Side side,
        uint256 amount

    ) external {
        require(amount != 0, 'Invalid amount');
        AmmState memory ammStateStart = ammState;

        require(ammStateStart.unlocked, 'Amm is locked');

        OpenMarketState memory state = OpenMarketState({
            amountRemaining : amount,
            amountCalculated : 0,
            price : ammStateStart.price,
            tick : ammStateStart.tick
        });

        while (state.amountRemaining != 0) {
            StepComputations memory step;
            step.priceStart = state.price;
            // TODO create function nextInitializedTick in tickBitmap
            // nextInitializedTick param are currentTick, boolean lte
            (step.tickNext, step.initialized) = tickBitmap.nextInitializedTick(
                state.tick,
            // true if buy, false if sell
                side == 0 ? true : false
            );
            // TODO update function getPriceAtTick in TickMath library
            // get price for the next tick
            step.priceNext = TickMath.getPriceAtTick(step.tickNext);

            // TODO refactor function computeSwapStep to return amountIn and amountOut
            // compute values to swap to the target tick or point where input/output amount is exhausted
            (state.price, step.quoteCalculatedAmount, step.baseCalculatedAmount) = ComputeAmountMath.computeSwapStep(
                state.price,
            // TODO update target price param
                targetPrice,
            // TODO update liquidity param
                liquidity,
                state.amountRemaining
            );

            if (amount > 0) {
                state.amountRemaining = state.amountRemaining.sub(step.amountIn);
                state.amountCalculated =  state.amountCalculated.add(step.amountOut);
            } else {
                state.amountRemaining = state.amountRemaining.add(step.amountOut);
                state.amountCalculated = state.amountCalculated.sub(step.amountIn);
            }

            // shift tick if we reached the next tick's price
            if (state.price == step.priceNext) {
                // if the tick is initialized, run the tick transition
                if (step.initialized) {
                    // TODO check limit order in this tick
                    uint256 unfilledLiquidity = tickOrder[step.tickNext].liquidity - tickOrder[step.tickNext].liquidity;
//                    if (step.quoteCalculatedAmount )
                } else {


                }// tick is not initialized
            }
        }
    }

    function cancelOrder(uint _index, uint _tick) public{
        require(_index > tickOrder[_tick].filledIndex, 'Require not filled open yet');

        // sub liquidity when cancel order
        tickOrder[_tick].liquidity -= tickOrder[tick].order[_index].amountAssetQuote;
        tickOrder[_tick].order[_index].status = Status.CANCEL;

        emit CancelOrder(_tick, _index);
    }

    function addMargin(uint256 index, uint256 tick, uint256 _amountAdded) public  {
        require(
            _amountAdded != 0,
            Errors.VL_INVALID_AMOUNT
        );
        // TODO addMargin, cal position
        tickOrder[tick].order[index].margin.add(amountAdded);

    }

    function removeMargin(uint256 index, uint256 tick, uint256 _amountRemoved) public {
        require(
            _amountRemoved != 0,
            Errors.VL_INVALID_AMOUNT
        );
        // TODO removeMargin, calc
        tickOrder[tick].order[index].margin.sub(amountAdded);
    }

    function swapInput(
        Dir _dirOfQuote,
        uint256 _quoteAssetAmount,
        uint256 _baseAssetAmountLimit,
        bool _canOverFluctuationLimit
    ) external override returns (uint256 memory) {
        if (_quoteAssetAmount == 0) {
            return 0;
        }
        if (_dirOfQuote == Dir.REMOVE_FROM_AMM) {
            require(
                quoteReserve.mul(tradeLimitRatio) >= _quoteAssetAmount,
                "over trading limit"
            );
        }
        uint256 baseAssetAmount = getInputPrice(_dirOfQuote, _quoteAssetAmount);
        //TODO base asset amount limit

        updateReserve(_dirOfQuote, _quoteAssetAmount, baseAssetAmount, _canOverFluctuationLimit);
        emit SwapInput(_dirOfQuote, _quoteAssetAmount, baseAssetAmount);
        return baseAssetAmount;
    }

    function swapOutput(
        Dir _dirOfBase,
        uint256 _baseAssetAmount,
        uint256 _quoteAssetAmountLimit
    ) external override returns (uint256 memory) {
        if (_baseAssetAmount == 0) {
            return 0;
        }
        if (_dirOfBase == Dir.REMOVE_FROM_AMM) {
            require(
                baseReserve.mul(tradeLimitRatio) >= _baseAssetAmount,
                "over trading limit"
            );
        }

        uint256 quoteAssetAmount = getOutputPrice(_dirOfBase, _baseAssetAmount);
        //TODO quote asset amount limit

        updateReserve(_dirOfBase, quoteAssetAmount, _baseAssetAmount, true);
        emit SwapOutput(_dirOfBase, quoteAssetAmount, _baseAssetAmount);
        return quoteAssetAmount;
    }

    function updateReserve(
        Dir _dirOfQuote,
        uint256 _quoteAssetAmount,
        uint256 _baseAssetAmount,
        bool _canOverFluctuationLimit
    ) internal {
        //Check if it is over fluctuationLimitRatio
        checkIsOverBlockFluctuationLimit(_dirOfQuote, _quoteAssetAmount, _baseAssetAmount);

        if (_dirOfQuote == Dir.ADD_TO_AMM) {
            liquidityDetail.quoteReserveAmount = liquidityDetail.quoteReserveAmount.add(_quoteAssetAmount);
            liquidityDetail.baseReserveAmount = liquidityDetail.baseReserveAmount.sub(_baseAssetAmount);
            //TODO maybe have to update more variant
        } else {
            liquidityDetail.quoteReserveAmount = liquidityDetail.quoteReserveAmount.sub(_quoteAssetAmount);
            liquidityDetail.baseReserveAmount = liquidityDetail.baseReserveAmount.add(_baseAssetAmount);
            //TODO maybe have to update more variant
        }
    }

    function updateFundingRate(
        uint256 memory _premiumFraction,
        uint256 memory _underlyingPrice
    ) private {
        fundingRate = _premiumFraction.div(_underlyingPrice);
        emit FundingRateUpdated(fundingRate.toInt(), _underlyingPrice.toUint());
    }

    function getIsWaitingOrder(uint256 _tick, uint256 _index) external view returns (bool memory){

        return tickOrder[_tick].order[_index].status == Status.OPENING && tickOrder[_tick].filledIndex < _index;
    }

    function getReserve() external view returns (uint256 memory, uint256 memory){
        return (quoteReserve, baseReserve);
    }

    function getTotalPositionSize() external view override returns (uint256 memory) {
        return totalPositionSize;
    }

    function settleFunding() external onlyOpen onlyCounterParty returns (uint256 memory){

        require(_blockTimestamp >= nextFundingTime, Errors.A_AMM_SETTLE_TO_SOON);
        // premium = twapMarketPrice - twapIndexPrice
        // timeFraction = fundingPeriod(1 hour) / 1 day
        // premiumFraction = premium * timeFraction
        uint256 memory underlyingPrice = getUnderlyingTwapPrice(spotPriceTwapInterval);
        uint256 memory premium = getTwapPrice(spotPriceTwapInterval).sub(underlyingPrice);
        uint256 memory premiumFraction = premium.mul(fundingPeriod).div(int256(1 days));

        // update funding rate = premiumFraction / twapIndexPrice
        updateFundingRate(premiumFraction, underlyingPrice);

        // in order to prevent multiple funding settlement during very short time after network congestion
        uint256 minNextValidFundingTime = _blockTimestamp().add(fundingBufferPeriod);

        // floor((nextFundingTime + fundingPeriod) / 3600) * 3600
        uint256 nextFundingTimeOnHourStart = nextFundingTime.add(fundingPeriod).div(1 hours).mul(1 hours);

        // max(nextFundingTimeOnHourStart, minNextValidFundingTime)
        nextFundingTime = nextFundingTimeOnHourStart > minNextValidFundingTime
        ? nextFundingTimeOnHourStart
        : minNextValidFundingTime;

        // DEPRECATED only for backward compatibility before we upgrade PositionHouse
        // reset funding related states
        baseAssetDeltaThisFundingPeriod = 0;

        return premiumFraction;
    }

    /**
     * @notice get underlying price provided by oracle
     * @return underlying price
     */
    function getUnderlyingPrice() public view override returns (uint256 memory) {
        return Decimal.decimal(priceFeed.getPrice(priceFeedKey));
    }

    /**
     * @notice get underlying twap price provided by oracle
     * @return underlying price
     */
    function getUnderlyingTwapPrice(uint256 _intervalInSeconds) public view returns (uint256 memory) {
        return Decimal.decimal(priceFeed.getTwapPrice(priceFeedKey, _intervalInSeconds));
    }

    /**
     * @notice get spot price based on current quote/base asset reserve.
     * @return spot price
     */
    function getSpotPrice() public view override returns (uint256 memory) {
        return quoteAssetReserve.divD(baseAssetReserve);
    }

    /**
     * @notice get twap price
     */
    function getTwapPrice(uint256 _intervalInSeconds) public view returns (Decimal.decimal memory) {
        return implGetReserveTwapPrice(_intervalInSeconds);
    }

}