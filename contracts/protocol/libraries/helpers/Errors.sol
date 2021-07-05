// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;
/**
 * @title Errors library
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
    string public constant A_AMM_WAS_CLOSE= '81';
    string public constant A_AMM_IS_OPEN= '82';
    string public constant A_AMM_NOT_FOUND= '83';
    string public constant A_AMM_ALREADY_ADDED= '84';

    enum CollateralManagerErrors {
        NO_ERROR
    }
}
