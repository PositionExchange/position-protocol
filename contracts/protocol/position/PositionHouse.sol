// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

import {Amm} from "./Amm.sol";
import {Errors} from "../libraries/helpers/Errors.sol";
import {BlockContext} from "../libraries/helpers/BlockContext.sol";
import {IPositionHouse} from "../../interfaces/IPositionHouse.sol";
import {IInsuranceFund} from  "../../interfaces/IInsuranceFund.sol";
/**
* @notice This contract is main of Position
* Manage positions with action like: openPostion, closePosition,... 
*/

//import {AMM} from
contract PositionHouse is IPositionHouse, BlockContext {

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
        uint256 _stopPrice
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
            _amm.openMarketOrder();

        } else if (_typeOrder == TypeOrder.LIMIT) {

            require(
                _limitPrice != 0,
                Errors.VL_INVALID_AMOUNT
            );
            _amm.openLimitOrder();

        } else if (_typeOrder == TypeOrder.STOP_LIMIT) {
            // TODO open stop limit

            require(
                _limitPrice != 0 &&
                _stopPrice != 0,
                Errors.VL_INVALID_AMOUNT
            );
        }


        // TODO handle open success, update position
        {

        }


    }

    function clearPosition(){


    }

    function addMargin(Amm _amm, uint256 _amountAdded){

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

    function realizeBadDebt(IERC20 _token, uint256 memory _badDebt) internal {
        uint256 memory badDebtBalance = prepaidBadDebt[address(_token)];
        if (badDebtBalance.toUint() > _badDebt.toUint()) {
            // no need to move extra tokens because vault already prepay bad debt, only need to update the numbers
            prepaidBadDebt[address(_token)] = badDebtBalance.subD(_badDebt);
        } else {
            // in order to realize all the bad debt vault need extra tokens from insuranceFund
            insuranceFund.withdraw(_token, _badDebt.subD(badDebtBalance));
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
    
    // require function
    function requireAmm(IAmm _amm, bool _open) private view {

        //405: amm not found
        //505: amm was closed
        //506: amm is open
        require(insuranceFund.isExistedAmm(_amm), "405");
        require(_open == _amm.open(), _open ? "505" : "506");
    }


}