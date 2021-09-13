pragma solidity ^0.8.0;

import './BitMath.sol';

/// @title Packed tick initialized state libraries
/// @notice Stores a packed mapping of tick index to its initialized state
/// @dev The mapping uses int16 for keys since ticks are represented as int24 and there are 256 (2^8) values per word.
library TickStore {

}
