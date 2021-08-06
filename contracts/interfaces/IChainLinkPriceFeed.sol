// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

interface IChainLinkPriceFeed {
    // get latest price
    function getPrice(bytes32 _priceFeedKey) external view returns (uint256);

    // get latest timestamp
    function getLatestTimestamp(bytes32 _priceFeedKey) external view returns (uint256);

    // get previous price with _back rounds
    function getPreviousPrice(bytes32 _priceFeedKey, uint256 _numOfRoundBack) external view returns (uint256);

    // get previous timestamp with _back rounds
    function getPreviousTimestamp(bytes32 _priceFeedKey, uint256 _numOfRoundBack) external view returns (uint256);

    // get twap price depending on _period
    function getTwapPrice(bytes32 _priceFeedKey, uint256 _interval) external view returns (uint256);

    function setLatestData(
        bytes32 _priceFeedKey,
        uint256 _price,
        uint256 _timestamp,
        uint256 _roundId
    ) external;

}
