// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

import './BitMath.sol';
import "hardhat/console.sol";

/*
@title Packed tick initialized state library
The mapping uses int16 for keys since ticks are represented as int24
and there are 256 (2^8) values per word mean each word (key) contain 256 value
**/

library TickBitmap {
    /*
    @notice Computes the position in the mapping where the initialized bit for a tick lives
    @param tick The tick for which to compute the position
    @return wordPos The key in the mapping containing the word in which the bit is stored
    @return bitPos The bit position in the word where the flag is stored
    **/
    function position(int256 tick) internal pure returns (int256 wordPos, uint256 bitPos) {
        wordPos = int256(tick >> 8);
        bitPos = uint256(tick % 256);
    }
    /*
    @notice Flips the initialized state for a given tick from false to true, or vice versa
    @param self The mapping in which to flip the tick
    @param tick The tick to flip
    @param tickSpacing The spacing between usable ticks == 1
    **/
    function flipTick(
        mapping(int256 => uint256) storage self,
        int256 tick
    ) internal {
        require(tick == 0); // ensure that the tick is spaced
        (int256 wordPos, uint256 bitPos) = position(tick);
        uint256 mask = 1 << bitPos;
        self[wordPos] ^= mask;
    }
    /*
    @notice Returns the next initialized tick contained in the same word (or adjacent word) as the tick that is either
    to the left (less than or equal to) or right (greater than) of the given tick
    @param self The mapping in which to compute the next initialized tick
    @param tick The starting tick
    @param tickSpacing The spacing between usable ticks
    @param lte Whether to search for the next initialized tick to the left (less than or equal to the starting tick)
    @return next The next initialized or uninitialized tick up to 256 ticks away from the current tick
    @return initialized Whether the next tick is initialized, as the function only searches within up to 256 ticks
    **/
    function nextInitializedTickWithinOneWord(
        mapping(int256 => uint256) storage self,
        int256 tick,
        bool lte
    ) internal view returns (int256 next, bool initialized) {
        int256 compressed = tick ;
        console.log("next initialized tick beginning", uint256(tick));
        if (tick < 0 && tick != 0) compressed--; // round towards negative infinity
        console.log("compressed / 256", uint256(compressed / 256));
        console.log("compressed % 256", uint256(compressed % 256));
        if (compressed % 256 == 0 && self[int256(compressed / 256)] % 2 == 0 && lte) {
            compressed -= 1;
            console.log("compressed - 1");
        } else if (compressed % 256 == 255 && self[int256(compressed / 256)] >> 255 == 0 && !lte) {
            compressed += 1;
            console.log("compressed + 1");
        }

        if (lte) {
            (int256 wordPos, uint256 bitPos) = position(compressed);
            // all the 1s at or to the right of the current bitPos
            uint256 mask = (1 << bitPos) - 1 + (1 << bitPos);
            uint256 masked = self[wordPos] & mask;

            // if there are no initialized ticks to the right of or at the current tick, return rightmost in the word
            initialized = masked != 0;
            next = initialized
            ? (compressed - int256(bitPos - BitMath.mostSignificantBit(masked)))
            : (compressed - int256(bitPos)) ;
        } else {
            // start from the word of the next tick, since the current tick state doesn't matter
            (int256 wordPos, uint256 bitPos) = position(compressed);
            // all the 1s at or to the left of the bitPos
            uint256 mask = ~((1 << bitPos) - 1);
            uint256 masked = self[wordPos] & mask;

            // if there are no initialized ticks to the left of the current tick, return leftmost in the word
            initialized = masked != 0;
            next = initialized
            ? (compressed + int256(uint256(BitMath.leastSignificantBit(masked)) - bitPos))
            : (compressed + int256(uint256(type(uint8).max) - bitPos)) ;
        }
        console.log("tick next", uint256(next));
    }
}
