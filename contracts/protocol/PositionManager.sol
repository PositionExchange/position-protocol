pragma solidity ^0.8.0;

import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./libraries/position/TickPosition.sol";
import "./libraries/position/LimitOrder.sol";
import "./libraries/position/LiquidityBitmap.sol";
import "./libraries/types/PositionManagerStorage.sol";
import {IChainLinkPriceFeed} from "../interfaces/IChainLinkPriceFeed.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {Errors} from "./libraries/helpers/Errors.sol";

import "hardhat/console.sol";

contract PositionManager is ReentrancyGuardUpgradeable, OwnableUpgradeable, PositionManagerStorage {
    using TickPosition for TickPosition.Data;
    using LiquidityBitmap for mapping(uint128 => uint256);

    // Events that supports building order book
    event MarketFilled(
        bool isBuy,
        uint256 indexed amount,
        uint128 toPip,
        uint256 passedPipcount,
        uint128 partialFilledQuantity);
    event LimitOrderCreated(uint64 orderId, uint128 pip, uint128 size, bool isBuy);
    event LimitOrderCancelled(uint64 orderId, uint128 pip, uint256 size);

    event UpdateMaxFindingWordsIndex(uint128 newMaxFindingWordsIndex);
    event UpdateBasisPoint(uint256 newBasicPoint);
    event UpdateBaseBasicPoint(uint256 newBaseBasisPoint);
    event UpdateTollRatio(uint256 newTollRatio);
    event UpdateSpotPriceTwapInterval(uint256 newSpotPriceTwapInterval);
    event ReserveSnapshotted(uint128 pip, uint256 timestamp);
    event FundingRateUpdated(int256 fundingRate, uint256 underlyingPrice);
    event LimitOrderUpdated(uint64 orderId, uint128 pip, uint256 size);

    modifier onlyCounterParty(){
        require(counterParty == _msgSender(), Errors.VL_NOT_COUNTERPARTY);
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Pausable: paused");
        _;
    }

    modifier whenPaused() {
        require(paused, "Pausable: not paused");
        _;
    }

    function pause() public onlyOwner whenNotPaused {
        paused = true;
    }

    function unpause() public onlyOwner whenPaused {
        paused = false;
    }


    function initialize(
        uint128 _initialPip,
        address _quoteAsset,
        bytes32 _priceFeedKey,
        uint256 _basisPoint,
        uint256 _BASE_BASIC_POINT,
        uint256 _tollRatio,
        uint128 _maxFindingWordsIndex,
        uint256 _fundingPeriod,
        address _priceFeed,
        address _counterParty
    )
    public initializer {
        require(
            _fundingPeriod != 0 &&
            _quoteAsset != address(0) &&
            _priceFeed != address(0) &&
            _counterParty != address(0),
            Errors.VL_INVALID_INPUT
        );

        __ReentrancyGuard_init();
        __Ownable_init();

        priceFeedKey = _priceFeedKey;
        singleSlot.pip = _initialPip;
        reserveSnapshots.push(
            ReserveSnapshot(_initialPip, block.timestamp, block.number)
        );
        quoteAsset = IERC20(_quoteAsset);
        basisPoint = _basisPoint;
        BASE_BASIC_POINT = _BASE_BASIC_POINT;
        tollRatio = _tollRatio;
        spotPriceTwapInterval = 1 hours;
        fundingPeriod = _fundingPeriod;
        fundingBufferPeriod = _fundingPeriod / 2;
        maxFindingWordsIndex = _maxFindingWordsIndex;
        priceFeed = IChainLinkPriceFeed(_priceFeed);
        counterParty = _counterParty;
        paused = false;
        emit ReserveSnapshotted(_initialPip, block.timestamp);
    }

    function getBaseBasisPoint() public view returns (uint256) {
        return BASE_BASIC_POINT;
    }

    function getCurrentPip() public view returns (uint128) {
        return singleSlot.pip;
    }

    function getCurrentSingleSlot() public view returns (uint128, uint8) {
        return (singleSlot.pip, singleSlot.isFullBuy);
    }

    function getPrice() public view returns (uint256) {
        return uint256(singleSlot.pip) * BASE_BASIC_POINT / basisPoint;
    }

    function pipToPrice(uint128 pip) public view returns (uint256) {
        return uint256(pip) * BASE_BASIC_POINT / basisPoint;
    }

    function getLiquidityInCurrentPip() public view returns (uint128){
        return liquidityBitmap.hasLiquidity(singleSlot.pip) ? tickPosition[singleSlot.pip].liquidity : 0;
    }

    function calcAdjustMargin(uint256 adjustMargin) public view returns (uint256) {
        return adjustMargin;
    }

    function hasLiquidity(uint128 pip) public view returns (bool) {
        return liquidityBitmap.hasLiquidity(pip);
    }

    function getPendingOrderDetail(uint128 pip, uint64 orderId) public view returns (
        bool isFilled,
        bool isBuy,
        uint256 size,
        uint256 partialFilled
    ){
        (isFilled, isBuy, size, partialFilled) = tickPosition[pip].getQueueOrder(orderId);
        if (!liquidityBitmap.hasLiquidity(pip)) {
            isFilled = true;
        }
        if (size != 0 && size == partialFilled) {
            isFilled = true;
        }
    }

    function needClosePositionBeforeOpeningLimitOrder(
        uint8 _side,
        uint256 _pip,
        uint128 _quantity,
        uint8 _pSide,
        uint256 _pQuantity
    ) public view returns (bool) {
        //save gas
        SingleSlot memory _singleSlot = singleSlot;
        return _pip == _singleSlot.pip
        && _singleSlot.isFullBuy != _side
        && _pQuantity <= _quantity
        && _pQuantity <= getLiquidityInCurrentPip();
    }

    function getNotionalMarginAndFee(
        uint256 _pQuantity,
        uint128 _pip,
        uint256 _leverage
    ) public view returns (
        uint256 notional,
        uint256 margin,
        uint256 fee
    ){
        notional = _pQuantity * pipToPrice(_pip) / getBaseBasisPoint();
        margin = notional / _leverage;
        fee = calcFee(notional);
    }


    function updatePartialFilledOrder(uint128 pip, uint64 orderId) public {
        uint256 newSize = tickPosition[pip].updateOrderWhenClose(orderId);
        emit LimitOrderUpdated(orderId, pip, newSize);
    }

    /**
     * @notice calculate total fee (including toll and spread) by input quote asset amount
     * @param _positionNotional quote asset amount
     * @return total tx fee
     */
    function calcFee(uint256 _positionNotional) public view returns (uint256)
    {
        if (tollRatio != 0) {
            return _positionNotional / tollRatio;
        }
        return 0;
    }

    function cancelLimitOrder(uint128 pip, uint64 orderId) external onlyCounterParty returns (uint256 size) {
        size = tickPosition[pip].cancelLimitOrder(orderId);
        if (orderId == tickPosition[pip].currentIndex && orderId <= tickPosition[pip].filledIndex) {
            liquidityBitmap.toggleSingleBit(pip, false);
            singleSlot.isFullBuy = 0;
        }
        emit LimitOrderCancelled(orderId, pip, size);
    }

    function openLimitPosition(
        uint128 pip,
        uint128 size,
        bool isBuy) external whenNotPaused onlyCounterParty returns (
        uint64 orderId,
        uint256 sizeOut,
        uint256 openNotional){
        if (isBuy && singleSlot.pip != 0) {
            require(
                pip <= singleSlot.pip && int128(pip) >= (int128(singleSlot.pip) - int128(maxFindingWordsIndex * 250)),
                Errors.VL_LONG_PRICE_THAN_CURRENT_PRICE);
        } else {
            require(
                pip >= singleSlot.pip && pip <= (singleSlot.pip + maxFindingWordsIndex * 250),
                Errors.VL_SHORT_PRICE_LESS_CURRENT_PRICE);
        }
        SingleSlot memory _singleSlot = singleSlot;
        bool hasLiquidity = liquidityBitmap.hasLiquidity(pip);
        //save gas
        if (pip == _singleSlot.pip && hasLiquidity && _singleSlot.isFullBuy != (isBuy ? 1 : 2)) {
            // open market
            (sizeOut, openNotional) = openMarketPositionWithMaxPip(size, isBuy, pip);
            hasLiquidity = liquidityBitmap.hasLiquidity(pip);
        }
        if (size > sizeOut) {
            if (pip == _singleSlot.pip && _singleSlot.isFullBuy != (isBuy ? 1 : 2)) {
                singleSlot.isFullBuy = isBuy ? 1 : 2;
            }
            //TODO validate pip
            // convert tick to price
            // save at that pip has how many liquidity
            orderId = tickPosition[pip].insertLimitOrder(size - uint128(sizeOut), hasLiquidity, isBuy);
            if (!hasLiquidity) {
                //set the bit to mark it has liquidity
                liquidityBitmap.toggleSingleBit(pip, true);
            }
        }
        // TODO update emit event
        emit LimitOrderCreated(orderId, pip, size, isBuy);
    }


    function openMarketPositionWithMaxPip(uint256 size, bool isBuy, uint128 maxPip) public whenNotPaused onlyCounterParty
    returns (uint256 sizeOut, uint256 openNotional) {
        return _internalOpenMarketOrder(size, isBuy, maxPip);
    }

    function openMarketPosition(uint256 size, bool isBuy) external whenNotPaused onlyCounterParty returns
    (uint256 sizeOut, uint256 openNotional) {
        return _internalOpenMarketOrder(size, isBuy, 0);
    }

    function _internalOpenMarketOrder(uint256 size, bool isBuy, uint128 maxPip) internal
    returns (uint256 sizeOut, uint256 openNotional) {
        require(size != 0, Errors.VL_INVALID_SIZE);
        // TODO lock
        // get current tick liquidity
        SingleSlot memory _initialSingleSlot = singleSlot;
        //save gas
        SwapState memory state = SwapState({
        remainingSize : size,
        pip : _initialSingleSlot.pip
        });
        uint128 startPip;
        //        int128 startWord = _initialSingleSlot.pip >> 8;
        //        int128 wordIndex = startWord;
        uint128 partialFilledQuantity;
        uint8 isFullBuy = 0;
        bool isSkipFirstPip;
        uint256 passedPipCount = 0;
        CurrentLiquiditySide currentLiquiditySide = CurrentLiquiditySide(_initialSingleSlot.isFullBuy);
        if (currentLiquiditySide != CurrentLiquiditySide.NotSet) {
            if (isBuy)
            // if buy and latest liquidity is buy. skip current pip
                isSkipFirstPip = currentLiquiditySide == CurrentLiquiditySide.Buy;
            else
            // if sell and latest liquidity is sell. skip current pip
                isSkipFirstPip = currentLiquiditySide == CurrentLiquiditySide.Sell;
        }
        while (state.remainingSize != 0) {
            StepComputations memory step;
            // updated findHasLiquidityInMultipleWords, save more gas
            (step.pipNext) = liquidityBitmap.findHasLiquidityInMultipleWords(
                state.pip,
                maxFindingWordsIndex,
                !isBuy
            );
            if (maxPip != 0 && step.pipNext != maxPip) break;
            if (step.pipNext == 0) {
                // no more next pip
                // state pip back 1 pip
                if (isBuy) {
                    state.pip--;
                } else {
                    state.pip++;
                }
                break;
            }
            else {
                if (!isSkipFirstPip) {
                    if (startPip == 0) startPip = step.pipNext;

                    // get liquidity at a tick index
                    uint128 liquidity = tickPosition[step.pipNext].liquidity;
                    if (liquidity > state.remainingSize) {
                        // pip position will partially filled and stop here
                        tickPosition[step.pipNext].partiallyFill(uint128(state.remainingSize));
                        openNotional += (state.remainingSize * pipToPrice(step.pipNext) / BASE_BASIC_POINT);
                        // remaining liquidity at current pip
                        partialFilledQuantity = liquidity - uint128(state.remainingSize);
                        state.remainingSize = 0;
                        state.pip = step.pipNext;
                        isFullBuy = uint8(!isBuy ? CurrentLiquiditySide.Buy : CurrentLiquiditySide.Sell);
                    } else if (state.remainingSize > liquidity) {
                        // order in that pip will be fulfilled
                        state.remainingSize = state.remainingSize - liquidity;
                        openNotional += (liquidity * pipToPrice(step.pipNext) / BASE_BASIC_POINT);
                        state.pip = state.remainingSize > 0 ? (isBuy ? step.pipNext + 1 : step.pipNext - 1) : step.pipNext;
                        passedPipCount++;
                    } else {
                        // remaining size = liquidity
                        // only 1 pip should be toggled, so we call it directly here
                        liquidityBitmap.toggleSingleBit(step.pipNext, false);
                        openNotional += (state.remainingSize * pipToPrice(step.pipNext) / BASE_BASIC_POINT);
                        state.remainingSize = 0;
                        state.pip = step.pipNext;
                        isFullBuy = 0;
                        passedPipCount++;
                    }
                } else {
                    isSkipFirstPip = false;
                    state.pip = isBuy ? step.pipNext + 1 : step.pipNext - 1;
                }
            }
        }
        if (_initialSingleSlot.pip != state.pip) {
            // all ticks in shifted range must be marked as filled
            if (!(partialFilledQuantity > 0 && startPip == state.pip)) {
                liquidityBitmap.unsetBitsRange(startPip, partialFilledQuantity > 0 ? (isBuy ? state.pip - 1 : state.pip + 1) : state.pip);
            }
            // TODO write a checkpoint that we shift a range of ticks
        }
        singleSlot.pip = maxPip != 0 ? maxPip : state.pip;
        singleSlot.isFullBuy = isFullBuy;
        sizeOut = size - state.remainingSize;
        addReserveSnapshot();
        emit MarketFilled(isBuy, sizeOut, maxPip != 0 ? maxPip : state.pip, passedPipCount, partialFilledQuantity);
    }

    struct LiquidityOfEachPip {
        uint128 pip;
        uint256 liquidity;
    }

    function getLiquidityInPipRange(uint128 fromPip, uint256 dataLength, bool toHigher) public view
    returns (LiquidityOfEachPip[] memory, uint128) {
        uint128[] memory allInitializedPip = new uint128[](uint128(dataLength));
        allInitializedPip = liquidityBitmap.findAllLiquidityInMultipleWords(fromPip, dataLength, toHigher);
        LiquidityOfEachPip[] memory allLiquidity = new LiquidityOfEachPip[](dataLength);


        for (uint i = 0; i < dataLength; i++) {
            allLiquidity[i] = LiquidityOfEachPip({
            pip : allInitializedPip[i],
            liquidity : tickPosition[allInitializedPip[i]].liquidity
            });
        }
        return (allLiquidity, allInitializedPip[dataLength - 1]);
    }

    function getQuoteAsset() public view returns (IERC20) {
        return quoteAsset;
    }

    function updateMaxFindingWordsIndex(uint128 _newMaxFindingWordsIndex) public onlyOwner {
        maxFindingWordsIndex = _newMaxFindingWordsIndex;
        emit  UpdateMaxFindingWordsIndex(_newMaxFindingWordsIndex);
    }

    function updateBasisPoint(uint256 _newBasisPoint) public onlyOwner {
        basisPoint = _newBasisPoint;
        emit UpdateBasisPoint(_newBasisPoint);
    }

    function updateBaseBasicPoint(uint256 _newBaseBasisPoint) public onlyOwner {
        BASE_BASIC_POINT = _newBaseBasisPoint;
        emit UpdateBaseBasicPoint(_newBaseBasisPoint);
    }

    function updateTollRatio(uint256 newTollRatio) public onlyOwner {
        tollRatio = newTollRatio;
        emit UpdateTollRatio(newTollRatio);
    }


    function setCounterParty(address _counterParty) public onlyOwner {
        require(_counterParty != address(0), Errors.VL_EMPTY_ADDRESS);
        counterParty = _counterParty;
    }

    function updateSpotPriceTwapInterval(uint256 _spotPriceTwapInterval) public onlyOwner {

        spotPriceTwapInterval = _spotPriceTwapInterval;
        emit UpdateSpotPriceTwapInterval(_spotPriceTwapInterval);

    }

    /**
     * @notice update funding rate
     * @dev only allow to update while reaching `nextFundingTime`
     * @return premiumFraction of this period in 18 digits
     */
    function settleFunding() external onlyCounterParty returns (int256 premiumFraction) {
        require(block.timestamp >= nextFundingTime, Errors.VL_SETTLE_FUNDING_TOO_EARLY);

        // premium = twapMarketPrice - twapIndexPrice
        // timeFraction = fundingPeriod(1 hour) / 1 day
        // premiumFraction = premium * timeFraction
        uint256 underlyingPrice = getUnderlyingTwapPrice(spotPriceTwapInterval);
        int256 premium = int256(getTwapPrice(spotPriceTwapInterval)) - int256(underlyingPrice);
        premiumFraction = premium * int256(fundingPeriod) / int256(1 days);

        // update funding rate = premiumFraction / twapIndexPrice
        updateFundingRate(premiumFraction, underlyingPrice);

        // in order to prevent multiple funding settlement during very short time after network congestion
        uint256 minNextValidFundingTime = block.timestamp + fundingBufferPeriod;

        // floor((nextFundingTime + fundingPeriod) / 3600) * 3600
        uint256 nextFundingTimeOnHourStart = (nextFundingTime + fundingPeriod) / (1 hours) * (1 hours);

        // max(nextFundingTimeOnHourStart, minNextValidFundingTime)
        nextFundingTime = nextFundingTimeOnHourStart > minNextValidFundingTime
        ? nextFundingTimeOnHourStart
        : minNextValidFundingTime;

        return premiumFraction;
    }

    /**
     * @notice get underlying price provided by oracle
     * @return underlying price
     */
    function getUnderlyingPrice() public view returns (uint256) {
        return priceFeed.getPrice(priceFeedKey) * BASE_BASIC_POINT;
    }

    /**
     * @notice get underlying twap price provided by oracle
     * @return underlying price
     */
    function getUnderlyingTwapPrice(uint256 _intervalInSeconds) public view returns (uint256) {
        return priceFeed.getTwapPrice(priceFeedKey, _intervalInSeconds) * BASE_BASIC_POINT;
    }

    /**
     * @notice get twap price
     */
    function getTwapPrice(uint256 _intervalInSeconds) public view returns (uint256) {
        return implGetReserveTwapPrice(_intervalInSeconds);
    }

    function implGetReserveTwapPrice(uint256 _intervalInSeconds) public view returns (uint256) {
        TwapPriceCalcParams memory params;
        // Can remove this line
        params.opt = TwapCalcOption.RESERVE_ASSET;
        params.snapshotIndex = reserveSnapshots.length - 1;
        return calcTwap(params, _intervalInSeconds);
    }

    function calcTwap(TwapPriceCalcParams memory _params, uint256 _intervalInSeconds)
    public
    view
    returns (uint256)
    {
        uint256 currentPrice = getPriceWithSpecificSnapshot(_params);
        if (_intervalInSeconds == 0) {
            return currentPrice;
        }

        uint256 baseTimestamp = block.timestamp - _intervalInSeconds;
        ReserveSnapshot memory currentSnapshot = reserveSnapshots[_params.snapshotIndex];
        // return the latest snapshot price directly
        // if only one snapshot or the timestamp of latest snapshot is earlier than asking for
        if (reserveSnapshots.length == 1 || currentSnapshot.timestamp <= baseTimestamp) {
            return currentPrice;
        }

        uint256 previousTimestamp = currentSnapshot.timestamp;
        // period same as cumulativeTime
        uint256 period = block.timestamp - previousTimestamp;
        uint256 weightedPrice = currentPrice * period;
        while (true) {
            // if snapshot history is too short
            if (_params.snapshotIndex == 0) {
                return weightedPrice / period;
            }

            _params.snapshotIndex = _params.snapshotIndex - 1;
            currentSnapshot = reserveSnapshots[_params.snapshotIndex];
            currentPrice = getPriceWithSpecificSnapshot(_params);

            // check if current snapshot timestamp is earlier than target timestamp
            if (currentSnapshot.timestamp <= baseTimestamp) {
                // weighted time period will be (target timestamp - previous timestamp). For example,
                // now is 1000, _intervalInSeconds is 100, then target timestamp is 900. If timestamp of current snapshot is 970,
                // and timestamp of NEXT snapshot is 880, then the weighted time period will be (970 - 900) = 70,
                // instead of (970 - 880)
                weightedPrice = weightedPrice + (currentPrice * (previousTimestamp - baseTimestamp));
                break;
            }

            uint256 timeFraction = previousTimestamp - currentSnapshot.timestamp;
            weightedPrice = weightedPrice + (currentPrice * timeFraction);
            period = period + timeFraction;
            previousTimestamp = currentSnapshot.timestamp;
        }
        return weightedPrice / _intervalInSeconds;
    }

    function getPriceWithSpecificSnapshot(TwapPriceCalcParams memory params)
    internal
    view
    virtual
    returns (uint256)
    {
        return pipToPrice(reserveSnapshots[params.snapshotIndex].pip);
    }

    //
    // INTERNAL FUNCTIONS
    //
    // update funding rate = premiumFraction / twapIndexPrice
    function updateFundingRate(
        int256 _premiumFraction,
        uint256 _underlyingPrice
    ) private {
        fundingRate = _premiumFraction / int256(_underlyingPrice);
        emit FundingRateUpdated(fundingRate, _underlyingPrice);
    }

    function addReserveSnapshot() internal {
        uint256 currentBlock = block.number;
        ReserveSnapshot memory latestSnapshot = reserveSnapshots[reserveSnapshots.length - 1];
        if (currentBlock == latestSnapshot.blockNumber) {
            reserveSnapshots[reserveSnapshots.length - 1].pip = singleSlot.pip;
        } else {
            reserveSnapshots.push(
                ReserveSnapshot(singleSlot.pip, block.timestamp, currentBlock)
            );
        }
        emit ReserveSnapshotted(singleSlot.pip, block.timestamp);
    }

}
