pragma solidity >=0.8.0;

library Quantity {
    function getExchangedQuoteAssetAmount(
        int256 quantity,
        uint256 openNotional,
        uint256 oldPQuantity
    ) internal pure returns (uint256) {
        return (abs(quantity) * openNotional) / oldPQuantity;
    }

    function getPartiallyLiquidate(
        int256 _quantity,
        uint256 _liquidationPenaltyRatio
    ) internal pure returns (int256) {
        return (_quantity * int256(_liquidationPenaltyRatio)) / 100;
    }

    function isSameSide(int256 qA, int256 qB) internal pure returns (bool) {
        return qA * qB > 0;
    }

    function u8Side(int256 quantity) internal pure returns (uint8) {
        return quantity > 0 ? 1 : 2;
    }

    function abs128(int256 quantity) internal pure returns (uint128) {
        return uint128(abs(quantity));
    }

    function sumWithUint256(int256 a, uint256 b)
        internal
        pure
        returns (int256)
    {
        return a >= 0 ? a + int256(b) : a - int256(b);
    }

    function minusWithUint256(int256 a, uint256 b)
        internal
        pure
        returns (int256)
    {
        return a >= 0 ? a - int256(b) : a + int256(b);
    }
}
