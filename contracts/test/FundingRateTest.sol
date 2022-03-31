// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "../protocol/PositionManager.sol";

contract FundingRateTest is PositionManager {
    uint64 mockTime;
    uint64 blocknumber;

    function _now() internal view override returns (uint64) {
        return mockTime;
    }

    function setMockTime(uint64 _mockTime) public {
        mockTime = _mockTime;
    }

    function _blocknumber() internal view override returns (uint64) {
        return blocknumber;
    }

    function setBlockNumber(uint64 _blocknumber) public {
        blocknumber = _blocknumber;
    }

    function getUnderlyingTwapPrice(uint256 _intervalInSeconds)
    public
    view
    override
    returns (uint256)
    {
        return priceToWei(5000 * BASE_BASIC_POINT);
    }
}