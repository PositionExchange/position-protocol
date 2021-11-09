pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


interface IPositionManager {
    function getCurrentPip() external view returns (int128);

    function getCurrentSingleSlot() external view returns (int128, uint8);

    function getLiquidityInPip(int128 pip) external view returns (uint128);

    function getPendingOrderDetail(int128 pip, uint64 orderId) external view returns (
        bool isFilled,
        bool isBuy,
        uint256 size,
        uint256 partialFilled
    );

    function openLimitPosition(int128 pip, uint128 size, bool isBuy) external returns (uint64 orderId, uint256 sizeOut, uint256 openNotional);

    function openMarketPosition(uint256 size, bool isBuy) external returns (uint256 sizeOut, uint256 openNotional);

    function getPrice() external view returns (uint256);

    function pipToPrice(int128 pip) external view returns (uint256);

    function getQuoteAsset() external view returns (address);

    function calcAdjustMargin(uint256 adjustMargin) external view returns (uint256);

    function calcFee(uint256 _positionNotional) external view returns (uint256);

    function cancelLimitOrder(int128 pip, uint64 orderId) external returns (uint256);

    function closeLimitOrder(int128 pip, uint64 orderId, uint256 amountClose) external;

    function settleFunding() external returns (int256 premiumFraction);
}
