pragma solidity ^0.8.0;

import "../protocol/libraries/position/LiquidityBitmap.sol";

contract LiquidityBitmapTest {
    using LiquidityBitmap for mapping(int128 => uint256);
    mapping(int128 => uint256) public liquidityBitmap;
    event GasUse(uint256 gas);

    function hasLiquidity(
        int128 pip
    ) public view returns (bool) {
        return liquidityBitmap.hasLiquidity(pip);
    }

    function setBitsInRange(
        int128 startPip,
        int128 toPip
    ) public {
        liquidityBitmap.setBitsInRange(startPip, toPip);
    }
    function unsetBitsRange(
        int128 startPip,
        int128 toPip
    ) public {
        liquidityBitmap.unsetBitsRange(startPip, toPip);
    }
    function toggleSingleBit(
        int128 bit,
        bool isSet
    ) public {
        liquidityBitmap.toggleSingleBit(bit, isSet);
    }


}
