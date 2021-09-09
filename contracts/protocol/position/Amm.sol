// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;
/**
*  @title This contract for each pair
* Function for Amm in here
*/
import {BlockContext} from "../libraries/helpers/BlockContext.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {SignedSafeMath} from "@openzeppelin/contracts/utils/math/SignedSafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAmm} from "../../interfaces/a.sol";
import {IChainLinkPriceFeed} from "../../interfaces/IChainLinkPriceFeed.sol";
import {Errors} from "../libraries/helpers/Errors.sol";
import {Calc} from "../libraries/math/Calc.sol";
import {PriceMath} from "../libraries/math/PriceMath.sol";
import {TickMath} from "../libraries/math/TickMath.sol";
import {TickBitmap} from "../libraries/math/TickBitmap.sol";
import {ComputeAmountMath} from "../libraries/math/ComputeAmountMath.sol";
import {Uint256ERC20} from "../libraries/helpers/Uint256ERC20.sol";
import {IInsuranceFund} from  "../../interfaces/IInsuranceFund.sol";

import "./PositionHouse.sol";
import "../libraries/amm/PositionLimit.sol";
import "../libraries/amm/Tick.sol";
import "./PositionHouse.sol";
//import "../../interfaces/IAmmState.sol";
import "hardhat/console.sol";

