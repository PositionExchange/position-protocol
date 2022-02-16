// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.8.0;

library Int256Math {

    /**
     * @dev Keeps positive side else return 0
     */
    function kPositive(int256 self) internal pure returns (int256) {
        return self > 0 ? self : int256(0);
    }

    function add(int256 a, int256 b) internal pure returns (int256) {
        unchecked {
            // don't worry about overflow here
            return a + b;
        }
    }
}
