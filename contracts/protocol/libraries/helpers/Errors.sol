// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;
/**
 * @title Errors libraries
 * @author Position Exchange
 * @notice Defines the error messages emitted by the different contracts of the Position Exchange protocol
 * @dev Error messages prefix glossary:
 *  - VL = ValidationLogic
 *  - MATH = Math libraries
 *  - CT = Common errors between tokens (AToken, VariableDebtToken and StableDebtToken)
 *  - P = Pausable
 *  - A = Amm
 */
library Errors {
    //common errors

    //contract specific errors
    string public constant VL_INVALID_AMOUNT = '1'; // 'Amount must be greater than 0'
    string public constant VL_EMPTY_ADDRESS = '2';
    string public constant VL_NOT_ENOUGH_HISTORY = '3';
    string public constant VL_NEGATIVE_PRICE = '4';// "Negative price"
    string public constant A_AMM_WAS_CLOSE= '81';
    string public constant A_AMM_IS_OPEN= '82';
    string public constant A_AMM_NOT_FOUND= '83';
    string public constant A_AMM_ALREADY_ADDED= '84';
    string public constant A_AMM_SETTLE_TO_SOON = '85';
    string public constant A_AMM_CALLER_IS_NOT_COUNTER_PARTY = '86';// caller is not counterParty

    enum CollateralManagerErrors {
        NO_ERROR
    }
}
