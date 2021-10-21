pragma solidity ^0.8.0;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {IChainLinkPriceFeed} from '../interfaces/IChainLinkPriceFeed.sol';

contract ChainLinkPriceFeed is IChainLinkPriceFeed, Initializable, ReentrancyGuardUpgradeable, OwnableUpgradeable {

    uint256 private constant TOKEN_DIGIT = 10 ** 18;

    // key by currency symbol, eg ETH
    mapping(bytes32 => AggregatorV3Interface) public priceFeedMap;
    bytes32[] public priceFeedKeys;
    mapping(bytes32 => uint8) public priceFeedDecimalMap;


    function addAggregator(bytes32 _priceFeedKey, address _aggregator) external onlyOwner {
        requireNonEmptyAddress(_aggregator);
        if (address(priceFeedMap[_priceFeedKey]) == address(0)) {
            priceFeedKeys.push(_priceFeedKey);
        }
        priceFeedMap[_priceFeedKey] = AggregatorV3Interface(_aggregator);

    }

    function removeAggregator(bytes32 _priceFeedKey) external onlyOwner {
        requireNonEmptyAddress(address(getAggregator(_priceFeedKey)));
        delete priceFeedMap[_priceFeedKey];
        delete priceFeedDecimalMap[_priceFeedKey];

        uint256 length = priceFeedKeys.length;
        for (uint256 i; i < length; i++) {
            if (priceFeedKeys[i] == _priceFeedKey) {
                // if the removal item is the last one, just `pop`
                if (i != length - 1) {
                    priceFeedKeys[i] = priceFeedKeys[length - 1];
                }
                priceFeedKeys.pop();
                break;
            }
        }
    }

    //
    // VIEW FUNCTIONS
    //

    function getAggregator(bytes32 _priceFeedKey) public view returns (AggregatorV3Interface) {
        return priceFeedMap[_priceFeedKey];
    }

    //
    // INTERFACE IMPLEMENTATION
    //

    function getPrice(bytes32 _priceFeedKey) external view override returns (uint256) {
        AggregatorV3Interface aggregator = getAggregator(_priceFeedKey);
        requireNonEmptyAddress(address(aggregator));

        (, uint256 latestPrice,) = getLatestRoundData(aggregator);
        return formatDecimals(latestPrice, priceFeedDecimalMap[_priceFeedKey]);
    }

    function getLatestTimestamp(bytes32 _priceFeedKey) external view override returns (uint256) {
        AggregatorV3Interface aggregator = getAggregator(_priceFeedKey);
        requireNonEmptyAddress(address(aggregator));

        (, , uint256 latestTimestamp) = getLatestRoundData(aggregator);
        return latestTimestamp;
    }

    function getTwapPrice(bytes32 _priceFeedKey, uint256 _interval) external view override returns (uint256) {
        AggregatorV3Interface aggregator = getAggregator(_priceFeedKey);
        requireNonEmptyAddress(address(aggregator));
        require(_interval != 0, "interval can't be 0");

        // 3 different timestamps, `previous`, `current`, `target`
        // `base` = now - _interval
        // `current` = current round timestamp from aggregator
        // `previous` = previous round timestamp form aggregator
        // now >= previous > current > = < base
        //
        //  while loop i = 0
        //  --+------+-----+-----+-----+-----+-----+
        //         base                 current  now(previous)
        //
        //  while loop i = 1
        //  --+------+-----+-----+-----+-----+-----+
        //         base           current previous now

        uint8 decimal = priceFeedDecimalMap[_priceFeedKey];
        (uint80 round, uint256 latestPrice, uint256 latestTimestamp) = getLatestRoundData(aggregator);
        uint256 baseTimestamp = block.timestamp - _interval;
        // if latest updated timestamp is earlier than target timestamp, return the latest price.
        if (latestTimestamp < baseTimestamp || round == 0) {
            return formatDecimals(latestPrice, decimal);
        }

        // rounds are like snapshots, latestRound means the latest price snapshot. follow chainlink naming
        uint256 previousTimestamp = latestTimestamp;
        uint256 cumulativeTime = block.timestamp - previousTimestamp;
        uint256 weightedPrice = latestPrice * cumulativeTime;
        while (true) {
            if (round == 0) {
                // if cumulative time is less than requested interval, return current twap price
                return formatDecimals(weightedPrice / cumulativeTime, decimal);
            }

            round = round - 1;
            (, uint256 currentPrice, uint256 currentTimestamp) = getRoundData(aggregator, round);

            // check if current round timestamp is earlier than target timestamp
            if (currentTimestamp <= baseTimestamp) {
                // weighted time period will be (target timestamp - previous timestamp). For example,
                // now is 1000, _interval is 100, then target timestamp is 900. If timestamp of current round is 970,
                // and timestamp of NEXT round is 880, then the weighted time period will be (970 - 900) = 70,
                // instead of (970 - 880)
                weightedPrice = weightedPrice + (currentPrice * (previousTimestamp - baseTimestamp));
                break;
            }

            uint256 timeFraction = previousTimestamp - (currentTimestamp);
            weightedPrice = weightedPrice + (currentPrice * timeFraction);
            cumulativeTime = cumulativeTime + timeFraction;
            previousTimestamp = currentTimestamp;
        }
        return formatDecimals(weightedPrice / _interval, decimal);
    }

    function getPreviousPrice(bytes32 _priceFeedKey, uint256 _numOfRoundBack) external view override returns (uint256) {
        AggregatorV3Interface aggregator = getAggregator(_priceFeedKey);
        requireNonEmptyAddress(address(aggregator));

        (uint80 round, , , ,) = aggregator.latestRoundData();
        require(round > 0 && round >= _numOfRoundBack, "Not enough history");
        (, int256 previousPrice, , ,) = aggregator.getRoundData(round - uint80(_numOfRoundBack));
        requirePositivePrice(previousPrice);
        return formatDecimals(uint256(previousPrice), priceFeedDecimalMap[_priceFeedKey]);
    }

    function getPreviousTimestamp(bytes32 _priceFeedKey, uint256 _numOfRoundBack)
    external
    view
    override
    returns (uint256)
    {
        AggregatorV3Interface aggregator = getAggregator(_priceFeedKey);
        requireNonEmptyAddress(address(aggregator));

        (uint80 round, , , ,) = aggregator.latestRoundData();
        require(round > 0 && round >= _numOfRoundBack, "Not enough history");
        (, int256 previousPrice, , uint256 previousTimestamp,) =
        aggregator.getRoundData(round - uint80(_numOfRoundBack));
        requirePositivePrice(previousPrice);
        return previousTimestamp;
    }

    function getLatestRoundData(AggregatorV3Interface _aggregator)
    internal
    view
    returns (
        uint80,
        uint256 finalPrice,
        uint256
    )
    {
        (uint80 round, int256 latestPrice, , uint256 latestTimestamp,) = _aggregator.latestRoundData();
        finalPrice = uint256(latestPrice);
        if (latestPrice < 0) {
            requireEnoughHistory(round);
            (round, finalPrice, latestTimestamp) = getRoundData(_aggregator, round - 1);
        }
        return (round, finalPrice, latestTimestamp);
    }

    function getRoundData(AggregatorV3Interface _aggregator, uint80 _round)
    internal
    view
    returns (
        uint80,
        uint256,
        uint256
    )
    {
        (uint80 round, int256 latestPrice, , uint256 latestTimestamp,) = _aggregator.getRoundData(_round);
        while (latestPrice < 0) {
            requireEnoughHistory(round);
            round = round - 1;
            (, latestPrice, , latestTimestamp,) = _aggregator.getRoundData(round);
        }
        return (round, uint256(latestPrice), latestTimestamp);
    }

    function formatDecimals(uint256 _price, uint8 _decimals) internal pure returns (uint256) {
        return _price * TOKEN_DIGIT / (10 ** uint256(_decimals));
    }

    //
    // REQUIRE FUNCTIONS
    //

    function requireNonEmptyAddress(address _addr) internal pure {
        require(_addr != address(0), "empty address");
    }

    function requireEnoughHistory(uint80 _round) internal pure {
        require(_round > 0, "Not enough history");
    }

    function requirePositivePrice(int256 _price) internal pure {
        // a negative price should be reverted to prevent an extremely large/small premiumFraction
        require(_price > 0, "Negative price");
    }
}