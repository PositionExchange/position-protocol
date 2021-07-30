// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;
/**
*  @title This contract for each pair
* Function for Amm in here
*/
import {BlockContext} from "../libraries/helpers/BlockContext.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IAmm} from "../../interfaces/a.sol";
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
    //    mapping(uint256 => Tick.Info) public override ticks;
    /// bitmap of all tick, show initialized ticks
    mapping(int16 => uint256) public override tickBitmap;
    ///
    //    mapping(bytes32 => PositionLimit.Info) public override positions;

    mapping(address => uint) public balances;


    struct LiquidityDetail {
        uint256 liquidity;
        uint256 baseReserveAmount;
        uint256 quoteReserveAmount;
    }


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
    //    modifier onlyCounterParty() {
    //        require(counterParty == _msgSender(), Errors.A_AMM_CALLER_IS_NOT_COUNTER_PARTY);
    //        _;
    //    }

    function initialize(
        uint256 startPrice,
        uint256 _quoteAssetReserve,
        uint256 _baseAssetReserve,
        uint256 _tradeLimitRatio,
        uint256 _fundingPeriod,
        IChainLinkPriceFeed _priceFeed,
        uint256 sqrtStartPrice,
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
        int24 tick = TickMath.getTickAtSqrtRatio(sqrtStartPrice);
        ammState = AmmState({
        sqrtPriceX96 : sqrtStartPrice,
        tick : tick,
        unlocked : true
        });

        spotPriceTwapInterval = 1 hours;
    }

    function getLiquidityDetail() internal pure returns (uint256 liquidity, uint256 quoteReserveAmount, uint256 baseReserveAmount) {
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
        uint256 _margin,
        uint256 _limitAmountPriceBase,
        Side _side,
        int24 _tick,
        uint8 _leverage) public returns (uint256 nextIndex){

        // TODO require openLimit
        require(_amountAssetBase != 0 &&
            _amountAssetQuote != 0, "Require difference 0");


        // TODO calc liquidity added

        uint256 liquidityAdded = _amountAssetQuote;


        tickOrder[_tick].liquidity.add(liquidityAdded);

        uint256 nextIndex = tickOrder[_tick].currentIndex.add(1);

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
        uint256 quoteAmount,
        uint256 leverage,
        uint256 margin,
        address _trader

    ) external {
        require(quoteAmount != 0, 'Invalid amount');
        AmmState memory ammStateStart = ammState;

        require(ammStateStart.unlocked, 'Amm is locked');


        bool sideBuy = side == Side.BUY ? true : false;
        (uint256 liquidity, uint256 quoteReserveAmount, uint256 baseReserveAmount) = getLiquidityDetail();

        OpenMarketState memory state = OpenMarketState({
        quoteRemainingAmount : quoteAmount,
        quoteCalculatedAmount : 0,
        baseRemainingAmount : LiquidityMath.getBaseAmountByQuote(quoteAmount, sideBuy, liquidity, quoteReserveAmount, baseReserveAmount),
        baseCalculatedAmount : 0,
        price : ammStateStart.price,
        tick : ammStateStart.tick
        });

        while (state.quoteRemainingAmount != 0) {
            StepComputations memory step;
            step.priceStart = state.price;
            // TODO create function nextInitializedTick in tickBitmap
            // nextInitializedTick param are currentTick, boolean lte
            (step.tickNext, step.initialized) = tickBitmap.nextInitializedTick(
                state.tick,
            // true if buy, false if sell
                sideBuy
            );
            // TODO update function getPriceAtTick in TickMath library
            // get price for the next tick
            step.priceNext = TickMath.getPriceAtTick(step.tickNext);
            // TODO check if current tick is fulfill
            // if not try to fill all of the remaining amount then calculate next step
            // TODO refactor function computeSwapStep to return amountIn and amountOut
            // compute values to swap to the target tick or point where input/output amount is exhausted
            (state.price, step.quoteCalculatedAmount, step.baseCalculatedAmount) = ComputeAmountMath.computeSwapStep(
                step.priceStart,
            // TODO update target price param
                step.priceNext,
            // TODO update liquidity param
                liquidityDetail.liquidity,
                state.quoteRemainingAmount
            );

            state.quoteCalculatedAmount = state.quoteCalculatedAmount.add(step.quoteCalculatedAmount);
            state.quoteRemainingAmount = state.quoteRemainingAmount.sub(step.quoteCalculatedAmount);
            state.baseRemainingAmount = state.baseRemainingAmount.sub(step.baseCalculatedAmount);
            state.baseCalculatedAmount = state.baseCalculatedAmount.add(step.baseCalculatedAmount);


            // shift tick if we reached the next tick's price
            if (state.price == step.priceNext) {
                // if the tick is initialized, run the tick transition
                if (step.initialized) {
                    // TODO check limit order in this tick
                    uint256 unfilledLiquidity = tickOrder[step.tickNext].liquidity.sub(tickOrder[step.tickNext].filledLiquidity);
                    uint256 remainingLiquidity = state.quoteRemainingAmount.mul(state.baseRemainingAmount);
                    if (remainingLiquidity < unfilledLiquidity) {
                        tickOrder[step.tickNext].filledLiquidity.add(remainingLiquidity);

                        uint256 filledIndex = tickOrder[step.tickNext].filledIndex;
                        tickOrder[step.tickNext].filledLiquidity.add(remainingLiquidity);

                        while (remainingLiquidity != 0) {
                            if (tickOrder[step.tickNext].order[filledIndex].status == Status.PARTIAL_FILLED) {
                                remainingLiquidity.sub(tickOrder[step.tickNext].order[filledIndex].orderLiquidityRemain);
                                //                                tickOrder[step.tickNext].order[filledIndex].status = Status.OPENING;
                                //                                tickOrder[step.tickNext].order[filledIndex].orderLiquidityRemain = 0;
                                filledIndex.add(1);

                            } else if (tickOrder[step.tickNext].order[filledIndex].status == Status.OPENING) {
                                if (remainingLiquidity > tickOrder[step.tickNext].order[filledIndex].orderLiquidityRemain) {
                                    remainingLiquidity.sub(tickOrder[step.tickNext].order[filledIndex].orderLiquidityRemain);
                                    filledIndex.add(1);

                                } else {
                                    tickOrder[step.tickNext].order[filledIndex].orderLiquidityRemain.sub(remainingLiquidity);
                                    tickOrder[step.tickNext].order[filledIndex].status = Status.PARTIAL_FILLED;
                                    remainingLiquidity = 0;

                                }

                            }
                        }

                        tickOrder[step.tickNext] = filledIndex;


                    } else {
                        tickOrder[step.tickNext].filledLiquidity.add(remainingLiquidity);
                        tickOrder[step.tickNext].filledIndex = tickOrder[step.tickNext].currentIndex;
                    }
                }
                else {


                }
                // tick is not initialized
            } else {
                // TODO check function in tickBitmap to
            }
        }

        //TODO open position market
        PositionOpenMarket memory position = positionMarketMap[_trader];

        if ((position.side == Side.BUY && sideBuy == true)
            || ([position.side == Side.SELL] && side == false)) {

            //TODO increment position
            // same side
            positionMarketMap[_trader].margin.add(margin);
            positionMarketMap[_trader].amountAssetQuote.add(quoteAmount);


        } else {
            // TODO decrement position
            if (margin > positionMarketMap[_trader].margin) {
                // open reserve position
                if (position.side = Side.BUY) {
                    positionMarketMap[_trader].side = Side.SELL;

                } else {
                    positionMarketMap[_trader].side = Side.SELL;
                }

            }
            positionMarketMap[_trader].margin.sub(margin);
            positionMarketMap[_trader].amountAssetQuote.add(quoteAmount);
        }


    }

    function cancelOrder(uint _index, uint _tick) public {
        require(_index > tickOrder[_tick].filledIndex, 'Require not filled open yet');

        // sub liquidity when cancel order
        tickOrder[_tick].liquidity -= tickOrder[_tick].order[_index].amountAssetQuote;
        tickOrder[_tick].order[_index].status = Status.CANCEL;

        emit CancelOrder(_tick, _index);
    }

    function addMargin(uint256 index, uint256 tick, uint256 _amountAdded) public {
        require(
            _amountAdded != 0,
            Errors.VL_INVALID_AMOUNT
        );
        // TODO addMargin, cal position
        tickOrder[tick].order[index].margin.add(_amountAdded);

    }

    function removeMargin(uint256 index, uint256 tick, uint256 _amountRemoved) public {
        require(
            _amountRemoved != 0,
            Errors.VL_INVALID_AMOUNT
        );
        // TODO removeMargin, calc
        tickOrder[tick].order[index].margin.sub(_amountRemoved);
    }

    function swapInput(
        Dir _dirOfQuote,
        uint256 _quoteAssetAmount,
        uint256 _baseAssetAmountLimit,
        bool _canOverFluctuationLimit
    ) external override returns (uint256) {
        //        if (_quoteAssetAmount == 0) {
        //            return 0;
        //        }
        //        if (_dirOfQuote == Dir.REMOVE_FROM_AMM) {
        //            require(
        //                quoteReserve.mul(tradeLimitRatio) >= _quoteAssetAmount,
        //                "over trading limit"
        //            );
        //        }
        //        uint256 baseAssetAmount = getInputPrice(_dirOfQuote, _quoteAssetAmount);
        //        //TODO base asset amount limit
        //
        //        updateReserve(_dirOfQuote, _quoteAssetAmount, baseAssetAmount, _canOverFluctuationLimit);
        //        emit SwapInput(_dirOfQuote, _quoteAssetAmount, baseAssetAmount);
        //        return baseAssetAmount;
    }

    function swapOutput(
        Dir _dirOfBase,
        uint256 _baseAssetAmount,
        uint256 _quoteAssetAmountLimit
    ) external returns (uint256) {
        //        if (_baseAssetAmount == 0) {
        //            return 0;
        //        }
        //        if (_dirOfBase == Dir.REMOVE_FROM_AMM) {
        //            require(
        //                baseReserve.mul(tradeLimitRatio) >= _baseAssetAmount,
        //                "over trading limit"
        //            );
        //        }
        //
        //        uint256 quoteAssetAmount = getOutputPrice(_dirOfBase, _baseAssetAmount);
        //        //TODO quote asset amount limit
        //
        //        updateReserve(_dirOfBase, quoteAssetAmount, _baseAssetAmount, true);
        //        emit SwapOutput(_dirOfBase, quoteAssetAmount, _baseAssetAmount);
        //        return quoteAssetAmount;


        return 0;
    }

    function updateReserve(
        Dir _dirOfQuote,
        uint256 _quoteAssetAmount,
        uint256 _baseAssetAmount,
        bool _canOverFluctuationLimit
    ) internal {
        //Check if it is over fluctuationLimitRatio
        //        checkIsOverBlockFluctuationLimit(_dirOfQuote, _quoteAssetAmount, _baseAssetAmount);
        //
        //        if (_dirOfQuote == Dir.ADD_TO_AMM) {
        //            liquidityDetail.quoteReserveAmount = liquidityDetail.quoteReserveAmount.add(_quoteAssetAmount);
        //            liquidityDetail.baseReserveAmount = liquidityDetail.baseReserveAmount.sub(_baseAssetAmount);
        //            //TODO maybe have to update more variant
        //        } else {
        //            liquidityDetail.quoteReserveAmount = liquidityDetail.quoteReserveAmount.sub(_quoteAssetAmount);
        //            liquidityDetail.baseReserveAmount = liquidityDetail.baseReserveAmount.add(_baseAssetAmount);
        //            //TODO maybe have to update more variant
        //        }
    }

    function updateFundingRate(
        uint256 _premiumFraction,
        uint256 _underlyingPrice
    ) private {
        fundingRate = _premiumFraction.div(_underlyingPrice);
        emit FundingRateUpdated(fundingRate.toInt(), _underlyingPrice.toUint());
    }

    function getIsWaitingOrder(uint256 _tick, uint256 _index) public view returns (bool){

        return tickOrder[_tick].order[_index].status == Status.OPENING && tickOrder[_tick].filledIndex < _index;
    }

    function getReserve() external view returns (uint256, uint256){
        //        return (quoteReserve, baseReserve);
    }

    function getTotalPositionSize() public view override returns (uint256) {
        //        return totalPositionSize;
    }

    function settleFunding() public onlyOpen returns (uint256){

        require(_blockTimestamp >= nextFundingTime, Errors.A_AMM_SETTLE_TO_SOON);
        // premium = twapMarketPrice - twapIndexPrice
        // timeFraction = fundingPeriod(1 hour) / 1 day
        // premiumFraction = premium * timeFraction
        uint256 underlyingPrice = getUnderlyingTwapPrice(spotPriceTwapInterval);
        uint256 premium = getTwapPrice(spotPriceTwapInterval).sub(underlyingPrice);
        uint256 premiumFraction = premium.mul(fundingPeriod).div(int256(1 days));

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
        uint256 baseAssetDeltaThisFundingPeriod = 0;

        return premiumFraction;
    }

    /**
     * @notice get underlying price provided by oracle
     * @return underlying price
     */
    function getUnderlyingPrice() public view override returns (uint256) {
        //        return Decimal.decimal(priceFeed.getPrice(priceFeedKey));
    }

    /**
     * @notice get underlying twap price provided by oracle
     * @return underlying price
     */
    function getUnderlyingTwapPrice(uint256 _intervalInSeconds) public view returns (uint256) {
        //        return Decimal.decimal(priceFeed.getTwapPrice(priceFeedKey, _intervalInSeconds));
    }

    /**
     * @notice get spot price based on current quote/base asset reserve.
     * @return spot price
     */
    function getSpotPrice() public view override returns (uint256) {
        //        return quoteAssetReserve.divD(baseAssetReserve);
    }

    /**
     * @notice get twap price
     */
    function getTwapPrice(uint256 _intervalInSeconds) public view returns (uint256) {
        //        return implGetReserveTwapPrice(_intervalInSeconds);
    }

}