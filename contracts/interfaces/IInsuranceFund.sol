pragma solidity ^0.8.0;

interface IInsuranceFund {
    function deposit(
        address token,
        address trader,
        uint256 amount
    ) external;

    function withdraw(
        address token,
        address trader,
        uint256 amount
    ) external;

    function buyBackAndBurn(address token, uint256 amount) external;

    function transferFeeFromTrader(
        address token,
        address trader,
        uint256 amountFee
    ) external;

    function updateTotalFee(uint256 fee) external;
}
