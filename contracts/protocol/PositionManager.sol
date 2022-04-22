// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./libraries/position/TickPosition.sol";
import "./libraries/position/LimitOrder.sol";
import "./libraries/position/LiquidityBitmap.sol";
import "./libraries/types/PositionManagerStorage.sol";
import "./libraries/helpers/Quantity.sol";
import "./libraries/types/MarketMaker.sol";
import {IChainLinkPriceFeed} from "../interfaces/IChainLinkPriceFeed.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {Errors} from "./libraries/helpers/Errors.sol";
import {IPositionManager} from "../interfaces/IPositionManager.sol";

//import "hardhat/console.sol";

contract PositionManager is
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    OwnableUpgradeable,
    PositionManagerStorage,
    IPositionManager
{
    using TickPosition for TickPosition.Data;
    using LiquidityBitmap for mapping(uint128 => uint256);

    // IMPORTANT this digit must be the same to TOKEN_DIGIT in ChainLinkPriceFeed
    uint256 private constant PRICE_FEED_TOKEN_DIGIT = 10**18;
    int256 private constant PREMIUM_FRACTION_DENOMINATOR = 10**10;

    modifier onlyCounterParty() {
        require(counterParty == _msgSender(), Errors.VL_NOT_COUNTERPARTY);
        _;
    }

    function initialize(
        // moved to initializePip
        uint128 _initialPip,
        address _quoteAsset,
        bytes32 _priceFeedKey,
        uint64 _basisPoint,
        uint64 _BASE_BASIC_POINT,
        uint256 _tollRatio,
        uint128 _maxFindingWordsIndex,
        uint256 _fundingPeriod,
        address _priceFeed,
        address _counterParty
    ) public initializer {
        require(
            _fundingPeriod != 0 &&
                _quoteAsset != address(0) &&
                _priceFeed != address(0) &&
                _counterParty != address(0),
            Errors.VL_INVALID_INPUT
        );

        __ReentrancyGuard_init();
        __Ownable_init();
        __Pausable_init();

        priceFeedKey = _priceFeedKey;
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
        leverage = 125;
        // default is 1% Market market slippage
        maxMarketMakerSlipage = 10000;
        if(_initialPip != 0){
            reserveSnapshots.push(
                ReserveSnapshot(_initialPip, _now(), _blocknumber())
            );
            singleSlot.pip = _initialPip;
            emit ReserveSnapshotted(_initialPip, _now());
        }

    }

    function initializePip() external {
        // initialize singleSlot.pip
        require(!_isInitiatedPip && singleSlot.pip == 0, "initialized");
        uint256 _price = priceFeed.getPrice(priceFeedKey);
        uint128 _pip = uint128(_price * basisPoint/PRICE_FEED_TOKEN_DIGIT);
        singleSlot.pip = _pip;
        reserveSnapshots.push(
            ReserveSnapshot(_pip, _now(), _blocknumber())
        );
        _isInitiatedPip = true;
        emit ReserveSnapshotted(_pip, _now());
    }

    function updatePartialFilledOrder(uint128 _pip, uint64 _orderId)
        public
        whenNotPaused
        onlyCounterParty
    {
        uint256 newSize = tickPosition[_pip].updateOrderWhenClose(_orderId);
        emit LimitOrderUpdated(_orderId, _pip, newSize);
    }

    function cancelLimitOrder(uint128 _pip, uint64 _orderId)
        external
        whenNotPaused
        onlyCounterParty
        returns (uint256 remainingSize, uint256 partialFilled)
    {
        TickPosition.Data storage _tickPosition = tickPosition[_pip];
        require(
            hasLiquidity(_pip) && _orderId >= _tickPosition.filledIndex,
            Errors.VL_ONLY_PENDING_ORDER
        );
        return _internalCancelLimitOrder(_tickPosition, _pip, _orderId);
    }

    function marketMakerRemove(MarketMaker.MMCancelOrder[] memory _orders)
        external
        whenNotPaused
        onlyCounterParty
    {
        for (uint256 i = 0; i < _orders.length; i++) {
            MarketMaker.MMCancelOrder memory _order = _orders[i];
            TickPosition.Data storage _tickPosition = tickPosition[_order.pip];
            if (_order.orderId >= _tickPosition.filledIndex) {
                _internalCancelLimitOrder(
                    _tickPosition,
                    _order.pip,
                    _order.orderId
                );
            }
        }
    }

    function marketMakerSupply(
        MarketMaker.MMOrder[] memory _orders,
        uint256 leverage
    ) external whenNotPaused onlyCounterParty {
        SingleSlot memory _singleSlotMM = singleSlot;
        for (uint256 i = 0; i < _orders.length; i++) {
            MarketMaker.MMOrder memory _order = _orders[i];
            // BUY, price should always less than market price
            if (_order.quantity > 0 && _order.pip >= _singleSlotMM.pip) {
                //skip
                continue;
            }
            // SELL, price should always greater than market price
            if (_order.quantity < 0 && _order.pip <= _singleSlotMM.pip) {
                //skip
                continue;
            }
            uint128 _quantity = uint128(Quantity.abs(_order.quantity));
            bool _hasLiquidity = liquidityBitmap.hasLiquidity(_order.pip);
            uint64 _orderId = tickPosition[_order.pip].insertLimitOrder(
                _quantity,
                _hasLiquidity,
                _order.quantity > 0
            );
            if (!_hasLiquidity) {
                // TODO using toggle in multiple pips
                liquidityBitmap.toggleSingleBit(_order.pip, true);
            }
            emit LimitOrderCreated(
                _orderId,
                _order.pip,
                _quantity,
                _order.quantity > 0
            );
        }
    }

    // mean max for market market fill is 1%


    function marketMakerFill(
        MarketMaker.MMFill[] memory _mmFills,
        uint256 _leverage
    ) external whenNotPaused onlyCounterParty {
        for (uint256 i = 0; i < _mmFills.length; i++) {
            MarketMaker.MMFill memory mmFill = _mmFills[i];
            uint128 _beforePip = singleSlot.pip;
            _internalOpenMarketOrder(mmFill.quantity, mmFill.isBuy, 0);
            uint128 _afterPip = singleSlot.pip;
            bool pass;
            if (mmFill.isBuy) {
                pass = ((_afterPip - _beforePip) * PERCENT_BASE) / _beforePip >
                maxMarketMakerSlipage
                ? false
                : true;
            } else {
                pass = ((_beforePip - _afterPip) * PERCENT_BASE) / _beforePip > maxMarketMakerSlipage
                ? false
                : true;
            }

            require(pass, "!MM");
        }
    }

    function openLimitPosition(
        uint128 _pip,
        uint128 _size,
        bool _isBuy
    )
        external
        override
        whenNotPaused
        onlyCounterParty
        returns (
            uint64 orderId,
            uint256 sizeOut,
            uint256 openNotional
        )
    {
        SingleSlot memory _singleSlot = singleSlot;
        if (_isBuy && _singleSlot.pip != 0) {
            require(
                _pip <= _singleSlot.pip &&
                    int128(_pip) >=
                    (int128(_singleSlot.pip) -
                        int128(maxFindingWordsIndex * 250)),
                Errors.VL_LONG_PRICE_THAN_CURRENT_PRICE
            );
        } else {
            require(
                _pip >= _singleSlot.pip &&
                    _pip <= (_singleSlot.pip + maxFindingWordsIndex * 250),
                Errors.VL_SHORT_PRICE_LESS_CURRENT_PRICE
            );
        }
        bool hasLiquidity = liquidityBitmap.hasLiquidity(_pip);
        //save gas
        if (
            _pip == _singleSlot.pip &&
            hasLiquidity &&
            _singleSlot.isFullBuy != (_isBuy ? 1 : 2)
        ) {
            // open market
            (sizeOut, openNotional) = _openMarketPositionWithMaxPip(
                _size,
                _isBuy,
                _pip
            );
            hasLiquidity = liquidityBitmap.hasLiquidity(_pip);
        }
        uint128 remainingSize = _size - uint128(sizeOut);
        if (_size > sizeOut) {
            if (
                _pip == _singleSlot.pip &&
                _singleSlot.isFullBuy != (_isBuy ? 1 : 2)
            ) {
                singleSlot.isFullBuy = _isBuy ? 1 : 2;
            }
            // save at that pip has how many liquidity
            orderId = tickPosition[_pip].insertLimitOrder(
                remainingSize,
                hasLiquidity,
                _isBuy
            );
            if (!hasLiquidity) {
                // set the bit to mark it has liquidity
                liquidityBitmap.toggleSingleBit(_pip, true);
            }
        }
        emit LimitOrderCreated(orderId, _pip, remainingSize, _isBuy);
    }

    function openMarketPosition(uint256 _size, bool _isBuy)
        external
        whenNotPaused
        onlyCounterParty
        returns (
            uint256 sizeOut,
            uint256 openNotional,
            uint256 entryPrice,
            uint256 fee
        )
    {
        (sizeOut, openNotional) = _internalOpenMarketOrder(_size, _isBuy, 0);
        fee = calcFee(openNotional);
        entryPrice = (openNotional * getBasisPoint()) / _size;
    }

    /**
     * @notice update funding rate
     * @dev only allow to update while reaching `nextFundingTime`
     * @return premiumFraction of this period in 18 digits
     */
    function settleFunding()
        external
        whenNotPaused
        onlyCounterParty
        returns (int256 premiumFraction)
    {
        require(_now() >= nextFundingTime, Errors.VL_SETTLE_FUNDING_TOO_EARLY);
        uint256 underlyingPrice;
        (premiumFraction, underlyingPrice) = getPremiumFraction();

        // update funding rate = premiumFraction / twapIndexPrice
        _updateFundingRate(premiumFraction, underlyingPrice);

        // in order to prevent multiple funding settlement during very short time after network congestion
        uint256 minNextValidFundingTime = _now() + fundingBufferPeriod;

        // floor((nextFundingTime + fundingPeriod) / 3600) * 3600
        uint256 nextFundingTimeOnHourStart = ((nextFundingTime +
            fundingPeriod) / (1 hours)) * (1 hours);

        // max(nextFundingTimeOnHourStart, minNextValidFundingTime)
        nextFundingTime = nextFundingTimeOnHourStart > minNextValidFundingTime
            ? nextFundingTimeOnHourStart
            : minNextValidFundingTime;

        return premiumFraction;
    }

    //******************************************************************************************************************
    // VIEW FUNCTIONS
    //******************************************************************************************************************


    function getBasisPointFactors() external view returns (uint64 base, uint64 basisPoint) {
        return (BASE_BASIC_POINT, uint64(getBasisPoint()));
    }

    function getCurrentFundingRate()
        external
        view
        returns (int256 fundingRate)
    {
        (
            int256 premiumFraction,
            uint256 underlyingPrice
        ) = getPremiumFraction();
        return premiumFraction / int256(underlyingPrice);
    }

    function getPremiumFraction()
        public
        view
        returns (int256 premiumFraction, uint256 underlyingPrice)
    {
        // premium = twapMarketPrice - twapIndexPrice
        // timeFraction = fundingPeriod(1 hour) / 1 day
        // premiumFraction = premium * timeFraction
        underlyingPrice = getUnderlyingTwapPrice(spotPriceTwapInterval);
        int256 _twapPrice = int256(getTwapPrice(spotPriceTwapInterval));
        // 10 ** 8 is the divider
        int256 premium = ((_twapPrice - int256(underlyingPrice)) *
            PREMIUM_FRACTION_DENOMINATOR) / int256(getBaseBasisPoint());
        premiumFraction = (premium * int256(fundingPeriod)) / int256(1 days);
    }

    function getLeverage() public view returns (uint128) {
        return leverage;
    }

    function getBaseBasisPoint() public view override returns (uint256) {
        return BASE_BASIC_POINT;
    }

    function getBasisPoint() public view override returns (uint256) {
        return basisPoint;
    }

    function getCurrentPip() public view override returns (uint128) {
        return singleSlot.pip;
    }

    function getCurrentSingleSlot()
        public
        view
        override
        returns (uint128, uint8)
    {
        return (singleSlot.pip, singleSlot.isFullBuy);
    }

    function getPrice() public view override returns (uint256) {
        return (uint256(singleSlot.pip) * BASE_BASIC_POINT) / basisPoint;
    }

    function getNextFundingTime() public view override returns (uint256) {
        return nextFundingTime;
    }

    function pipToPrice(uint128 _pip) public view override returns (uint256) {
        return (uint256(_pip) * BASE_BASIC_POINT) / basisPoint;
    }

    function priceToWei(uint256 _price) public view returns (uint256) {
        return (_price * 10**18) / BASE_BASIC_POINT;
    }

    function getLiquidityInCurrentPip() public view override returns (uint128) {
        return
            liquidityBitmap.hasLiquidity(singleSlot.pip)
                ? tickPosition[singleSlot.pip].liquidity
                : 0;
    }

    function calcAdjustMargin(uint256 _adjustMargin)
        public
        view
        override
        returns (uint256)
    {
        return _adjustMargin;
    }

    function hasLiquidity(uint128 _pip) public view override returns (bool) {
        return liquidityBitmap.hasLiquidity(_pip);
    }

    function getPendingOrderDetail(uint128 _pip, uint64 _orderId)
        public
        view
        override
        returns (
            bool isFilled,
            bool isBuy,
            uint256 size,
            uint256 partialFilled
        )
    {
        (isFilled, isBuy, size, partialFilled) = tickPosition[_pip]
            .getQueueOrder(_orderId);

        if (!liquidityBitmap.hasLiquidity(_pip)) {
            isFilled = true;
        }
        if (size != 0 && size == partialFilled) {
            isFilled = true;
        }
    }

    function needClosePositionBeforeOpeningLimitOrder(
        uint8 _side,
        uint256 _pip,
        uint256 _pQuantity
    ) public view override returns (bool) {
        //save gas
        SingleSlot memory _singleSlot = singleSlot;
        return
            _pip == _singleSlot.pip &&
            _singleSlot.isFullBuy != _side &&
            _pQuantity <= getLiquidityInCurrentPip();
    }

    function getNotionalMarginAndFee(
        uint256 _pQuantity,
        uint128 _pip,
        uint16 _leverage
    )
        public
        view
        override
        returns (
            uint256 notional,
            uint256 margin,
            uint256 fee
        )
    {
        notional = (_pQuantity * pipToPrice(_pip)) / getBaseBasisPoint();
        margin = notional / _leverage;
        fee = calcFee(notional);
    }

    /**
     * @notice calculate total fee (including toll and spread) by input quote asset amount
     * @param _positionNotional quote asset amount
     * @return total tx fee
     */
    function calcFee(uint256 _positionNotional)
        public
        view
        override
        returns (uint256)
    {
        if (tollRatio != 0) {
            return _positionNotional / tollRatio;
        }
        return 0;
    }

    function getOrderbook(uint128 limit) external view returns (Orderbook memory ob){
        SingleSlot memory _singleSlot = singleSlot;
        uint128 _currentPip = _singleSlot.pip;
        uint128[] memory _askPips = liquidityBitmap.findAllLiquidityInMultipleWords(_currentPip, uint256(limit), true);
        uint128[] memory _bidPips = liquidityBitmap.findAllLiquidityInMultipleWords(_currentPip, uint256(limit), false);
        ob.asks = new uint128[][](_askPips.length);
        ob.bids = new uint128[][](_bidPips.length);
        bool shiftAsk;
        for(uint256 i=0; i<_askPips.length; i++){
            uint128[] memory _liquidity = new uint128[](2);
            if(_askPips[i] != 0){
                if(!(i == 0 && _currentPip == _askPips[0] && _singleSlot.isFullBuy == 1)){
                    _liquidity[0] = _askPips[i];
                    _liquidity[1] = tickPosition[_askPips[i]].liquidity;
                    ob.asks[shiftAsk ? i - 1 : i] = _liquidity;
                }else{
                    shiftAsk = true;
                }
            }
        }
        bool shiftBid;
        for(uint256 i=0; i<_bidPips.length; i++){
            uint128[] memory _liquidity = new uint128[](2);
            if(_bidPips[i] != 0){
                if(!(i == 0 && _currentPip == _askPips[0] && _singleSlot.isFullBuy == 2)){
                    _liquidity[0] = _bidPips[i];
                    _liquidity[1] = tickPosition[_bidPips[i]].liquidity;
                    ob.bids[shiftBid ? i - 1 : i] = _liquidity;
                }else{
                    shiftBid = true;
                }
            }
        }

    }

    function getLiquidityInPipRange(
        uint128 _fromPip,
        uint256 _dataLength,
        bool _toHigher
    ) public view override returns (PipLiquidity[] memory, uint128) {
        uint128[] memory allInitializedPips = new uint128[](
            uint128(_dataLength)
        );
        allInitializedPips = liquidityBitmap.findAllLiquidityInMultipleWords(
            _fromPip,
            _dataLength,
            _toHigher
        );
        PipLiquidity[] memory allLiquidity = new PipLiquidity[](_dataLength);

        for (uint256 i = 0; i < _dataLength; i++) {
            allLiquidity[i] = PipLiquidity({
                pip: allInitializedPips[i],
                liquidity: tickPosition[allInitializedPips[i]].liquidity
            });
        }
        return (allLiquidity, allInitializedPips[_dataLength - 1]);
    }

    function getQuoteAsset() public view override returns (IERC20) {
        return quoteAsset;
    }

    /**
     * @notice get underlying price provided by oracle
     * @return underlying price
     */
    function getUnderlyingPrice() public view override returns (uint256) {
        return _formatPriceFeedToBasicPoint(priceFeed.getPrice(priceFeedKey));
    }

    /**
     * @notice get underlying twap price provided by oracle
     * @return underlying price
     */
    function getUnderlyingTwapPrice(uint256 _intervalInSeconds)
        public
        view
        virtual
        returns (uint256)
    {
        return
            _formatPriceFeedToBasicPoint(
                priceFeed.getTwapPrice(priceFeedKey, _intervalInSeconds)
            );
    }

    /**
     * @notice get twap price
     */
    function getTwapPrice(uint256 _intervalInSeconds)
        public
        view
        virtual
        override
        returns (uint256)
    {
        return implGetReserveTwapPrice(_intervalInSeconds);
    }

    function implGetReserveTwapPrice(uint256 _intervalInSeconds)
        public
        view
        override
        returns (uint256)
    {
        TwapPriceCalcParams memory params;
        // Can remove this line
        params.opt = TwapCalcOption.RESERVE_ASSET;
        params.snapshotIndex = reserveSnapshots.length - 1;
        return calcTwap(params, _intervalInSeconds);
    }

    function calcTwap(
        TwapPriceCalcParams memory _params,
        uint256 _intervalInSeconds
    ) public view override returns (uint256) {
        uint256 currentPrice = _getPriceWithSpecificSnapshot(_params);
        if (_intervalInSeconds == 0) {
            return currentPrice;
        }

        uint256 baseTimestamp = _now() - _intervalInSeconds;
        ReserveSnapshot memory currentSnapshot = reserveSnapshots[
            _params.snapshotIndex
        ];
        // return the latest snapshot price directly
        // if only one snapshot or the timestamp of latest snapshot is earlier than asking for
        if (
            reserveSnapshots.length == 1 ||
            currentSnapshot.timestamp <= baseTimestamp
        ) {
            return currentPrice;
        }

        uint256 previousTimestamp = currentSnapshot.timestamp;
        // period same as cumulativeTime
        uint256 period = _now() - previousTimestamp;
        uint256 weightedPrice = currentPrice * period;
        while (true) {
            // if snapshot history is too short
            if (_params.snapshotIndex == 0) {
                return weightedPrice / period;
            }

            _params.snapshotIndex = _params.snapshotIndex - 1;
            currentSnapshot = reserveSnapshots[_params.snapshotIndex];
            currentPrice = _getPriceWithSpecificSnapshot(_params);

            // check if current snapshot timestamp is earlier than target timestamp
            if (currentSnapshot.timestamp <= baseTimestamp) {
                // weighted time period will be (target timestamp - previous timestamp). For example,
                // now is 1000, _intervalInSeconds is 100, then target timestamp is 900. If timestamp of current snapshot is 970,
                // and timestamp of NEXT snapshot is 880, then the weighted time period will be (970 - 900) = 70,
                // instead of (970 - 880)
                weightedPrice =
                    weightedPrice +
                    (currentPrice * (previousTimestamp - baseTimestamp));
                break;
            }

            uint256 timeFraction = previousTimestamp -
                currentSnapshot.timestamp;
            weightedPrice = weightedPrice + (currentPrice * timeFraction);
            period = period + timeFraction;
            previousTimestamp = currentSnapshot.timestamp;
        }
        return weightedPrice / _intervalInSeconds;
    }

    //******************************************************************************************************************
    // ONLY OWNER FUNCTIONS
    //******************************************************************************************************************

    function updateMaxPercentMarketMarket(uint16 newMarketMakerSlipage) public onlyOwner {

        emit MaxMarketMakerSlipageUpdated(maxMarketMakerSlipage, newMarketMakerSlipage);
        maxMarketMakerSlipage = newMarketMakerSlipage;

    }



    function updateLeverage(uint128 _newLeverage) public onlyOwner {
        require(0 < _newLeverage, Errors.VL_INVALID_LEVERAGE);

        emit LeverageUpdated(leverage, _newLeverage);
        leverage = _newLeverage;
    }

    function pause() public override onlyOwner {
        _pause();
    }

    function unpause() public override onlyOwner {
        _unpause();
    }

    function updateMaxFindingWordsIndex(uint128 _newMaxFindingWordsIndex)
        public
        override
        onlyOwner
    {
        maxFindingWordsIndex = _newMaxFindingWordsIndex;
        emit UpdateMaxFindingWordsIndex(_newMaxFindingWordsIndex);
    }

    function updateBasisPoint(uint64 _newBasisPoint) public override onlyOwner {
        basisPoint = _newBasisPoint;
        emit UpdateBasisPoint(_newBasisPoint);
    }

    function updateBaseBasicPoint(uint64 _newBaseBasisPoint)
        public
        override
        onlyOwner
    {
        BASE_BASIC_POINT = _newBaseBasisPoint;
        emit UpdateBaseBasicPoint(_newBaseBasisPoint);
    }

    function updateTollRatio(uint256 _newTollRatio) public override onlyOwner {
        tollRatio = _newTollRatio;
        emit UpdateTollRatio(_newTollRatio);
    }

    function setCounterParty(address _counterParty) public override onlyOwner {
        require(_counterParty != address(0), Errors.VL_EMPTY_ADDRESS);
        counterParty = _counterParty;
    }

    function updateSpotPriceTwapInterval(uint256 _spotPriceTwapInterval)
        public
        override
        onlyOwner
    {
        spotPriceTwapInterval = _spotPriceTwapInterval;
        emit UpdateSpotPriceTwapInterval(_spotPriceTwapInterval);
    }

    //******************************************************************************************************************
    // INTERNAL FUNCTIONS
    //******************************************************************************************************************

    function _openMarketPositionWithMaxPip(
        uint256 _size,
        bool _isBuy,
        uint128 _maxPip
    ) internal returns (uint256 sizeOut, uint256 openNotional) {
        return _internalOpenMarketOrder(_size, _isBuy, _maxPip);
    }

    function _internalCancelLimitOrder(
        TickPosition.Data storage _tickPosition,
        uint128 _pip,
        uint64 _orderId
    ) internal returns (uint256 remainingSize, uint256 partialFilled) {
        bool isBuy;
        (remainingSize, partialFilled, isBuy) = _tickPosition.cancelLimitOrder(
            _orderId
        );
        if (_tickPosition.liquidity == 0) {
            liquidityBitmap.toggleSingleBit(_pip, false);
            singleSlot.isFullBuy = 0;
        }
        emit LimitOrderCancelled(isBuy, _orderId, _pip, remainingSize);
    }

    function _msgSender()
        internal
        view
        override(ContextUpgradeable)
        returns (address)
    {
        return msg.sender;
    }

    function _msgData()
        internal
        view
        override(ContextUpgradeable)
        returns (bytes calldata)
    {
        return msg.data;
    }


    function _internalOpenMarketOrder(
        uint256 _size,
        bool _isBuy,
        uint128 _maxPip
    ) internal returns (uint256 sizeOut, uint256 openNotional) {
        require(_size != 0, Errors.VL_INVALID_SIZE);
        // TODO lock
        // get current tick liquidity
        SingleSlot memory _initialSingleSlot = singleSlot;
        //save gas
        SwapState memory state = SwapState({
            remainingSize: _size,
            pip: _initialSingleSlot.pip
        });
        uint128 startPip;
        uint128 remainingLiquidity;
        uint8 isFullBuy = 0;
        bool isSkipFirstPip;
        uint256 passedPipCount = 0;
        {
            CurrentLiquiditySide currentLiquiditySide = CurrentLiquiditySide(
                _initialSingleSlot.isFullBuy
            );
            if (currentLiquiditySide != CurrentLiquiditySide.NotSet) {
                if (_isBuy)
                    // if buy and latest liquidity is buy. skip current pip
                    isSkipFirstPip =
                        currentLiquiditySide == CurrentLiquiditySide.Buy;
                    // if sell and latest liquidity is sell. skip current pip
                else
                    isSkipFirstPip =
                        currentLiquiditySide == CurrentLiquiditySide.Sell;
            }
        }
        bool onlyLoopOnce;
        while (!onlyLoopOnce && state.remainingSize != 0) {
            StepComputations memory step;
            // updated findHasLiquidityInMultipleWords, save more gas
            if (_maxPip != 0) {
                step.pipNext = _maxPip;
                onlyLoopOnce = true;
            } else {
                (step.pipNext) = liquidityBitmap
                    .findHasLiquidityInMultipleWords(
                        state.pip,
                        maxFindingWordsIndex,
                        !_isBuy
                    );
            }
            if (_maxPip != 0 && step.pipNext != _maxPip) break;
            if (step.pipNext == 0) {
                // no more next pip
                // state pip back 1 pip
                if (_isBuy) {
                    state.pip--;
                } else {
                    state.pip++;
                }
                break;
            } else {
                if (!isSkipFirstPip) {
                    if (startPip == 0) startPip = step.pipNext;

                    // get liquidity at a tick index
                    uint128 liquidity = tickPosition[step.pipNext].liquidity;
                    if (liquidity > state.remainingSize) {
                        // pip position will partially filled and stop here
                        tickPosition[step.pipNext].partiallyFill(
                            uint128(state.remainingSize)
                        );
                        openNotional += ((state.remainingSize *
                            pipToPrice(step.pipNext)) / BASE_BASIC_POINT);
                        // remaining liquidity at current pip
                        remainingLiquidity =
                            liquidity -
                            uint128(state.remainingSize);
                        state.remainingSize = 0;
                        state.pip = step.pipNext;
                        isFullBuy = uint8(
                            !_isBuy
                                ? CurrentLiquiditySide.Buy
                                : CurrentLiquiditySide.Sell
                        );
                    } else if (state.remainingSize > liquidity) {
                        // order in that pip will be fulfilled
                        state.remainingSize = state.remainingSize - liquidity;
                        openNotional += ((liquidity *
                            pipToPrice(step.pipNext)) / BASE_BASIC_POINT);
                        state.pip = state.remainingSize > 0
                            ? (_isBuy ? step.pipNext + 1 : step.pipNext - 1)
                            : step.pipNext;
                        passedPipCount++;
                    } else {
                        // remaining size = liquidity
                        // only 1 pip should be toggled, so we call it directly here
                        liquidityBitmap.toggleSingleBit(step.pipNext, false);
                        openNotional += ((state.remainingSize *
                            pipToPrice(step.pipNext)) / BASE_BASIC_POINT);
                        state.remainingSize = 0;
                        state.pip = step.pipNext;
                        isFullBuy = 0;
                    }
                } else {
                    isSkipFirstPip = false;
                    state.pip = _isBuy ? step.pipNext + 1 : step.pipNext - 1;
                }
            }
        }
        if (_initialSingleSlot.pip != state.pip) {
            // all ticks in shifted range must be marked as filled
            if (!(remainingLiquidity > 0 && startPip == state.pip)) {
                if (_maxPip != 0) {
                    state.pip = _maxPip;
                }
                liquidityBitmap.unsetBitsRange(
                    startPip,
                    remainingLiquidity > 0
                        ? (_isBuy ? state.pip - 1 : state.pip + 1)
                        : state.pip
                );
            }
            // TODO write a checkpoint that we shift a range of ticks
        }
        singleSlot.pip = _maxPip != 0 ? _maxPip : state.pip;
        passedPipCount = _maxPip != 0 ? 0 : passedPipCount;
        singleSlot.isFullBuy = isFullBuy;
        sizeOut = _size - state.remainingSize;
        _addReserveSnapshot();
        emit MarketFilled(
            _isBuy,
            sizeOut,
            _maxPip != 0 ? _maxPip : state.pip,
            passedPipCount,
            remainingLiquidity
        );
    }

    function _getPriceWithSpecificSnapshot(TwapPriceCalcParams memory _params)
        internal
        view
        virtual
        returns (uint256)
    {
        return pipToPrice(reserveSnapshots[_params.snapshotIndex].pip);
    }

    function _now() internal view virtual returns (uint64) {
        return uint64(block.timestamp);
    }

    function _blocknumber() internal view virtual returns (uint64) {
        return uint64(block.number);
    }

    function _formatPriceFeedToBasicPoint(uint256 _price)
        internal
        view
        virtual
        returns (uint256)
    {
        return (_price * BASE_BASIC_POINT) / PRICE_FEED_TOKEN_DIGIT;
    }

    // update funding rate = premiumFraction / twapIndexPrice
    function _updateFundingRate(
        int256 _premiumFraction,
        uint256 _underlyingPrice
    ) internal {
        fundingRate = _premiumFraction / int256(_underlyingPrice);
        emit FundingRateUpdated(fundingRate, _underlyingPrice);
    }

    function _addReserveSnapshot() internal {
        uint64 currentBlock = _blocknumber();
        ReserveSnapshot memory latestSnapshot = reserveSnapshots[
            reserveSnapshots.length - 1
        ];
        if (currentBlock == latestSnapshot.blockNumber) {
            reserveSnapshots[reserveSnapshots.length - 1].pip = singleSlot.pip;
        } else {
            reserveSnapshots.push(
                ReserveSnapshot(singleSlot.pip, _now(), currentBlock)
            );
        }
        emit ReserveSnapshotted(singleSlot.pip, _now());
    }
}
