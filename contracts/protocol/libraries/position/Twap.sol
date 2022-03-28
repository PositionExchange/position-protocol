// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

/// @title Twap
/// @notice Provides price and liquidity data useful for a wide variety of system designs
/// @dev Instances of stored twap data, "observations", are collected in the twap array
/// Every pool is initialized with an twap array length of 1. Anyone can pay the SSTOREs to increase the
/// maximum length of the twap array. New slots will be added when the array is fully populated.
/// Observations are overwritten when the full length of the twap array is populated.
/// The most recent observation is available, independent of the length of the twap array, by passing 0 to observe()
library Twap {
    struct Observation {
        // the block timestamp of the observation
        uint32 blockTimestamp;
        // the pip accumulator, i.e. pip * time elapsed since the pool was first initialized
        uint128 pipCumulative;
        // the seconds per liquidity, i.e. seconds elapsed / max(1, liquidity) since the pool was first initialized
        // whether or not the observation is initialized
        bool initialized;
    }

    /// @notice Transforms a previous observation into a new observation, given the passage of time and the current pip value
    /// @dev blockTimestamp _must_ be chronologically equal to or greater than last.blockTimestamp, safe for 0 or 1 overflows
    /// @param _last The specified observation to be transformed
    /// @param _blockTimestamp The timestamp of the new observation
    /// @param _pip The active pip at the time of the new observation
    /// @return Observation The newly populated observation
    function transform(
        Observation memory _last,
        uint32 _blockTimestamp,
        uint128 _pip
    ) private pure returns (Observation memory) {
        uint32 delta = _blockTimestamp - _last.blockTimestamp;

        return
            Observation({
                blockTimestamp: _blockTimestamp,
                pipCumulative: _last.pipCumulative + uint128(_pip) * delta,
                initialized: true
            });
    }

    /// @notice Initialize the twap array by writing the first slot. Called once for the lifecycle of the observations array
    /// @param _self The stored twap array
    /// @param _time The time of the twap initialization, via block.timestamp truncated to uint32
    /// @return cardinality The number of populated elements in the twap array
    /// @return cardinalityNext The new length of the twap array, independent of population
    function initialize(Observation[65535] storage _self, uint32 _time)
        internal
        returns (uint16 cardinality, uint16 cardinalityNext)
    {
        _self[0] = Observation({
            blockTimestamp: _time,
            pipCumulative: 0,
            initialized: true
        });
        return (1, 1);
    }

    /// @notice Writes an twap observation to the array
    /// @dev Writable at most once per block. Index represents the most recently written element. cardinality and index must be tracked externally.
    /// If the index is at the end of the allowable array length (according to cardinality), and the next cardinality
    /// is greater than the current one, cardinality may be increased. This restriction is created to preserve ordering.
    /// @param _self The stored twap array
    /// @param _index The index of the observation that was most recently written to the observations array
    /// @param _blockTimestamp The timestamp of the new observation
    /// @param _pip The active pip at the time of the new observation
    /// @param _cardinality The number of populated elements in the twap array
    /// @param _cardinalityNext The new length of the twap array, independent of population
    /// @return indexUpdated The new index of the most recently written element in the twap array
    /// @return cardinalityUpdated The new cardinality of the twap array
    function write(
        Observation[65535] storage _self,
        uint16 _index,
        uint32 _blockTimestamp,
        uint128 _pip,
        uint16 _cardinality,
        uint16 _cardinalityNext
    ) internal returns (uint16 indexUpdated, uint16 cardinalityUpdated) {
        Observation memory last = _self[_index];

        // early return if we've already written an observation this block
        if (last.blockTimestamp == _blockTimestamp)
            return (_index, _cardinality);

        // if the conditions are right, we can bump the cardinality
        if (_cardinalityNext > _cardinality && _index == (_cardinality - 1)) {
            cardinalityUpdated = _cardinalityNext;
        } else {
            cardinalityUpdated = _cardinality;
        }

        indexUpdated = (_index + 1) % cardinalityUpdated;
        _self[indexUpdated] = transform(last, _blockTimestamp, _pip);
    }

    /// @notice Prepares the twap array to store up to `next` observations
    /// @param _self The stored twap array
    /// @param _current The current next cardinality of the twap array
    /// @param _next The proposed next cardinality which will be populated in the twap array
    /// @return next The next cardinality which will be populated in the twap array
    function grow(
        Observation[65535] storage _self,
        uint16 _current,
        uint16 _next
    ) internal returns (uint16) {
        require(_current > 0, "I");
        // no-op if the passed next value isn't greater than the current next value
        if (_next <= _current) return _current;
        // store in each slot to prevent fresh SSTOREs in swaps
        // this data will not be used because the initialized boolean is still false
        for (uint16 i = _current; i < _next; i++) _self[i].blockTimestamp = 1;
        return _next;
    }

    /// @notice comparator for 32-bit timestamps
    /// @dev safe for 0 or 1 overflows, a and b _must_ be chronologically before or equal to time
    /// @param _time A timestamp truncated to 32 bits
    /// @param _a A comparison timestamp from which to determine the relative position of `time`
    /// @param _b From which to determine the relative position of `time`
    /// @return bool Whether `a` is chronologically <= `b`
    function lte(
        uint32 _time,
        uint32 _a,
        uint32 _b
    ) private pure returns (bool) {
        // if there hasn't been overflow, no need to adjust
        if (_a <= _time && _b <= _time) return _a <= _b;

        uint256 aAdjusted = _a > _time ? _a : _a + 2**32;
        uint256 bAdjusted = _b > _time ? _b : _b + 2**32;

        return aAdjusted <= bAdjusted;
    }

    /// @notice Fetches the observations beforeOrAt and atOrAfter a target, i.e. where [beforeOrAt, atOrAfter] is satisfied.
    /// The result may be the same observation, or adjacent observations.
    /// @dev The answer must be contained in the array, used when the target is located within the stored observation
    /// boundaries: older than the most recent observation and younger, or the same age as, the oldest observation
    /// @param _self The stored twap array
    /// @param _time The current block.timestamp
    /// @param _target The timestamp at which the reserved observation should be for
    /// @param _index The index of the observation that was most recently written to the observations array
    /// @param _cardinality The number of populated elements in the twap array
    /// @return beforeOrAt The observation recorded before, or at, the target
    /// @return atOrAfter The observation recorded at, or after, the target
    function binarySearch(
        Observation[65535] storage _self,
        uint32 _time,
        uint32 _target,
        uint16 _index,
        uint16 _cardinality
    )
        private
        view
        returns (Observation memory beforeOrAt, Observation memory atOrAfter)
    {
        uint256 l = (_index + 1) % _cardinality;
        // oldest observation
        uint256 r = l + _cardinality - 1;
        // newest observation
        uint256 i;
        while (true) {
            i = (l + r) / 2;

            beforeOrAt = _self[i % _cardinality];

            // we've landed on an uninitialized pip, keep searching higher (more recently)
            if (!beforeOrAt.initialized) {
                l = i + 1;
                continue;
            }

            atOrAfter = _self[(i + 1) % _cardinality];

            bool targetAtOrAfter = lte(
                _time,
                beforeOrAt.blockTimestamp,
                _target
            );

            // check if we've found the answer!
            if (
                targetAtOrAfter && lte(_time, _target, atOrAfter.blockTimestamp)
            ) break;

            if (!targetAtOrAfter) r = i - 1;
            else l = i + 1;
        }
    }

    /// @notice Fetches the observations beforeOrAt and atOrAfter a given target, i.e. where [beforeOrAt, atOrAfter] is satisfied
    /// @dev Assumes there is at least 1 initialized observation.
    /// Used by observeSingle() to compute the counterfactual accumulator values as of a given block timestamp.
    /// @param _self The stored twap array
    /// @param _time The current block.timestamp
    /// @param _target The timestamp at which the reserved observation should be for
    /// @param _pip The active pip at the time of the returned or simulated observation
    /// @param _index The index of the observation that was most recently written to the observations array
    /// @param _cardinality The number of populated elements in the twap array
    /// @return beforeOrAt The observation which occurred at, or before, the given timestamp
    /// @return atOrAfter The observation which occurred at, or after, the given timestamp
    function getSurroundingObservations(
        Observation[65535] storage _self,
        uint32 _time,
        uint32 _target,
        uint128 _pip,
        uint16 _index,
        uint16 _cardinality
    )
        private
        view
        returns (Observation memory beforeOrAt, Observation memory atOrAfter)
    {
        // optimistically set before to the newest observation
        beforeOrAt = _self[_index];

        // if the target is chronologically at or after the newest observation, we can early return
        if (lte(_time, beforeOrAt.blockTimestamp, _target)) {
            if (beforeOrAt.blockTimestamp == _target) {
                // if newest observation equals target, we're in the same block, so we can ignore atOrAfter
                return (beforeOrAt, atOrAfter);
            } else {
                // otherwise, we need to transform
                return (beforeOrAt, transform(beforeOrAt, _target, _pip));
            }
        }

        // now, set before to the oldest observation
        beforeOrAt = _self[(_index + 1) % _cardinality];
        if (!beforeOrAt.initialized) beforeOrAt = _self[0];

        // ensure that the target is chronologically at or after the oldest observation
        require(lte(_time, beforeOrAt.blockTimestamp, _target), "OLD");

        // if we've reached this point, we have to binary search
        return binarySearch(_self, _time, _target, _index, _cardinality);
    }

    /// @dev Reverts if an observation at or before the desired observation timestamp does not exist.
    /// 0 may be passed as `secondsAgo' to return the current cumulative values.
    /// If called with a timestamp falling between two observations, returns the counterfactual accumulator values
    /// at exactly the timestamp between the two observations.
    /// @param _self The stored twap array
    /// @param _time The current block timestamp
    /// @param _secondsAgo The amount of time to look back, in seconds, at which point to return an observation
    /// @param _pip The current pip
    /// @param _index The index of the observation that was most recently written to the observations array
    /// @param _cardinality The number of populated elements in the twap array
    /// @return pipCumulative The pip * time elapsed since the pool was first initialized, as of `secondsAgo`
    function observeSingle(
        Observation[65535] storage _self,
        uint32 _time,
        uint32 _secondsAgo,
        uint128 _pip,
        uint16 _index,
        uint16 _cardinality
    ) internal view returns (uint128 pipCumulative) {
        if (_secondsAgo == 0) {
            Observation memory last = _self[_index];
            if (last.blockTimestamp != _time)
                last = transform(last, _time, _pip);
            return (last.pipCumulative);
        }

        uint32 target = _time - _secondsAgo;

        (
            Observation memory beforeOrAt,
            Observation memory atOrAfter
        ) = getSurroundingObservations(
                _self,
                _time,
                target,
                _pip,
                _index,
                _cardinality
            );

        if (target == beforeOrAt.blockTimestamp) {
            // we're at the left boundary
            return (beforeOrAt.pipCumulative);
        } else if (target == atOrAfter.blockTimestamp) {
            // we're at the right boundary
            return (atOrAfter.pipCumulative);
        } else {
            // we're in the middle
            uint32 observationTimeDelta = atOrAfter.blockTimestamp -
                beforeOrAt.blockTimestamp;
            uint32 targetDelta = target - beforeOrAt.blockTimestamp;
            return (beforeOrAt.pipCumulative +
                ((atOrAfter.pipCumulative - beforeOrAt.pipCumulative) /
                    observationTimeDelta) *
                targetDelta);
        }
    }

    /// @notice Returns the accumulator values as of each time seconds ago from the given time in the array of `secondsAgos`
    /// @dev Reverts if `secondsAgos` > oldest observation
    /// @param _self The stored twap array
    /// @param _time The current block.timestamp
    /// @param _secondsAgos Each amount of time to look back, in seconds, at which point to return an observation
    /// @param _pip The current pip
    /// @param _index The index of the observation that was most recently written to the observations array
    /// @param _cardinality The number of populated elements in the twap array
    /// @return pipCumulatives The pip * time elapsed since the pool was first initialized, as of each `secondsAgo`
    function observe(
        Observation[65535] storage _self,
        uint32 _time,
        uint32[] memory _secondsAgos,
        uint128 _pip,
        uint16 _index,
        uint16 _cardinality
    ) internal view returns (uint128[] memory pipCumulatives) {
        require(_cardinality > 0, "I");

        pipCumulatives = new uint128[](_secondsAgos.length);
        for (uint256 i = 0; i < _secondsAgos.length; i++) {
            (pipCumulatives[i]) = observeSingle(
                _self,
                _time,
                _secondsAgos[i],
                _pip,
                _index,
                _cardinality
            );
        }
    }
}
