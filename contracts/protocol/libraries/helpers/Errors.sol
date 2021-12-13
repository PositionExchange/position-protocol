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
    string public constant VL_INVALID_QUANTITY = '3'; // 'IQ'
    string public constant VL_INVALID_LEVERAGE = '4'; // 'IL'
    string public constant VL_INVALID_CLOSE_QUANTITY = '5'; // 'ICQ'
    string public constant VL_INVALID_CLAIM_FUND = '6'; // 'ICF'
    string public constant VL_NOT_ENOUGH_MARGIN_RATIO = '7'; // 'NEMR'
    string public constant VL_NO_POSITION_TO_REMOVE = '8'; // 'NPTR'
    string public constant VL_NO_POSITION_TO_ADD = '9'; // 'NPTA'
    string public constant VL_INVALID_QUANTITY_INTERNAL_CLOSE = '10'; // 'IQIC'
    string public constant VL_NOT_ENOUGH_LIQUIDITY = '11'; // 'NELQ'
    string public constant VL_INVALID_REMOVE_MARGIN = '12'; // 'IRM'
    string public constant VL_NOT_COUNTERPARTY = '13'; // 'IRM'



    enum CollateralManagerErrors {
        NO_ERROR
    }
}
