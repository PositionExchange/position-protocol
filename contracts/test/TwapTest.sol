// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "../protocol/libraries/position/Twap.sol";

import "hardhat/console.sol";

contract TwapTest {
    using Twap for Twap.Observation[65535];

    Twap.Observation[65535] public observations;

    uint32 public time;
    uint128 public pip;
    uint16 public index;
    uint16 public cardinality;
    uint16 public cardinalityNext;

    struct InitializeParams {
        uint32 time;
        uint128 pip;
    }

    function initialize(InitializeParams calldata params) external {
        require(cardinality == 0, "already initialized");
        time = params.time;
        pip = params.pip;
        (cardinality, cardinalityNext) = observations.initialize(params.time);
    }

    function advanceTime(uint32 by) public {
        time += by;
    }

    struct UpdateParams {
        uint32 advanceTimeBy;
        uint128 pip;
    }

    // write an observation, then change pip and liquidity
    function update(UpdateParams calldata params) external {
        advanceTime(params.advanceTimeBy);
        console.log("index before %s", index);
        console.log("time %s", time);

        (index, cardinality) = observations.write(
            index,
            time,
            pip,
            cardinality,
            cardinalityNext
        );
        console.log("index after %s", index);

        console.log("cardinality %s", cardinality);

        pip = params.pip;
    }

    function batchUpdate(UpdateParams[] calldata params) external {
        // sload everything
        uint128 _pip = pip;
        uint16 _index = index;
        uint16 _cardinality = cardinality;
        uint16 _cardinalityNext = cardinalityNext;
        uint32 _time = time;

        for (uint256 i = 0; i < params.length; i++) {
            _time += params[i].advanceTimeBy;
            (_index, _cardinality) = observations.write(
                _index,
                _time,
                _pip,
                _cardinality,
                _cardinalityNext
            );
            _pip = params[i].pip;
        }

        // sstore everything
        pip = _pip;
        index = _index;
        cardinality = _cardinality;
        time = _time;
    }

    function grow(uint16 _cardinalityNext) external {
        cardinalityNext = observations.grow(cardinalityNext, _cardinalityNext);
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (uint128[] memory pipCumulatives)
    {
        //        console.log("time ")
        return observations.observe(time, secondsAgos, pip, index, cardinality);
    }

    function getGasCostOfObserve(uint32[] calldata secondsAgos)
        external
        view
        returns (uint256)
    {
        (uint32 _time, uint128 _pip, uint16 _index) = (time, pip, index);
        uint256 gasBefore = gasleft();
        observations.observe(_time, secondsAgos, _pip, _index, cardinality);
        return gasBefore - gasleft();
    }
}
