// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "../protocol/InsuranceFund.sol";

contract InsuranceFundTest is InsuranceFund {

    function setCreditAddress(address _address) public {
        posiCredit = IERC20Upgradeable(_address);
    }
}