contract Amm is IAmm, BlockContext, Uint256ERC20 {
    using SafeMath for uint256;
    using SignedSafeMath for int256;
    using Calc for uint256;

    // variable
    uint256 public spotPriceTwapInterval;
    uint256 public fundingPeriod;
    uint256 public fundingBufferPeriod;
    uint256 fundingRate;
    uint256 constant toWei = 1000000000000000000;
    // only admin
    uint256 public maintenanceMarginRatio;
    // update during every swap and used when shutting amm down. it's trader's total base asset size
    IChainLinkPriceFeed public priceFeed;
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
    //    uint256[] cumulativePremiumFractions;
    // address _trader => Position
    mapping(address => Position[]) positionMap;

    uint256 public tollRatio;
    uint256 public spreadRatio;

    IInsuranceFund public insuranceFund;
    IMultiTokenRewardRecipient public feePool;



    /**
    * @notice event in amm
    * List event in amm
    */
    event SwapInput(Dir dir, uint256 quoteAssetAmount, uint256 baseAssetAmount);
    event SwapOutput(Dir dir, uint256 quoteAssetAmount, uint256 baseAssetAmount);
    event FundingRateUpdated(uint256 rate, uint256 underlyingPrice);
    event CancelOrder(int256 tick, uint256 index);
    event MarginRatioChanged(uint256 maintenanceMarginRatio);

    event OpenLimitOrder(int256 tick, uint256 index);
    event OpenMarketOrder(int256 tick, uint256 index);
    event AddMargin(address trader, uint256 amountAdded);

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


    // FUNCTION FOR TEST
    function testTickInitialize() public view returns (int256){
        return ammState.tick;

    }

    function testLiquidityInitialize() public view returns (LiquidityDetail memory, AmmState memory){
        return (liquidityDetail, ammState);

    }

    function queryPositions(address _trader) external override view returns (Position[] memory positions){
        positions = positionMap[_trader];

    }

    function getOrder(address _trader, int256 tick, uint256 index) external override view returns (Order memory order){
        order = tickOrder[tick].order[index];
    }
    // END FUNCTION FOR TEST

    function initialize(
        uint256 startPrice,
        uint256 _quoteAssetReserve,
        uint256 _baseAssetReserve,
        address _quoteAsset,
        uint256 _maintenanceMarginRatio,
        uint256 _tollRatio,
        uint256 _spreadRatio
    //        uint256 _tradeLimitRatio,
    //        uint256 _fundingPeriod,
    //        IChainLinkPriceFeed _priceFeed,
    //        bytes32 _priceFeedKey,
    //        uint256 _fluctuationLimitRatio,
    //        uint256 _tollRatio,
    //        uint256 _spreadRatio,
    //    uint256 startPrice

    ) public {

        require(
            _quoteAssetReserve != 0 &&
            _baseAssetReserve != 0 &&
            //            address(_priceFeed) != address(0) &&
            //            _tradeLimitRatio != 0 &&
            //            _fundingPeriod != 0 &&

            _quoteAsset != address(0) &&
            startPrice != 0,

            Errors.VL_INVALID_AMOUNT
        );

        spotPriceTwapInterval = 1 hours;

        tollRatio = _tollRatio;
        spreadRatio = _spreadRatio;


        liquidityDetail.baseReserveAmount = _baseAssetReserve;
        liquidityDetail.quoteReserveAmount = _quoteAssetReserve;
        liquidityDetail.liquidity = _baseAssetReserve.mul(_quoteAssetReserve);

        quoteAsset = IERC20(_quoteAsset);

        maintenanceMarginRatio = _maintenanceMarginRatio;
        // initialize tick
        int256 tick = TickMath.getTickAtPrice(startPrice);
        ammState = AmmState({
        price : startPrice,
        tick : tick,
        unlocked : true
        });
        //        spotPriceTwapInterval = 1 hours;
    }

    function getLiquidityDetail() internal view returns (uint256 liquidity, uint256 quoteReserveAmount, uint256 baseReserveAmount) {
        liquidity = liquidityDetail.liquidity;
        quoteReserveAmount = liquidityDetail.quoteReserveAmount;
        baseReserveAmount = liquidityDetail.baseReserveAmount;
    }

    // TODO: add only owner
    function setLiquidityDetail(uint256 quoteReserveAmount, uint256 baseReserveAmount) external {
        liquidityDetail.quoteReserveAmount = quoteReserveAmount;
        liquidityDetail.baseReserveAmount = baseReserveAmount;
        liquidityDetail.liquidity = quoteReserveAmount.mul(baseReserveAmount);
    }

    /**
     * @notice set maintenance margin ratio
     * @dev only owner can call
     * @param _maintenanceMarginRatio new maintenance margin ratio in 18 digits
     */
    //TODO add only owner
    function setMaintenanceMarginRatio(uint256 _maintenanceMarginRatio) external {
        maintenanceMarginRatio = _maintenanceMarginRatio;
        emit MarginRatioChanged(maintenanceMarginRatio);
    }


    function getPrice() external override view returns (uint256 price) {
        price = liquidityDetail.quoteReserveAmount.div(liquidityDetail.baseReserveAmount);

    }
    // margin =_amountAssetQuote / _leverage



    function openLimit(
        uint256 _amountAssetBase,
        uint256 _amountAssetQuote,
        uint256 _limitPrice,
        uint256 _margin,
        Side _side,
        int256 _tick,
        uint256 _leverage,
        address _trader) external override returns (uint256){

        // TODO require openLimit
        require(_amountAssetBase != 0 &&
            _amountAssetQuote != 0, "Require difference 0");


        // TODO calc liquidity added

        uint256 liquidityAdded = _amountAssetQuote.mul(_amountAssetBase);


        tickOrder[_tick].liquidity = tickOrder[_tick].liquidity.add(liquidityAdded);

        // NOTE check if current index has order or not
        uint256 nextIndex;
        if (tickOrder[_tick].currentIndex == 0) {
            nextIndex = tickOrder[_tick].currentIndex;
        } else {
            nextIndex = tickOrder[_tick].currentIndex.add(1);
        }

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
        status : Status.OPENING,
        timestamp : _blockTimestamp(),
        blockNumber : _blockNumber()
        });
        (int256 wordPos, uint256 bitPos) = TickBitmap.position(_tick);
        uint256 mask = 1 << bitPos;
        tickBitmap[wordPos] |= mask;

        _transferFrom(quoteAsset, _trader, address(this), _margin);
        transferFee(_trader, _amountAssetQuote);
        return nextIndex;

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
            console.log("in while");
            StepComputations memory step;
            step.priceStart = state.price;
            (step.tickNext, step.initialized) = TickBitmap.nextInitializedTickWithinOneWord(
                tickBitmap,
                state.tick,
            // true if buy, false if sell
                !sideBuy
            );
            console.log("initialized", step.initialized);
            // TODO update function getPriceAtTick in TickMath library
            // get price for the next tick
            step.priceNext = TickMath.getPriceAtTick(step.tickNext);
            console.log("step price next", step.priceNext);
            // TODO check function mostSignificantBit
            // TODO check if current tick is fulfill
            // if not try to fill all of the remaining amount then calculate next step
            // compute values to swap to the target tick or point where quote remaining amount is exhausted
            console.log("step price start", step.priceStart);
            (state.price, step.quoteCalculatedAmount, step.baseCalculatedAmount) = ComputeAmountMath.computeSwapStep(
                step.priceStart,
                step.priceNext,
                liquidity,
                state.quoteRemainingAmount
            );
            console.log("state price", state.price);
            state.quoteCalculatedAmount = state.quoteCalculatedAmount.add(step.quoteCalculatedAmount);
            state.quoteRemainingAmount = state.quoteRemainingAmount.sub(step.quoteCalculatedAmount);
            state.baseRemainingAmount = state.baseRemainingAmount.sub(step.baseCalculatedAmount);
            state.baseCalculatedAmount = state.baseCalculatedAmount.add(step.baseCalculatedAmount);

            updateReserve(step.quoteCalculatedAmount, step.baseCalculatedAmount, sideBuy);
            console.log("quote remaining", state.quoteRemainingAmount);
            console.log("step quote calculated", step.quoteCalculatedAmount);
            console.log("step base calculated", step.baseCalculatedAmount);

            // shift tick if we reached the next tick's price
            if (state.price == step.priceNext) {
                // if the tick is initialized, run the tick transition
                if (step.initialized) {
                    // NOTE unfilledLiquidity div toWei
                    uint256 unfilledLiquidity = ((tickOrder[step.tickNext].liquidity).div(toWei)).sub(tickOrder[step.tickNext].filledLiquidity);
                    uint256 remainingLiquidity = (state.quoteRemainingAmount.mul(state.baseRemainingAmount)).div(toWei);
                    console.log(283);
                    console.log("unfilledLiquidity", unfilledLiquidity);
                    console.log("remainingLiquidity", remainingLiquidity);
                    if (remainingLiquidity < unfilledLiquidity) {
                        console.log(291);
                        tickOrder[step.tickNext].filledLiquidity = tickOrder[step.tickNext].filledLiquidity.add(remainingLiquidity);

                        uint256 filledIndex = tickOrder[step.tickNext].filledIndex;
                        console.log("filledIndex", filledIndex);
                        console.log(288);
                        while (remainingLiquidity != 0) {
                            if (tickOrder[step.tickNext].order[filledIndex].status == Status.PARTIAL_FILLED) {
                                // TODO check if orderLiquidityRemain > remainingLiquidity
                                if (remainingLiquidity >= tickOrder[step.tickNext].order[filledIndex].orderLiquidityRemain) {
                                    remainingLiquidity.sub(tickOrder[step.tickNext].order[filledIndex].orderLiquidityRemain);
                                    filledIndex = filledIndex.add(1);
                                } else {
                                    (tickOrder[step.tickNext].order[filledIndex].orderLiquidityRemain).sub(remainingLiquidity);
                                }
                                console.log(295);
                            } else if (tickOrder[step.tickNext].order[filledIndex].status == Status.OPENING) {
                                console.log("remainingLiquidity", remainingLiquidity);
                                console.log("orderLiquidityRemain", tickOrder[step.tickNext].order[filledIndex].orderLiquidityRemain);
                                if (remainingLiquidity > tickOrder[step.tickNext].order[filledIndex].orderLiquidityRemain) {
                                    remainingLiquidity = remainingLiquidity.sub(tickOrder[step.tickNext].order[filledIndex].orderLiquidityRemain);
                                    filledIndex = filledIndex.add(1);
                                    console.log(303);
                                } else {
                                    tickOrder[step.tickNext].order[filledIndex].orderLiquidityRemain = tickOrder[step.tickNext].order[filledIndex].orderLiquidityRemain.sub(remainingLiquidity);
                                    tickOrder[step.tickNext].order[filledIndex].status = Status.PARTIAL_FILLED;
                                    remainingLiquidity = 0;

                                }
                                console.log(307);
                            }
                        }
                        console.log(308);
                        state.quoteCalculatedAmount = state.quoteCalculatedAmount.add(state.quoteRemainingAmount);
                        state.baseCalculatedAmount = state.baseCalculatedAmount.add(state.baseRemainingAmount);
                        (state.quoteRemainingAmount, state.baseRemainingAmount) = (0, 0);
                        console.log(312);
                        tickOrder[step.tickNext].filledIndex = filledIndex;
                        state.tick = step.tickNext;

                    } else {
                        console.log(327);
                        tickOrder[step.tickNext].filledLiquidity = tickOrder[step.tickNext].filledLiquidity.add(unfilledLiquidity);
                        console.log(329);
                        tickOrder[step.tickNext].filledIndex = tickOrder[step.tickNext].currentIndex;
                        console.log(331);
                        state.quoteCalculatedAmount = state.quoteCalculatedAmount.add(Calc.sqrt(unfilledLiquidity.mul(state.price)));
                        console.log(333);
                        state.quoteRemainingAmount = state.quoteRemainingAmount.sub(Calc.sqrt(unfilledLiquidity.mul(state.price)));
                        console.log(335);
                        state.baseRemainingAmount = state.baseRemainingAmount.sub(Calc.sqrt(unfilledLiquidity.div(state.price)));
                        console.log(337);
                        state.baseCalculatedAmount = state.baseCalculatedAmount.add(Calc.sqrt(unfilledLiquidity.div(state.price)));
                        // TODO calculate remaining amount after fulfill this tick's liquidity
                        console.log(340);
                        state.tick = step.tickNext;
                        (int256 wordPos, uint256 bitPos) = TickBitmap.position(state.tick);
                        uint256 mask = 1 << bitPos;
                        tickBitmap[wordPos] ^= mask;
                        console.log(326);
                    }

                }
                state.tick = step.tickNext;
            } else if (state.price != step.priceNext) {
                state.tick = TickMath.getTickAtPrice(state.price);
                console.log("calculated tick", uint256(state.tick));
            }
            console.log("tick after 1 while", uint256(state.tick));
        }
        console.log(337);
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
            console.log(357);

        } else {
            console.log(360);
            // TODO decrement position
            if (paramsOpenMarket.margin > positionMarketMap[paramsOpenMarket._trader].margin) {
                // open reserve position
                if (position.side == Side.BUY) {
                    positionMarketMap[paramsOpenMarket._trader].side = Side.SELL;

                } else {
                    positionMarketMap[paramsOpenMarket._trader].side = Side.SELL;
                }

            }
            console.log(372);
            positionMarketMap[paramsOpenMarket._trader].margin = paramsOpenMarket.margin.sub(positionMarketMap[paramsOpenMarket._trader].margin);
            console.log(373);
            positionMarketMap[paramsOpenMarket._trader].amountAssetQuote = positionMarketMap[paramsOpenMarket._trader].amountAssetQuote.add(paramsOpenMarket.quoteAmount);
            positionMarketMap[paramsOpenMarket._trader].amountAssetBase = positionMarketMap[paramsOpenMarket._trader].amountAssetBase.add(paramsOpenMarket.baseAmount);
            console.log(374);
        }
        ammState.unlocked = true;
        transferFee(paramsOpenMarket._trader, paramsOpenMarket.quoteAmount);
        console.log("final liquidity", liquidityDetail.liquidity);
    }

    function cancelOrder(address _trader, uint256 _index, int256 _tick) external override {
        require(_index > tickOrder[_tick].filledIndex, 'Require not filled open yet');

        tickOrder[_tick].liquidity = tickOrder[_tick].liquidity.sub(tickOrder[_tick].order[_index].amountLiquidity);
        tickOrder[_tick].order[_index].status = Status.CANCEL;

        uint256 amountToRefund = tickOrder[_tick].order[_index].margin;

        for (uint256 i = 0; i < positionMap[_trader].length; i++) {

            if (positionMap[_trader][i].index == _index) {
                positionMap[_trader][i] = positionMap[_trader][positionMap[_trader].length - 1];
                positionMap[_trader].pop();
                break;

            }
        }

        withdraw(quoteAsset, _trader, amountToRefund);


        emit CancelOrder(_tick, _index);
    }


    function cancelAllOrder(address _trader) external override {


        uint256 amountToRefund;

        for (uint256 i = 0; i < positionMap[_trader].length; i++) {

            if (positionMap[_trader][i].index > tickOrder[positionMap[_trader][i].tick].filledIndex) {

                int256 _tick = positionMap[_trader][i].tick;
                uint256 _index = positionMap[_trader][i].index;

                tickOrder[_tick].liquidity = tickOrder[_tick].liquidity.sub(tickOrder[_tick].order[_index].amountLiquidity);
                tickOrder[_tick].order[_index].status = Status.CANCEL;

                amountToRefund = amountToRefund.add(tickOrder[_tick].order[_index].margin);

                positionMap[_trader][i] = positionMap[_trader][positionMap[_trader].length - 1];
                positionMap[_trader].pop();

            }
        }
        withdraw(quoteAsset, _trader, amountToRefund);

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
        // TODO calc PnL, transfer money
        //

        uint256 i = positionMap[_trader].length.sub(1);

        while (i != 0) {

            int256 tickOrder = positionMap[_trader][i].tick;
            uint256 indexOrder = positionMap[_trader][i].index;

            if (getIsWaitingOrder(tickOrder, indexOrder) == false) {

                if (i == positionMap[_trader].length - 1) {

                    positionMap[_trader].pop();

                } else {
                    positionMap[_trader][i] = positionMap[_trader][positionMap[_trader].length - 1];
                    positionMap[_trader].pop();
                }
            }

            i = i.sub(1);

        }

        positionMarketMap[_trader] = PositionOpenMarket({
        side : Side.BUY,
        leverage : 0,
        amountAssetQuote : 0,
        amountAssetBase : 0,
        margin : 0});

    }


    function removeMargin(address _trader, uint256 _amountRemoved) external override {
        require(
            _amountRemoved != 0,
            Errors.VL_INVALID_AMOUNT
        );
        // TODO removeMargin, calc
        //        tickOrder[tick].order[index].margin = tickOrder[tick].order[index].margin.sub(_amountRemoved);

        withdraw(quoteAsset, _trader, _amountRemoved);
    }


    function addMargin(address _trader, uint256 _amountAdded) external override {
        require(
            _amountAdded != 0,
            Errors.VL_INVALID_AMOUNT
        );
        // TODO addMargin, calc

        require(positionMap[_trader].length > 0, "Require have position");

        Position memory _position = positionMap[_trader][0];

        tickOrder[_position.tick].order[_position.index].margin = tickOrder[_position.tick].order[_position.index].margin.add(_amountAdded);

        _transferFrom(quoteAsset, _trader, address(this), _amountAdded);
        //TODO transfer amount
        emit AddMargin(_trader, _amountAdded);

    }

    function getPnL(address _trader) external view override returns (int256) {
        //        requireAmm(_amm, true);
        uint256 price = liquidityDetail.quoteReserveAmount.div(liquidityDetail.baseReserveAmount);

        return 0;
    }

    function getMarginRatio(PositionResponse memory positionResponse) external view returns (uint256) {

        return 0;
    }
    /**
   * @notice calculate total fee (including toll and spread) by input quoteAssetAmount
   * @param _quoteAssetAmount quoteAssetAmount
   * @return total tx fee
   */
    function calcFee(uint256 _quoteAssetAmount)
    internal
    view
    returns (uint256, uint256)
    {
        if (_quoteAssetAmount == 0) {
            return (0, 0);
        }
        return (_quoteAssetAmount.mul(tollRatio), _quoteAssetAmount.mul(spreadRatio));
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

    function getPosition(address _trader) external view override returns (PositionResponse memory positionResponse){

        PositionOpenMarket memory positionMarket = positionMarketMap[_trader];

        PositionResponse memory positionResponseLong;
        PositionResponse memory positionResponseShort;

        uint256 leverage;
        uint256 maxIndex;

        for (uint256 i = 0; i < positionMap[_trader].length; i++) {
            int256 tick = positionMap[_trader][i].tick;
            uint256 index = positionMap[_trader][i].index;
            if (index < tickOrder[tick].filledIndex) {

                if (index > maxIndex) {
                    leverage = tickOrder[tick].order[index].leverage;
                    maxIndex = index;
                }
                if (tickOrder[tick].order[index].side == Side.BUY) {
                    positionResponseLong.baseAmount = positionResponseLong.baseAmount.add(tickOrder[tick].order[index].amountAssetBase);
                    positionResponseLong.baseAmount = positionResponseLong.quoteAmount.add(tickOrder[tick].order[index].amountAssetQuote);
                    positionResponseLong.margin = positionResponseLong.margin.add(tickOrder[tick].order[index].margin);
                } else if (tickOrder[tick].order[index].side == Side.SELL) {
                    positionResponseShort.baseAmount = positionResponseShort.baseAmount.add(tickOrder[tick].order[index].amountAssetBase);
                    positionResponseShort.baseAmount = positionResponseShort.quoteAmount.add(tickOrder[tick].order[index].amountAssetQuote);
                    positionResponseLong.margin = positionResponseShort.margin.add(tickOrder[tick].order[index].margin);
                }

            }

        }

        //TODO get calc


    }

    //TODO Add test
    function getPositionInOrder(address _trader) external view override returns (Order[] memory listOrder){
        uint256 counter = 0;

        for (uint256 i = 0; i < positionMap[_trader].length; i++) {

            int256 tick = positionMap[_trader][i].tick;
            uint256 index = positionMap[_trader][i].index;
            if (index > tickOrder[tick].filledIndex) {
                listOrder[counter] = tickOrder[tick].order[index];
                counter++;

            } else if (index == tickOrder[tick].filledIndex) {
                listOrder[counter] = tickOrder[tick].order[index];
                listOrder[counter].status = Status.PARTIAL_FILLED;
                counter++;
            }
        }

    }

    // TODO modify function
    function withdraw(
        IERC20 _token,
        address _receiver,
        uint256 _amount
    ) internal {
        // if withdraw amount is larger than entire balance of vault
        // means this trader's profit comes from other under collateral position's future loss
        // and the balance of entire vault is not enough
        // need money from IInsuranceFund to pay first, and record this prepaidBadDebt
        // in this case, insurance fund loss must be zero
        uint256 totalTokenBalance = _balanceOf(_token, address(this));
        // TODO calc prepaidBadDebt
        //        if (totalTokenBalance.toUint() < _amount.toUint()) {
        //            uint256 memory balanceShortage = _amount.subD(totalTokenBalance);
        //            prepaidBadDebt[address(_token)] = prepaidBadDebt[address(_token)].addD(balanceShortage);
        //            insuranceFund.withdraw(_token, balanceShortage);
        //        }

        _transfer(_token, _receiver, _amount);
    }


    function getIsWaitingOrder(int256 _tick, uint256 _index) public view returns (bool)
    {
        return tickOrder[_tick].order[_index].status == Status.OPENING && tickOrder[_tick].filledIndex < _index;
    }

    function getIsOrderExecuted(int256 _tick, uint256 _index) external view override returns (bool) {

        if (_index > tickOrder[_tick].filledIndex) {
            return false;
        }
        return true;
    }

    function getReserve() external view override returns (uint256 quoteReserveAmount, uint256 baseReserveAmount){

        quoteReserveAmount = liquidityDetail.quoteReserveAmount;
        baseReserveAmount = liquidityDetail.baseReserveAmount;
    }


    function getCurrentTick() external view override returns (int256) {
        return ammState.tick;
    }

    function settleFunding() internal view returns (int256){
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
    // TODO modify function
    function payFunding() external override {

        int256 premiumFraction = settleFunding();

        //        address(_amm).cumulativePremiumFractions.push(
        //            premiumFraction.add(getLatestCumulativePremiumFraction(_amm))
        //        );


        // funding payment = premium fraction * position
        // eg. if alice takes 10 long position, totalPositionSize = 10
        // if premiumFraction is positive: long pay short, amm get positive funding payment
        // if premiumFraction is negative: short pay long, amm get negative funding payment
        // if totalPositionSize.side * premiumFraction > 0, funding payment is positive which means profit
        int256 totalTraderPositionSize = getTotalPositionSize();
        int256 ammFundingPaymentProfit = premiumFraction.mul(totalTraderPositionSize);

        //        IERC20 quoteAsset = _amm.quoteAsset();
        if (ammFundingPaymentProfit < 0) {
            insuranceFund.withdraw(quoteAsset, Calc.abs(ammFundingPaymentProfit));
        } else {
            transferToInsuranceFund(quoteAsset, Calc.abs(ammFundingPaymentProfit));
        }

    }

    function getTotalPositionSize() internal view returns (int256){
        return 0;
    }
    // TODO modify function
    function transferToInsuranceFund(IERC20 _token, uint256 _amount) internal {
        uint256 totalTokenBalance = _balanceOf(_token, address(this));
        _transfer(
            _token,
            address(insuranceFund),
            totalTokenBalance < _amount ? totalTokenBalance : _amount
        );
    }

    function transferFee(
        address _trader,
        uint256 _amountAssetQuote
    ) internal returns (uint256) {
        (uint256 toll,uint256 spread) = calcFee(_amountAssetQuote);
        bool hasToll = toll > 0;
        bool hasSpread = spread > 0;
        if (hasToll || hasSpread) {
            //            IERC20 quoteAsset = _amm.quoteAsset();

            // transfer spread to insurance fund
            if (hasSpread) {
                _transferFrom(quoteAsset, _trader, address(insuranceFund), spread);
            }

            // transfer toll to feePool
            if (hasToll) {
                require(address(feePool) != address(0), "Invalid feePool");
                _transferFrom(quoteAsset, _trader, address(feePool), toll);
            }

            // fee = spread + toll
            return toll.add(spread);
        }
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
        return priceFeed.getPrice(priceFeedKey);
    }

    /**
     * @notice get underlying twap price provided by oracle
     * @return underlying price
     */
    function getUnderlyingTwapPrice(uint256 _intervalInSeconds) public view returns (uint256) {
        return priceFeed.getTwapPrice(priceFeedKey, _intervalInSeconds);
        //        return 0;
    }

    /**
     * @notice get twap price
     */
    function getTwapPrice(uint256 _intervalInSeconds) public view returns (uint256) {
        //                return implGetReserveTwapPrice(_intervalInSeconds);
        return 0;
    }

}