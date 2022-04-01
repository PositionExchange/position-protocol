// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../../interfaces/IChainLinkPriceFeed.sol";
import "../position/TickPosition.sol";
import "../position/LiquidityBitmap.sol";

contract PositionManagerStorage {
    using TickPosition for TickPosition.Data;
    using LiquidityBitmap for mapping(uint128 => uint256);

    uint64 public basisPoint; //0.01
    uint64 public BASE_BASIC_POINT;
    // fee = quoteAssetAmount / tollRatio (means if fee = 0.001% then tollRatio = 100000)
    uint256 tollRatio;

    int256 public fundingRate;

    uint256 public spotPriceTwapInterval;
    uint256 public fundingPeriod;
    uint256 public fundingBufferPeriod;
    uint256 public nextFundingTime;
    bytes32 public priceFeedKey;
    // Max finding word can be 3500
    uint128 public maxFindingWordsIndex;

    address public counterParty;

    uint128 public leverage;

    bool internal _isInitiatedPip;

    //    bool public paused;

    IChainLinkPriceFeed public priceFeed;

    struct SingleSlot {
        uint128 pip;
        //0: not set
        //1: buy
        //2: sell
        uint8 isFullBuy;
    }

    struct PipLiquidity {
        uint128 pip;
        uint256 liquidity;
    }

    IERC20 quoteAsset;

    struct ReserveSnapshot {
        uint128 pip;
        uint64 timestamp;
        uint64 blockNumber;
    }

    enum TwapCalcOption {
        RESERVE_ASSET,
        INPUT_ASSET
    }

    struct TwapPriceCalcParams {
        TwapCalcOption opt;
        uint256 snapshotIndex;
    }

    struct SwapState {
        uint256 remainingSize;
        // the tick associated with the current price
        uint128 pip;
    }

    struct StepComputations {
        uint128 pipNext;
    }

    enum CurrentLiquiditySide {
        NotSet,
        Buy,
        Sell
    }

    // array of reserveSnapshots
    ReserveSnapshot[] public reserveSnapshots;

    SingleSlot public singleSlot;
    mapping(uint128 => TickPosition.Data) public tickPosition;
    mapping(uint128 => uint256) public tickStore;
    // a packed array of bit, where liquidity is filled or not
    mapping(uint128 => uint256) public liquidityBitmap;

    uint16 public maxMarketMakerSlipage;
    uint32 internal constant PERCENT_BASE = 1000000;

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[49] private __gap;
}
