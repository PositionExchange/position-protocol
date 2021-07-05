// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;
/**
*  @title This contract for each pair
* Function for Amm in here
*/
import {BlockContext} from "../libraries/helpers/BlockContext.sol";
import {SafeMath} from "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import {IAmm} from "../../interfaces/IAmm.sol";
import {IChainLinkPriceFeed} from "../../interfaces/IChainLinkPriceFeed.sol";
import {Errors} from "../libraries/helpers/Errors.sol";


contract Amm is IAmm, BlockContext {
    using SafeMath for uint256;

    // variable
    uint256 public spotPriceTwapInterval;
    uint256 fundingRate;

    // constants liquidity = baseReserve * quoteReserve

    mapping(address => uint) public balances;
    Slot0 public override slot0;
    bool public override open;
    uint256 public nextFundingTime;
    bytes32 public priceFeedKey;


    // enum
    enum Side {BUY, SELL}

    // Struct
    struct LimitOrder {
        // Type of order BUY or SELL
        Side side;
        // address of trader
        address trader;
        // leverage
        uint16 leverage;
        // limit price
        uint256 limitPrice;
        // amount of quote
        uint256 amountAssetQuote;
        // amount of base
        uint amountAssetBase;
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
        require(counterParty == _msgSender(), "caller is not counterParty");
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
        uint256 _spreadRatio

    ) public {

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


        priceFeedKey = _priceFeed;
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

    function openMarketOrder() public {


    }

    function openLimitOrder(address _trader, Side side, uint256 _orderPrice, uint256 _limitPrice, uint256 _amountAssetQuote) public {

        // TODO require for openLimitOrder


        // size to trade
        uint256 remainSize = _amountAssetQuote.div(_orderPrice);
        // calc (get) currentPrice of amm
        uint256 currentPrice = calcCurrentPrice();

        while (remainSize != 0) {
            if (currentPrice < _orderPrice && side == 0) {
                // tradableSize can trade for trader
                uint256 tradableSize = calcTradableSize(_side, _orderPrice, _limitPrice, remainSize);
                // TODO open partial
                //
                openPosition(tradableSize);
                // update remainSize
                remainSize = remainSize.sub(tradableSize);


            } else if (currentPrice > _orderPrice && side == 1) {
                uint256 tradableSize = calcTradableSize(_side, _orderPrice, _limitPrice, remainSize);
                openPosition(tradableSize);
                remainSize = remainSize.sub(tradableSize);
            }
        }
    }


    function openStopLimit(address _trader, Side side, uint256 _orderPrice, uint256 _limitPrice, uint256 _stopPrice, uint256 _amountAssetQuote){


        // TODO require for openStopLimit


        while (_stopPrice != currentPrice) {
            currentPrice = calcCurrentPrice();

        }

        uint256 currentPrice = calcCurrentPrice();
        uint256 remainSize = _amountAssetQuote.div(_orderPrice);


        while (remainSize != 0) {
            if (currentPrice < _orderPrice) {
                // tradableSize can trade for trader
                uint256 tradableSize = calcTradableSize(currentPrice, _orderPrice, _amountAssetQuote);
                // TODO open partial
                //

                // update remainSize
                remainSize = remainSize.sub(tradableSize);
            }
        }

    }

    function queryOrder() {

    }


    function setOpen(){


    }


    // Mostly done calc formula limit order
    function calcTradableSize(uint256 _side, uint256 _orderPrice, uint256 _limitPrice, uint256 _remainSize) public returns (uint256) {
        //
        uint256 _currentPrice = calcCurrentPrice();
        uint256 amountQuoteReserve = getQuoteReserve();
        uint256 amountBaseReserve = getBaseReserve();
        uint256 amountQuoteReserves = getQuoteReserves();
        uint256 amountBaseReserves = getBaseReserves();
        uint256 priceAfterTrade = _orderPrice.pow(2).div(_currentPrice);
        if (priceAfterTrade.sub(_currentPrice).abs() > _limitPrice.sub(_currentPrice).abs()) {
            priceAfterTrade = _limitPrice;
        }
        // const liquidity = amountQuoteReserve * amountBaseReserve

        uint256 amountQuoteReserveAfter = priceAfterTrade.sqrt().sub(_currentPrice.sqrt()).mul(liquidity.sqrt()).add(amountQuoteReserve);

        uint256 amountBaseReserveAfter = liquidity.div(amountQuoteReserveAfter);

        uint256 tradableSize = amountBaseReserve.sub(amountBaseReserveAfter).abs();

        if (_remainSize < tradableSize && _side == 0) {
            amountBaseReserveAfter = amountBaseReserve.sub(_remainSize);
            amountQuoteReserveAfter = amountQuoteReserve.add(_orderPrice.mul(_remainSize));
            setQuoteReserve(amountQuoteReserveAfter);
            setBaseReserve(amountBaseReserveAfter);

            return _remainSize;
        } else if (_remainSize < tradable && _side == 1) {
            amountBaseReserveAfter = amountBaseReserve.add(_remainSize);
            amountQuoteReserveAfter = amountQuoteReserve.sub(_orderPrice.mul(_remainSize));
            setQuoteReserve(amountQuoteReserveAfter);
            setBaseReserve(amountBaseReserveAfter);

            return _remainSize;
        }

        setQuoteReserve(amountQuoteReserveAfter);
        setBaseReserve(amountBaseReserveAfter);

        return tradableSize;

    }


    function settleFunding() external onlyOpen onlyCounterParty returns (uint256 memory){

        require(_blockTimestamp >= nextFundingTime, "settle to soon");

        return 0;

    }

    /**
     * @notice get underlying twap price provided by oracle
     * @return underlying price
     */
    function getUnderlyingTwapPrice(uint256 _intervalInSeconds) public view returns (uint256 memory) {
        return priceFeed.getTwapPrice(priceFeedKey, _intervalInSeconds);
    }


}