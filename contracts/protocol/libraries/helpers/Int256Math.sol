pragma solidity >=0.8.0;

library Int256Math {
    /**
     * @dev Keeps positive side else return 0
     * @returns uint256 number
     */
    function kPositive(int256 self) internal pure returns (uint256) {
        return self > 0 ? self : 0;
    }

    function abs(int256 quantity) internal pure returns (uint256) {
        return uint256(quantity >= 0 ? quantity : -quantity);
    }

    function add(int256 a, int256 b) internal pure returns (int256) {
        unchecked {
            // don't worry about overflow here
            return a + b;
        }
    }
}
