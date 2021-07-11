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
import {SqrtPriceMath} from "../libraries/math/SqrtPriceMath.sol";
import "./PositionHouse.sol";
import "../libraries/amm/PositionLimit.sol";
import "../libraries/amm/Tick.sol";

contract Amm is IAmm, BlockContext {
    using SafeMath for uint256;
    using Calc for uint256;

    // variable
    uint256 public spotPriceTwapInterval;
    uint256 fundingRate;
    uint256 tradeLimitRatio;
    uint256 baseReserve;
    uint256 quoteReserve;
    // update during every swap and used when shutting amm down. it's trader's total base asset size
    uint256 public totalPositionSize;
    IChainLinkPriceFeed public priceFeed;

    // constants liquidity = baseReserve * quoteReserve

    /// @inheritdoc IUniswapV3PoolState
    mapping(int24 => Tick.Info) public override ticks;
    /// @inheritdoc IUniswapV3PoolState
    mapping(int16 => uint256) public override tickBitmap;
    /// @inheritdoc IUniswapV3PoolState
    mapping(bytes32 => PositionLimit.Info) public override positions;
    /// @inheritdoc IUniswapV3PoolState
    Oracle.Observation[65535] public override observations;

    mapping(address => uint) public balances;
    Slot0 public override slot0;
    bool public override open;
    uint256 public nextFundingTime;
    bytes32 public priceFeedKey;


    // Struct
    //    struct LimitOrder {
    //        // Type of order BUY or SELL
    //        Side side;
    //        // address of trader
    //        address trader;
    //        // leverage
    //        uint16 leverage;
    //        // limit price
    //        uint256 limitPrice;
    //        // amount of quote
    //        uint256 amountAssetQuote;
    //        // amount of base
    //        uint amountAssetBase;
    //    }


    struct ModifyPositionParams {
        // the address that owns the position
        address trader;
        // tick
        int24 tick;
        // any change in liquidity
        int128 liquidityDelta;
    }


    struct Slot0 {
        // the current price
        uint160 sqrtPriceX96;
        // the current tick
        int24 tick;
        // the most-recently updated index of the observations array
        uint16 observationIndex;
        // the current maximum number of observations that are being stored
        uint16 observationCardinality;
        // the next maximum number of observations to store, triggered in observations.write
        uint16 observationCardinalityNext;
        // the current protocol fee as a percentage of the swap fee taken on withdrawal
        // represented as an integer denominator (1/x)%
        uint8 feeProtocol;
        // whether the pool is locked
        bool unlocked;
    }

    /**
    * @notice event in amm
    * List event in amm
    */
    event SwapInput(Dir dir, uint256 quoteAssetAmount, uint256 baseAssetAmount);
    event SwapOutput(Dir dir, uint256 quoteAssetAmount, uint256 baseAssetAmount);
    event FundingRateUpdated(int256 rate, uint256 underlyingPrice);

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

        // initialize tick
        int24 tick = TickMath.getTickAtSqrtRatio(sqrtPriceX96);
        slot0 = Slot0({
        sqrtPriceX96 : sqrtPriceX96,
        tick : tick,
        observationIndex : 0,
        observationCardinality : cardinality,
        observationCardinalityNext : cardinalityNext,
        feeProtocol : 0,
        unlocked : true
        });


        spotPriceTwapInterval = 1 hours;
        setQuoteReserve(_quoteAssetReserve);
        setBaseReserve(_baseAssetReserve);
        priceFeedKey = _priceFeedKey;
        priceFeed = _priceFeed;
    }

    function mint(
        address recipient,
        int24 tick,
        uint128 amount,
        bytes calldata data
    ) external override lock returns (uint256 amount0, uint256 amount1) {
        require(amount > 0);
        (, int256 amount0Int, int256 amount1Int) =
        _modifyPosition(
            ModifyPositionParams({
        owner : recipient,
        tick : tick,
        liquidityDelta : int256(amount).toInt128()}));

        amount0 = uint256(amount0Int);
        amount1 = uint256(amount1Int);

        uint256 balance0Before;
        uint256 balance1Before;
        if (amount0 > 0) balance0Before = balance0();
        if (amount1 > 0) balance1Before = balance1();
        // TODO mint callback function
        if (amount0 > 0) require(balance0Before.add(amount0) <= balance0(), 'M0');
        if (amount1 > 0) require(balance1Before.add(amount1) <= balance1(), 'M1');

        emit Mint(msg.sender, recipient, tickLower, tickUpper, amount, amount0, amount1);
    }

    /// @dev Effect some changes to a position
    /// @param params the position details and the change to the position's liquidity to effect
    /// @return position a storage pointer referencing the position with the given owner and tick range
    /// @return amount0 the amount of token0 owed to the pool, negative if the pool should pay the recipient
    /// @return amount1 the amount of token1 owed to the pool, negative if the pool should pay the recipient
    function _modifyPosition(ModifyPositionParams memory params) private noDelegateCall
    returns (
        PositionLimit.Info storage position,
        int256 amount0,
        int256 amount1
    ){
        checkTicks(params.tickLower, params.tickUpper);

        Slot0 memory _slot0 = slot0;
        // SLOAD for gas optimization

        position = _updatePosition(
            params.owner,
            params.tickLower,
            params.tickUpper,
            params.liquidityDelta,
            _slot0.tick
        );

        if (params.liquidityDelta != 0) {
            if (_slot0.tick < params.tickLower) {
                // current tick is below the passed range; liquidity can only become in range by crossing from left to
                // right, when we'll need _more_ token0 (it's becoming more valuable) so user must provide it
                amount0 = SqrtPriceMath.getAmount0Delta(
                    TickMath.getSqrtRatioAtTick(params.tickLower),
                    TickMath.getSqrtRatioAtTick(params.tickUpper),
                    params.liquidityDelta
                );
            } else if (_slot0.tick < params.tickUpper) {
                // current tick is inside the passed range
                uint128 liquidityBefore = liquidity;
                // SLOAD for gas optimization

                // write an oracle entry
                (slot0.observationIndex, slot0.observationCardinality) = observations.write(
                    _slot0.observationIndex,
                    _blockTimestamp(),
                    _slot0.tick,
                    liquidityBefore,
                    _slot0.observationCardinality,
                    _slot0.observationCardinalityNext
                );

                amount0 = SqrtPriceMath.getAmount0Delta(
                    _slot0.sqrtPriceX96,
                    TickMath.getSqrtRatioAtTick(params.tickUpper),
                    params.liquidityDelta
                );
                amount1 = SqrtPriceMath.getAmount1Delta(
                    TickMath.getSqrtRatioAtTick(params.tickLower),
                    _slot0.sqrtPriceX96,
                    params.liquidityDelta
                );

                liquidity = LiquidityMath.addDelta(liquidityBefore, params.liquidityDelta);
            } else {
                // current tick is above the passed range; liquidity can only become in range by crossing from right to
                // left, when we'll need _more_ token1 (it's becoming more valuable) so user must provide it
                amount1 = SqrtPriceMath.getAmount1Delta(
                    TickMath.getSqrtRatioAtTick(params.tickLower),
                    TickMath.getSqrtRatioAtTick(params.tickUpper),
                    params.liquidityDelta
                );
            }
        }
    }

    /// @dev Gets and updates a position with the given liquidity delta
    /// @param owner the owner of the position
    /// @param tickLower the lower tick of the position's tick range
    /// @param tickUpper the upper tick of the position's tick range
    /// @param tick the current tick, passed to avoid sloads
    function _updatePosition(
        address owner,
    //        int24 tickLower,
        int24 tick,
        int128 liquidityDelta,
        int24 currentTick
    ) private returns (PositionLimit.Info storage position) {
        position = positions.get(owner, tickLower, tick);

        uint256 _feeGrowthGlobal0X128 = feeGrowthGlobal0X128;
        // SLOAD for gas optimization
        uint256 _feeGrowthGlobal1X128 = feeGrowthGlobal1X128;
        // SLOAD for gas optimization

        // if we need to update the ticks, do it
        bool flippedLower;
        bool flippedUpper;
        if (liquidityDelta != 0) {
            uint32 time = _blockTimestamp();
            (int56 tickCumulative, uint160 secondsPerLiquidityCumulativeX128) =
            observations.observeSingle(
                time,
                0,
                slot0.tick,
                slot0.observationIndex,
                liquidity,
                slot0.observationCardinality
            );

            //            flippedLower = ticks.update(
            //                tickLower,
            //                currentTick,
            //                liquidityDelta,
            //                _feeGrowthGlobal0X128,
            //                _feeGrowthGlobal1X128,
            //                secondsPerLiquidityCumulativeX128,
            //                tickCumulative,
            //                time,
            //                false,
            //                maxLiquidityPerTick
            //            );
            //            flippedUpper = ticks.update(
            //                tickUpper,
            //                currentTick,
            //                liquidityDelta,
            //                _feeGrowthGlobal0X128,
            //                _feeGrowthGlobal1X128,
            //                secondsPerLiquidityCumulativeX128,
            //                tickCumulative,
            //                time,
            //                true,
            //                maxLiquidityPerTick
            //            );


            flipped = ticks.update(
                tick,
                currentTick,
                liquidityDelta,
                _feeGrowthGlobal0X128,
                _feeGrowthGlobal1X128,
                secondsPerLiquidityCumulativeX128,
                tickCumulative,
                time,
                true,
                maxLiquidityPerTick
            );

            if (flippedLower) {
                tickBitmap.flipTick(tickLower, tickSpacing);
            }
            if (flippedUpper) {
                tickBitmap.flipTick(tickUpper, tickSpacing);
            }
        }
//
//        (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128) =
//        ticks.getFeeGrowthInside(tickLower, tickUpper, tick, _feeGrowthGlobal0X128, _feeGrowthGlobal1X128);

        position.update(liquidityDelta, feeGrowthInside0X128, feeGrowthInside1X128);
        position.update(liquidityDelta);

        // clear any tick data that is no longer needed
        if (liquidityDelta < 0) {
            if (flippedLower) {
                ticks.clear(tickLower);
            }
            if (flippedUpper) {
                ticks.clear(tickUpper);
            }
        }
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
            quoteReserve = quoteReserve.add(_quoteAssetAmount);
            baseReserve = baseReserve.sub(_baseAssetAmount);
            //TODO maybe have to update more variant
        } else {
            quoteReserve = quoteReserve.sub(_quoteAssetAmount);
            baseReserve = baseReserve.add(_baseAssetAmount);
            //TODO maybe have to update more variant
        }
    }

    function getReserve() external view returns (uint256 memory, uint256 memory){
        return (quoteReserve, baseReserve);
    }
    // @notice get balance of trader
    // return balance in wei
    function getBalance(address _trader) public view returns (uint256) {
        return balances[_trader];
    }

    function transfer(address sender, address receiver, uint amountAssetQuote) public {
        require(amount <= balances[sender], 'not enough money');
        balances[sender].sub(amount);
        balances[receiver].add(amount);
        emit Sent(sender, receiver, amount);
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
        uint256 memory premiumFraction = premium.mulScalar(fundingPeriod).div(int256(1 days));

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
     * @notice get underlying twap price provided by oracle
     * @return underlying price
     */
    function getUnderlyingTwapPrice(uint256 _intervalInSeconds) public view returns (uint256 memory) {
        return priceFeed.getTwapPrice(priceFeedKey, _intervalInSeconds);
    }

}