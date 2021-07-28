// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;
/**
* @notice This cointract keep money
*/
import {IAmm} from "../../interfaces/IAmm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IInsuranceFund} from "../../interfaces/IInsuranceFund.sol";
import {Errors} from "../libraries/helpers/Errors.sol";

contract InsuranceFund is IInsuranceFund {

    mapping(address => bool) private ammMap;
    mapping(address => bool) private quoteTokenMap;
    IAmm[] private amms;
    IERC20[] public quoteTokens;
    IERC20 public posiToken;




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
    function withdraw(IERC20 _quoteToken, uint256 calldata _amount) external override {
        require(beneficiary == _msgSender(), "caller is not beneficiary");
        require(isQuoteTokenExisted(_quoteToken), "Asset is not supported");

        uint256 memory quoteBalance = balanceOf(_quoteToken);
        if (_amount.toUint() > quoteBalance.toUint()) {
            uint256 memory insufficientAmount = _amount.sub(quoteBalance);
            swapEnoughQuoteAmount(_quoteToken, insufficientAmount);
            quoteBalance = balanceOf(_quoteToken);
        }
        require(quoteBalance.toUint() >= _amount.toUint(), "Fund not enough");

        _transfer(_quoteToken, _msgSender(), _amount);

        emit Withdrawn(_msgSender(), _amount.toUint());
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

    function getOrderedQuoteTokens(IERC20 _exceptionQuoteToken) internal view returns (IERC20[] memory orderedTokens) {
        IERC20[] memory tokens = quoteTokens;
        // insertion sort
        for (uint256 i = 0; i < getQuoteTokenLength(); i++) {
            IERC20 currentToken = quoteTokens[i];
            uint256 memory currentPosiValue =
            exchange.getInputPrice(currentToken, posiToken, balanceOf(currentToken));

            for (uint256 j = i; j > 0; j--) {
                uint256 memory subsetPosiValue =
                exchange.getInputPrice(tokens[j - 1], posiToken, balanceOf(tokens[j - 1]));
                if (currentPosiValue.toUint() > subsetPosiValue.toUint()) {
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

    function balanceOf(IERC20 _quoteToken) internal view returns (Decimal.decimal memory) {
        return _balanceOf(_quoteToken, address(this));
    }


}