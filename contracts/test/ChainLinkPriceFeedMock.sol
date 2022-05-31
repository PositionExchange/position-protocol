// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;
import "../protocol/ChainLinkPriceFeed.sol";
contract ChainLinkPriceFeedMock is ChainLinkPriceFeed {
    mapping (bytes32 => uint256) public mockIndexPriceFeedMap;
    mapping (bytes32 => uint256) public mockTwapPriceFeedMap;
    function mockIndexPrice(bytes32 _priceFeedKey, uint256 _indexPrice) public {
        mockIndexPriceFeedMap[_priceFeedKey] = _indexPrice;
    }
    function mockTwapPrice(bytes32 _priceFeedKey, uint256 _twapPrice) public {
        mockTwapPriceFeedMap[_priceFeedKey] = _twapPrice;
    }
    function getTwapPrice(bytes32 _priceFeedKey, uint256 _interval) external view override returns (uint256) {
        return mockTwapPriceFeedMap[_priceFeedKey];
    }
    function getPrice(bytes32 _priceFeedKey) external view override returns (uint256) {
        return mockIndexPriceFeedMap[_priceFeedKey];
    }
}