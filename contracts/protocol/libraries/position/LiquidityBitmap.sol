// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;
import "hardhat/console.sol";

library LiquidityBitmap {
    uint256 public constant MAX_UINT256 = 115792089237316195423570985008687907853269984665640564039457584007913129639935;
    /// @notice Get the position in the mapping
    /// @param pip The bip index for computing the position
    /// @return mapIndex the index in the map
    /// @return bitPos the position in the bitmap
    function position(int128 pip) private pure returns (int16 mapIndex, uint8 bitPos) {
        mapIndex = int16(pip >> 8);
        bitPos = uint8(uint128(pip) & 0xff); // % 256
    }

    function hasLiquidity(
        mapping(int128 => uint256) storage self,
        int128 pip
    ) internal view returns (
        bool
    ) {
        (int16 mapIndex, uint8 bitPos) = position(pip);
        return (self[mapIndex] & 1 << bitPos) != 0;
    }

    /// @notice Set all bits in a given range
    /// @dev WARNING THIS FUNCTION IS NOT READY FOR PRODUCTION
    /// only use for generating test data purpose
    /// @param fromPip the pip to set from
    /// @param toPip the pip to set to
    function setBitsInRange(
        mapping(int128 => uint256) storage self,
        int128 fromPip,
        int128 toPip
    ) internal {
        (int16 fromMapIndex, uint8 fromBitPos) = position(fromPip);
        (int16 toMapIndex, uint8 toBitPos) = position(toPip);
        if(toMapIndex == fromMapIndex){
            // in the same storage
            // Set all the bits in given range of a number
            self[toMapIndex] |= (((1 << (fromBitPos - 1)) - 1) ^ ((1 << toBitPos) - 1));
        }else{
            // need to shift the map index
            // TODO fromMapIndex needs set separately
            for(int16 i = fromMapIndex; i < toMapIndex; i++){
                // pass uint256.MAX to avoid gas for computing
                self[i] = MAX_UINT256;
            }
            // set bits for the last index
            self[toMapIndex] = MAX_UINT256 >> (256 - toBitPos);
        }
    }

    function unsetBitsRange(
        mapping(int128 => uint256) storage self,
        int128 fromPip,
        int128 toPip
    ) internal {
        (int16 fromMapIndex, uint8 fromBitPos) = position(fromPip);
        (int16 toMapIndex, uint8 toBitPos) = position(toPip);
        if(toMapIndex == fromMapIndex){
            self[toMapIndex] &= toggleBitsFromLToR(MAX_UINT256, fromBitPos, toBitPos);
        }else{
            self[fromMapIndex] &= ~toggleLastMBits(MAX_UINT256, fromBitPos);
            for (int16 i = fromMapIndex+1; i < toMapIndex; i++){
                self[i] = 0;
            }
            self[toMapIndex] &= toggleLastMBits(MAX_UINT256, toBitPos);
        }
    }

    function toggleSingleBit(
        mapping(int128 => uint256) storage self,
        int128 pip,
        bool isSet
    ) internal {
        (int16 mapIndex, uint8 bitPos) = position(pip);
        if(isSet){
            self[mapIndex] |= 1 << bitPos;
        }else{
            self[mapIndex] &= ~(1 << bitPos);
        }
    }

    function toggleBitsFromLToR(uint256 n, uint8 l, uint8 r) private returns (uint256) {
        // calculating a number 'num'
        // having 'r' number of bits
        // and bits in the range l
        // to r are the only set bits
        uint256 num = ((1 << r) - 1) ^ ((1 << (l - 1)) - 1);

        // toggle the bits in the
        // range l to r in 'n'
        // and return the number
        return (n ^ num);
    }

    // Function to toggle the last m bits
    function toggleLastMBits(uint256 n, uint8 m) private returns (uint256)
    {

        // Calculating a number 'num' having
        // 'm' bits and all are set
        uint256 num = (1 << m) - 1;

        // Toggle the last m bits and
        // return the number
        return (n ^ num);
    }

}
