// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "../protocol/InsuranceFund.sol";

contract InsuranceFundTest is InsuranceFund {

    function setBonusAddress(address _address) public {
        busdBonus = IERC20Upgradeable(_address);
    }

    function setBonusBalance(address _pm, address _trader, uint256 _amount) public {
        busdBonusBalances[_trader][_pm] = _amount;
    }
}