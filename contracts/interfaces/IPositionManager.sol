pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


interface IPositionManager {
    function getCurrentPip() external view returns (uint128);

    function getBaseBasisPoint() external view returns (uint256);

    function getCurrentSingleSlot() external view returns (uint128, uint8);

    function getLiquidityInCurrentPip() external view returns (uint128);

    function updatePartialFilledOrder(uint128 pip, uint64 orderId) external;

    function getPendingOrderDetail(uint128 pip, uint64 orderId) external view returns (
        bool isFilled,
        bool isBuy,
        uint256 size,
        uint256 partialFilled
    );

    function openLimitPosition(uint128 pip, uint128 size, bool isBuy) external returns (uint64 orderId, uint256 sizeOut, uint256 openNotional);

    function openMarketPosition(uint256 size, bool isBuy) external returns (uint256 sizeOut, uint256 openNotional);

    function getPrice() external view returns (uint256);

    function pipToPrice(uint128 pip) external view returns (uint256);

    function getQuoteAsset() external view returns (IERC20);

    function calcAdjustMargin(uint256 adjustMargin) external view returns (uint256);

    function calcFee(uint256 _positionNotional) external view returns (uint256);

    function cancelLimitOrder(uint128 pip, uint64 orderId) external returns (uint256);

    function settleFunding() external returns (int256 premiumFraction);

    function open() external view returns (bool);
}
