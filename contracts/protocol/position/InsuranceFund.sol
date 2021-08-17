// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;
/**
* @notice This cointract keep money
*/
import {IAmm} from "../../interfaces/a.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IInsuranceFund} from "../../interfaces/IInsuranceFund.sol";
import {IExchangeWrapper} from "../../interfaces/IExchangeWrapper.sol";
import {IMinter} from "../../interfaces/IMinter.sol";
import {Errors} from "../libraries/helpers/Errors.sol";
import {PosiFiOwnableUpgrade} from "../libraries/helpers/PosiFiOwnableUpgrade.sol";
import {Uint256ERC20} from "../libraries/helpers/Uint256ERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";


contract InsuranceFund is IInsuranceFund, PosiFiOwnableUpgrade, Uint256ERC20 {
    using SafeMath for uint256;


    mapping(address => bool) private ammMap;
    mapping(address => bool) private quoteTokenMap;
    IAmm[] private amms;
    IERC20[] public quoteTokens;

    // contract dependencies
    IExchangeWrapper public exchange;
    IMinter public minter;
    IERC20 public posiToken;
    address private beneficiary;


    //
    // EVENTS
    //

    event Withdrawn(address withdrawer, uint256 amount);
    event TokenAdded(address tokenAddress);
    event TokenRemoved(address tokenAddress);
    event ShutdownAllAmms(uint256 blockNumber);
    event AmmAdded(address amm);
    event AmmRemoved(address amm);




    /**
     * @dev only owner can call
     * @param _amm IAmm address
     */
    function addAmm(IAmm _amm) public onlyOwner {
        require(!isExistedAmm(_amm), Errors.A_AMM_ALREADY_ADDED);
        ammMap[address(_amm)] = true;
        amms.push(_amm);
        emit AmmAdded(address(_amm));

        // add token if it's new one
        IERC20 token = _amm.quoteAsset();
        if (!isQuoteTokenExisted(token)) {
            quoteTokens.push(token);
            quoteTokenMap[address(token)] = true;
            emit TokenAdded(address(token));
        }
    }

    /**
    * @notice withdraw token to caller
    * @param _amount the amount of quoteToken caller want to withdraw
    */
    function withdraw(IERC20 _quoteToken, uint256 _amount) external override {
        require(beneficiary == _msgSender(), "caller is not beneficiary");
        require(isQuoteTokenExisted(_quoteToken), "Asset is not supported");

        uint256 quoteBalance = balanceOf(_quoteToken);
        if (_amount > quoteBalance) {
            uint256 insufficientAmount = _amount.sub(quoteBalance);
            swapEnoughQuoteAmount(_quoteToken, insufficientAmount);
            quoteBalance = balanceOf(_quoteToken);
        }
        require(quoteBalance >= _amount, "Fund not enough");

        _transfer(_quoteToken, _msgSender(), _amount);

        emit Withdrawn(_msgSender(), _amount);
    }

    function swapEnoughQuoteAmount(IERC20 _quoteToken, uint256 _requiredQuoteAmount) internal {
        IERC20[] memory orderedTokens = getOrderedQuoteTokens(_quoteToken);
        for (uint256 i = 0; i < orderedTokens.length; i++) {
            // get how many amount of quote token i is still required
            uint256 swappedQuoteToken;
            uint256 otherQuoteRequiredAmount =
            exchange.getOutputPrice(orderedTokens[i], _quoteToken, _requiredQuoteAmount);

            // if balance of token i can afford the left debt, swap and return
            if (otherQuoteRequiredAmount <= balanceOf(orderedTokens[i])) {
                swappedQuoteToken = swapInput(orderedTokens[i], _quoteToken, otherQuoteRequiredAmount, 0);
                return;
            }

            // if balance of token i can't afford the left debt, show hand and move to the next one
            swappedQuoteToken = swapInput(orderedTokens[i], _quoteToken, balanceOf(orderedTokens[i]), 0);
            _requiredQuoteAmount = _requiredQuoteAmount.sub(swappedQuoteToken);
        }

        // if all the quote tokens can't afford the debt, ask staking token to mint
        if (_requiredQuoteAmount > 0) {
            uint256 requiredPerpAmount =
            exchange.getOutputPrice(posiToken, _quoteToken, _requiredQuoteAmount);
            minter.mintForLoss(requiredPerpAmount);
            swapInput(posiToken, _quoteToken, requiredPerpAmount, 0);
        }
    }

    function swapInput(
        IERC20 inputToken,
        IERC20 outputToken,
        uint256 inputTokenSold,
        uint256 minOutputTokenBought
    ) internal returns (uint256 received) {
        if (inputTokenSold == 0) {
            return 0;
        }
        _approve(inputToken, address(exchange), inputTokenSold);
        received = exchange.swapInput(inputToken, outputToken, inputTokenSold, minOutputTokenBought, 0);
        require(received > 0, "Exchange swap error");
    }


    //
    // VIEW
    //
    function isExistedAmm(IAmm _amm) public view override returns (bool) {
        return ammMap[address(_amm)];
    }

    function getAllAmms() external view override returns (IAmm[] memory) {
        return amms;
    }

    function isQuoteTokenExisted(IERC20 _token) internal view returns (bool) {
        return quoteTokenMap[address(_token)];
    }

    function getOrderedQuoteTokens(IERC20 _exceptionQuoteToken) internal view returns (IERC20[]  memory orderedTokens) {
        IERC20[] memory tokens = quoteTokens;
        // insertion sort
        for (uint256 i = 0; i < getQuoteTokenLength(); i++) {
            IERC20 currentToken = quoteTokens[i];
            uint256 currentPosiValue =
            exchange.getInputPrice(currentToken, posiToken, balanceOf(currentToken));

            for (uint256 j = i; j > 0; j--) {
                uint256 subsetPosiValue =
                exchange.getInputPrice(tokens[j - 1], posiToken, balanceOf(tokens[j - 1]));
                if (currentPosiValue > subsetPosiValue) {
                    tokens[j] = tokens[j - 1];
                    tokens[j - 1] = currentToken;
                }
            }
        }

        orderedTokens = new IERC20[](tokens.length - 1);
        uint256 j;
        for (uint256 i = 0; i < tokens.length; i++) {
            // jump to the next token
            if (tokens[i] == _exceptionQuoteToken) {
                continue;
            }
            orderedTokens[j] = tokens[i];
            j++;
        }
    }


    function balanceOf(IERC20 _quoteToken) internal view returns (uint256) {

        //        return _balanceOf(_quoteToken, address(this));
        return 0;
    }

    function getQuoteTokenLength() public view returns (uint256) {
        return quoteTokens.length;
    }


    //SETTER
    function setExchange(IExchangeWrapper _exchange) external onlyOwner {
        exchange = _exchange;
    }

    function setMinter(IMinter _minter) public onlyOwner {
        minter = _minter;
        posiToken = minter.getPosiToken();
    }


}