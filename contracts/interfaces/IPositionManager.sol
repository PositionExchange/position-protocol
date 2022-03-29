// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../protocol/libraries/types/PositionManagerStorage.sol";

interface IPositionManager {


    // EVENT

    // Events that supports building order book
    event MarketFilled(
        bool isBuy,
        uint256 indexed amount,
        uint128 toPip,
        uint256 passedPipCount,
        uint128 remainingLiquidity
    );
    event LimitOrderCreated(
        uint64 orderId,
        uint128 pip,
        uint128 size,
        bool isBuy
    );
    event LimitOrderCancelled(
        bool isBuy,
        uint64 orderId,
        uint128 pip,
        uint256 remainingSize
    );

    event UpdateMaxFindingWordsIndex(uint128 newMaxFindingWordsIndex);
    event UpdateBasisPoint(uint256 newBasicPoint);
    event UpdateBaseBasicPoint(uint256 newBaseBasisPoint);
    event UpdateTollRatio(uint256 newTollRatio);
    event UpdateSpotPriceTwapInterval(uint256 newSpotPriceTwapInterval);
    event ReserveSnapshotted(uint128 pip, uint256 timestamp);
    event FundingRateUpdated(int256 fundingRate, uint256 underlyingPrice);
    event LimitOrderUpdated(uint64 orderId, uint128 pip, uint256 size);


    // FUNCTIONS
    function pause() external;

    function unpause() external;

    function updateMaxFindingWordsIndex(uint128 _newMaxFindingWordsIndex) external;

    function updateBasisPoint(uint256 _newBasisPoint) external;

    function updateBaseBasicPoint(uint256 _newBaseBasisPoint) external;

    function updateTollRatio(uint256 _newTollRatio) external;

    function setCounterParty(address _counterParty) external;

    function updateSpotPriceTwapInterval(uint256 _spotPriceTwapInterval) external;


    function hasLiquidity(uint128 _pip) external returns (bool);

    function getCurrentPip() external view returns (uint128);

    function getBaseBasisPoint() external view returns (uint256);

    function getBasisPoint() external view returns (uint256);

    function getCurrentSingleSlot() external view returns (uint128, uint8);

    function getLiquidityInCurrentPip() external view returns (uint128);

    function getPrice() external view returns (uint256);

    function pipToPrice(uint128 pip) external view returns (uint256);

    function getQuoteAsset() external view returns (IERC20);

    function getUnderlyingPrice() external view returns (uint256);

    function updatePartialFilledOrder(uint128 pip, uint64 orderId) external;

    function getUnderlyingTwapPrice(uint256 _intervalInSeconds)
        external
        view
        returns (uint256);

    function implGetReserveTwapPrice(uint256 _intervalInSeconds)
        external
        view
        returns (uint256);

    function getTwapPrice(uint256 _intervalInSeconds)
        external
        view
        returns (uint256);

    function calcTwap(
        PositionManagerStorage.TwapPriceCalcParams memory _params,
        uint256 _intervalInSeconds
    ) external view returns (uint256);

    function getPendingOrderDetail(uint128 pip, uint64 orderId)
        external
        view
        returns (
            bool isFilled,
            bool isBuy,
            uint256 size,
            uint256 partialFilled
        );

    function needClosePositionBeforeOpeningLimitOrder(
        uint8 _side,
        uint256 _pip,
        uint128 _quantity,
        uint8 _pSide,
        uint256 _pQuantity
    ) external view returns (bool);

    function getNotionalMarginAndFee(
        uint256 _pQuantity,
        uint128 _pip,
        uint256 _leverage
    )
        external
        view
        returns (
            uint256 notional,
            uint256 margin,
            uint256 fee
        );

    function openLimitPosition(
        uint128 pip,
        uint128 size,
        bool isBuy
    )
        external
        returns (
            uint64 orderId,
            uint256 sizeOut,
            uint256 openNotional
        );

    function getLiquidityInPipRange(
        uint128 _fromPip,
        uint256 _dataLength,
        bool _toHigher
    ) external view returns (PositionManagerStorage.PipLiquidity[] memory, uint128);

    function openMarketPosition(uint256 size, bool isBuy)
        external
        returns (uint256 sizeOut, uint256 openNotional);


    function calcAdjustMargin(uint256 adjustMargin)
        external
        view
        returns (uint256);

    function calcFee(uint256 _positionNotional) external view returns (uint256);

    function cancelLimitOrder(uint128 pip, uint64 orderId)
        external
        returns (uint256 refundSize, uint256 partialFilled);

    function settleFunding() external returns (int256 premiumFraction);
}
