// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import {WhitelistManager} from "./modules/WhitelistManager.sol";
import "../interfaces/IUniswapV2Router.sol";
import "../interfaces/IUniswapV2Pair.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice This contract provides a consistent pricing data of a token.
 * Data is push to the contract from backend servers.
 */
contract PriceAggregator is AggregatorV3Interface, Ownable {
    struct Round {
        uint64 ID;
        int128 answer;
        uint64 startedAt;
    }

    uint8 public decimals;
    uint256 public version;
    string public description;

    uint256 public multiplier;
    bool public quoteTokenIs1;

    IUniswapV2Pair pair;
    Round[] public roundList;
    uint64 public currentRoundID;

    function initialize(
        address _liquidityPoolAddress,
        uint8 _decimals,
        uint256 _version,
        string memory _description,
        bool _quoteTokenIs1
    ) public onlyOwner {

        pair = IUniswapV2Pair(_liquidityPoolAddress);
        decimals = _decimals;
        version = _version;
        description = _description;

        multiplier = 10**_decimals;
        quoteTokenIs1 = _quoteTokenIs1;
    }

    function getRoundData(uint80 _roundId)
        public
        view
        virtual
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        Round memory round = roundList[_roundId - 1];
        uint80 id = uint80(round.ID);
        uint256 time = uint256(round.startedAt);

        return (id, int256(round.answer), time, time, id);
    }

    function latestRoundData()
        public
        view
        virtual
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return getRoundData(currentRoundID);
    }

    function addRound() external {
        (uint112 reserve0, uint112 reserve1,) = pair
            .getReserves();
        int112 price = int112(calculatePrice(reserve0, reserve1));

        roundList.push(
            Round(++currentRoundID, int128(price), uint64(block.timestamp))
        );
    }

    function calculatePrice(uint112 reserve0, uint112 reserve1)
        internal
        view
        returns (uint112 amount)
    {
        if (quoteTokenIs1) {
            return uint112((reserve1 * multiplier) / reserve0);
        }
        return uint112((reserve0 * multiplier) / reserve1);
    }
}
