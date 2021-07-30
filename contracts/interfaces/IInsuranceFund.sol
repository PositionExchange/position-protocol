// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAmm} from "./a.sol";

interface IInsuranceFund {
    function withdraw(IERC20 _quoteToken, uint256  _amount) external;

    function isExistedAmm(IAmm _amm) external view returns (bool);

    function getAllAmms() external view returns (IAmm[] memory);
}
