// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;
pragma experimental ABIEncoderV2;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMinter {
    function mintReward() external;

    function mintForLoss(uint256 _amount) external;

    function getPosiToken() external view returns (IERC20);
}
