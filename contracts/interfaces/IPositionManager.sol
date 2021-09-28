pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


interface IPositionManager {
    function getCurrentPip() external view returns (int128);

    function getPendingOrderDetail(int128 pip, uint64 orderId) external view returns (
        bool isFilled,
        bool isBuy,
        uint256 size,
        uint256 partialFilled
    );

    function openLimitPosition(int128 pip, uint128 size, bool isBuy) external returns (uint256 orderId);

    function openMarketPosition(uint256 size, bool isBuy) external returns (uint256 sizeOut);

    function getPrice() external view returns (uint256);

    function getQuoteAsset() external view returns (IERC20);

    function calcAdjustMargin(uint256 adjustMargin) external view returns (uint256);

}
