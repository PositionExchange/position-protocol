pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract PositionBUSDBonus is ERC20, Ownable {
    mapping(address => bool) public _transferableAddresses;
    mapping(address => bool) internal _mintableAddresses;

    event TransferableAddressesUpdated(address transferableAddress,bool isTransferableAddress);
    event MintableAddressesUpdated(address mintableAddress, bool isMintableAddress);

    modifier onlyMintable(address _address) {
        require(isMintableAddress(_address), "Only Mintable Address");
        _;
    }

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        updateMintableAddress(msg.sender,true);
    }

    function mint(address recipient, uint256 amount) public onlyMintable(msg.sender){
        _mint(recipient,amount);
    }

    function _spendAllowance(
        address owner,
        address spender,
        uint256 amount
    ) internal override virtual {
        require(isTransferableAddress(spender), "Only Transferable Address");
    }

    function allowance(address owner, address spender) public view virtual override returns (uint256) {
        return type(uint256).max;
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override virtual {
        if (from != address(0)) {
            require(isTransferableAddress(from) || isTransferableAddress(to), "Only Transferable Address");
        }
    }

    function updateMintableAddress(address _address, bool _isMintable) public onlyOwner
    {
        _mintableAddresses[_address] = _isMintable;
        emit MintableAddressesUpdated(_address, _isMintable);
    }

    function updateTransferableAddress(address _address, bool _isTransferable) public onlyOwner
    {
        _transferableAddresses[_address] = _isTransferable;
        emit TransferableAddressesUpdated(_address, _isTransferable);
    }

    function isTransferableAddress(address _address) public view returns (bool)
    {
        return _transferableAddresses[_address];
    }

    function isMintableAddress(address _address) public view returns (bool)
    {
        return _mintableAddresses[_address];
    }
}
