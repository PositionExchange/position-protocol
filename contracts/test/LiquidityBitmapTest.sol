// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "../protocol/libraries/position/LiquidityBitmap.sol";

contract LiquidityBitmapTest {
    using LiquidityBitmap for mapping(uint128 => uint256);
    mapping(uint128 => uint256) public liquidityBitmap;

    event GasUse(uint256 gas);

    function hasLiquidity(uint128 pip) public view returns (bool) {
        return liquidityBitmap.hasLiquidity(pip);
    }

    function setBitsInRange(uint128 startPip, uint128 toPip) public {
        liquidityBitmap.setBitsInRange(startPip, toPip);
    }

    function unsetBitsRange(uint128 startPip, uint128 toPip) public {
        liquidityBitmap.unsetBitsRange(startPip, toPip);
    }

    function toggleSingleBit(uint128 bit, bool isSet) public {
        liquidityBitmap.toggleSingleBit(bit, isSet);
    }

    function findNextInitializedLiquidity(uint128 pip, bool lte)
        public
        view
        returns (uint128 next)
    {
        next = liquidityBitmap.findHasLiquidityInOneWords(pip, lte);
    }

    function findHasLiquidityInMultipleWords(
        uint128 pip,
        uint128 maxWords,
        bool lte
    ) public view returns (uint128 next) {
        next = liquidityBitmap.findHasLiquidityInMultipleWords(
            pip,
            maxWords,
            lte
        );
    }
}
