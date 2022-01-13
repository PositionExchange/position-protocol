pragma solidity ^0.8.0;

interface IPositionToken {
    function BASE_MINT() external view returns (uint256);

    function mint(address receiver, uint256 amount) external;

    function burn(uint256 amount) external;

    function treasuryTransfer(
        address[] memory recipients,
        uint256[] memory amounts
    ) external;

    function treasuryTransfer(address recipient, uint256 amount) external;

    function transferTaxRate() external view returns (uint16);

    function balanceOf(address account) external view returns (uint256);

    function transfer(address to, uint256 value) external returns (bool);

    function isGenesisAddress(address account) external view returns (bool);
}
