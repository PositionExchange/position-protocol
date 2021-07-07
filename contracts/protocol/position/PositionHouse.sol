// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

import {Amm} from "./Amm.sol";
import {Errors} from "../libraries/helpers/Errors.sol";
import {BlockContext} from "../libraries/helpers/BlockContext.sol";
import {IPositionHouse} from "../../interfaces/IPositionHouse.sol";
import {IInsuranceFund} from  "../../interfaces/IInsuranceFund.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
/**
* @notice This contract is main of Position
* Manage positions with action like: openPostion, closePosition,... 
*/

//import {AMM} from
contract PositionHouse is IPositionHouse, BlockContext {
    using SafeMath for uint256;
    using Calc for uint256;

    // @notice enum
    enum Side  {BUY, SELL}
    enum TypeOrder  {MARKET, LIMIT, STOP_LIMIT}

    //Mapping
    struct AmmMap {
        // issue #1471
        // last block when it turn restriction mode on.
        // In restriction mode, no one can do multi open/close/liquidate position in the same block.
        // If any underwater position being closed (having a bad debt and make insuranceFund loss),
        // or any liquidation happened,
        // restriction mode is ON in that block and OFF(default) in the next block.
        // This design is to prevent the attacker being benefited from the multiple action in one block
        // in extreme cases
        uint256 lastRestrictionBlock;
        uint256[] cumulativePremiumFractions;
        mapping(address => Position) positionMap;
    }

    mapping(address => AmmMap) internal ammMap;
    // contract dependencies
    IInsuranceFund public insuranceFund;
    mapping(address => bool) whitelist;
    mapping(address => bool) blacklist;
    //    address[] whitelist;



    // struct
    struct Position {
        uint256 size;
        uint256 margin;
        uint256 openNotional;
        uint256 lastUpdatedCumulativePremiumFraction;
        uint256 liquidityHistoryIndex;
        uint256 blockNumber;
    }



    // event position house
    event MarginChanged(address indexed sender, address indexed amm, int256 amount, int256 fundingPayment);

    function addMargin(IAmm _amm, uint256 calldata _addedMargin) external whenNotPaused() nonReentrant() {
        // check condition
        requireAmm(_amm, true);
        requireNonZeroInput(_addedMargin);
        // update margin part in personal position
        address trader = _msgSender();
        Position memory position = adjustPositionForLiquidityChanged(_amm, trader);
        position.margin = position.margin.addD(_addedMargin);
        setPosition(_amm, trader, position);
        // transfer token from trader
        _transferFrom(_amm.quoteAsset(), trader, address(this), _addedMargin);
        emit MarginChanged(trader, address(_amm), int256(_addedMargin.toUint()), 0);
    }


    function openPosition(
        Amm _amm,
        Side _side,
        TypeOrder _typeOrder,
        uint256 _amountAssetQuote,
        uint256 _amountAssetBase,
        uint16 _leverage,
        uint256 _limitPrice,
        uint256 _stopPrice,
        uint256 _
    ) public {

        // TODO require something here
        require(
            _amountAssetBase != 0 &&
            _amountAssetQuote != 0,
            Errors.VL_INVALID_AMOUNT
        );

        address trader = msg.sender();


        //TODO open position
        if (_typeOrder == TypeOrder.MARKET) {
            openMarketOrder();

        } else if (_typeOrder == TypeOrder.LIMIT) {

            require(
                _limitPrice != 0,
                Errors.VL_INVALID_AMOUNT
            );
            openLimitOrder(_side, _);

        } else if (_typeOrder == TypeOrder.STOP_LIMIT) {
            // TODO open stop limit

            require(
                _limitPrice != 0 &&
                _stopPrice != 0,
                Errors.VL_INVALID_AMOUNT
            );
            openStopLimit();
        }


        // TODO handle open success, update position
        {

        }


    }

    function openLimitOrder(Side _side, uint256 _orderPrice, uint256 _limitPrice, uint256 _amountAssetQuote) public {

        // TODO require for openLimitOrder


        // size to trade
        uint256 remainSize = _amountAssetQuote.div(_orderPrice);
        // calc (get) currentPrice of amm
        uint256 currentPrice = calcCurrentPrice();

        while (remainSize != 0) {
            if (currentPrice < _orderPrice && _side == Side.BUY) {
                // tradableSize can trade for trader
                uint256 tradableSize = calcTradableSize(_side, _orderPrice, _limitPrice, remainSize);
                // TODO open partial
                //
                openPosition(tradableSize);
                // update remainSize
                remainSize = remainSize.sub(tradableSize);


            } else if (currentPrice > _orderPrice && _side == Side.SELL) {
                uint256 tradableSize = calcTradableSize(_side, _orderPrice, _limitPrice, remainSize);
                openPosition(tradableSize);
                remainSize = remainSize.sub(tradableSize);
            }
        }
    }


    function openStopLimit(Side _side, uint256 _orderPrice, uint256 _limitPrice, uint256 _stopPrice, uint256 _amountAssetQuote){


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

                // update remainSize
                remainSize = remainSize.sub(tradableSize);
            }
        }
    }

    // Mostly done calc formula limit order
    function calcTradableSize(Side _side, uint256 _orderPrice, uint256 _limitPrice, uint256 _remainSize) private returns (uint256) {


        // TODO calcCurrentPrice
        uint256 _currentPrice = calcCurrentPrice();
        uint256 amountQuoteReserve = getQuoteReserve();
        uint256 amountBaseReserve = getBaseReserve();

        uint256 priceAfterTrade = _orderPrice.pow(2).div(_currentPrice);
        if (priceAfterTrade.sub(_currentPrice).abs() > _limitPrice.sub(_currentPrice).abs()) {
            priceAfterTrade = _limitPrice;
        }

        uint256 amountQuoteReserveAfter = priceAfterTrade.sqrt().sub(_currentPrice.sqrt()).mul(liquidity.sqrt()).add(amountQuoteReserve);

        uint256 amountBaseReserveAfter = liquidity.div(amountQuoteReserveAfter);

        uint256 tradableSize = amountBaseReserve.sub(amountBaseReserveAfter).abs();

        if (_remainSize < tradableSize && _side == Side.BUY) {
            amountBaseReserveAfter = amountBaseReserve.sub(_remainSize);
            amountQuoteReserveAfter = amountQuoteReserve.add(_orderPrice.mul(_remainSize));
            setQuoteReserve(amountQuoteReserveAfter);
            setBaseReserve(amountBaseReserveAfter);
            return _remainSize;
        } else if (_remainSize < tradableSize && _side == Side.SELL) {
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

    function clearPosition(){


    }


    function removeMargin(Amm _amm, uint256 _amountRemoved){

    }


    function withdraw(
        IERC20 _token,
        address _receiver,
        uint256 memory _amount
    ) internal {
        // if withdraw amount is larger than entire balance of vault
        // means this trader's profit comes from other under collateral position's future loss
        // and the balance of entire vault is not enough
        // need money from IInsuranceFund to pay first, and record this prepaidBadDebt
        // in this case, insurance fund loss must be zero
        uint256 memory totalTokenBalance = _balanceOf(_token, address(this));
        if (totalTokenBalance.toUint() < _amount.toUint()) {
            uint256 memory balanceShortage = _amount.subD(totalTokenBalance);
            prepaidBadDebt[address(_token)] = prepaidBadDebt[address(_token)].addD(balanceShortage);
            insuranceFund.withdraw(_token, balanceShortage);
        }

        _transfer(_token, _receiver, _amount);
    }


    function payFunding(IAmm _amm) {
        requireAmm(_amm, true);
        uint256 memory premiumFraction = _amm.settleFunding();
        ammMap[address(_amm)].cumulativePremiumFractions.push(
            premiumFraction.add(getLatestCumulativePremiumFraction(_amm))
        );


        // funding payment = premium fraction * position
        // eg. if alice takes 10 long position, totalPositionSize = 10
        // if premiumFraction is positive: long pay short, amm get positive funding payment
        // if premiumFraction is negative: short pay long, amm get negative funding payment
        // if totalPositionSize.side * premiumFraction > 0, funding payment is positive which means profit
        uint256 memory totalTraderPositionSize = _amm.getTotalPositionSize();
        uint256 memory ammFundingPaymentProfit = premiumFraction.mul(totalTraderPositionSize);

        IERC20 quoteAsset = _amm.quoteAsset();
        if (ammFundingPaymentProfit.toInt() < 0) {
            insuranceFund.withdraw(quoteAsset, ammFundingPaymentProfit.abs());
        } else {
            transferToInsuranceFund(quoteAsset, ammFundingPaymentProfit.abs());
        }

    }

    function realizeBadDebt(IERC20 _token, uint256 memory _badDebt) internal {
        uint256 memory badDebtBalance = prepaidBadDebt[address(_token)];
        if (badDebtBalance.toUint() > _badDebt.toUint()) {
            // no need to move extra tokens because vault already prepay bad debt, only need to update the numbers
            prepaidBadDebt[address(_token)] = badDebtBalance.subD(_badDebt);
        } else {
            // in order to realize all the bad debt vault need extra tokens from insuranceFund
            insuranceFund.withdraw(_token, _badDebt.sub(badDebtBalance));
            prepaidBadDebt[address(_token)] = Decimal.zero();
        }
    }

    function transferToInsuranceFund(IERC20 _token, uint256 memory _amount) internal {
        uint256 memory totalTokenBalance = _balanceOf(_token, address(this));
        _transfer(
            _token,
            address(insuranceFund),
            totalTokenBalance.toUint() < _amount.toUint() ? totalTokenBalance : _amount
        );
    }


    function setWhitelist(address _address, bool isWhitelist) onlyOwner {
        whitelist[_address] = isWhitelist;
    }

    function setBlacklist(address _address, bool isBlacklist) onlyOwner {

        whitelist[_address] = isWhitelist;

    }

    function getWhitelist(address _address)  returns (bool) {

        return whitelist[_address];
    }

    function getBlacklist(address _address) returns (bool) {
        return blacklist[_address];
    }

    function requireNonZeroInput(uint256 memory _decimal) private pure {
        //!0: input is 0
        require(_decimal.toUint() != 0, Errors.VL_INVALID_AMOUNT);
    }


    /**
    * @notice get latest cumulative premium fraction.
    * @param _amm IAmm address
    * @return latest cumulative premium fraction in 18 digits
    */
    function getLatestCumulativePremiumFraction(IAmm _amm) public view returns (uint256 memory) {
        uint256 len = ammMap[address(_amm)].cumulativePremiumFractions.length;
        if (len > 0) {
            return ammMap[address(_amm)].cumulativePremiumFractions[len - 1];
        }
        return 0;
    }


    // require function
    function requireAmm(IAmm _amm, bool _open) private view {

        //405: amm not found
        //505: amm was closed
        //506: amm is open
        require(insuranceFund.isExistedAmm(_amm), "405");
        require(_open == _amm.open(), _open ? "505" : "506");
    }


}