// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;
/**
* @notice This cointract keep money
*/
import {IAmm} from "../../interfaces/IAmm.sol";
import { IERC20 } from "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";
import {IInsuranceFund} from "../../interfaces/IInsuranceFund.sol";
import {Errors} from "../libraries/helpers/Errors.sol";

contract InsuranceFund is IInsuranceFund {

    mapping(address => bool) private ammMap;
    mapping(address => bool) private quoteTokenMap;
    IAmm[] private amms;
    IERC20[] public quoteTokens;




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
            uint256 memory currentPerpValue =
            exchange.getInputPrice(currentToken, perpToken, balanceOf(currentToken));

            for (uint256 j = i; j > 0; j--) {
                uint256 memory subsetPerpValue =
                exchange.getInputPrice(tokens[j - 1], perpToken, balanceOf(tokens[j - 1]));
                if (currentPerpValue.toUint() > subsetPerpValue.toUint()) {
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