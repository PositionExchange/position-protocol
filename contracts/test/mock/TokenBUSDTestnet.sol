// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

contract TokenBUSDTestnet is ERC20Upgradeable, ReentrancyGuardUpgradeable,
PausableUpgradeable,
OwnableUpgradeable {
    mapping(address => bool) public _transferableAddresses;
    mapping(address => bool) internal _mintableAddresses;
    mapping(address => bool) public claimedAddress;

    uint256 claimableAmount;

    event TransferableAddressesUpdated(address transferableAddress,bool isTransferableAddress);
    event MintableAddressesUpdated(address mintableAddress, bool isMintableAddress);

    modifier onlyMintable() {
        require(isMintableAddress(msg.sender), "Only Mintable Address");
        _;
    }

    function initialize()  public initializer {
        __ERC20_init("BUSD Position Exchange Test Token", "TBUSD");
        __ReentrancyGuard_init();
        __Ownable_init();
        __Pausable_init();

        updateMintableAddress(msg.sender,true);
        updateTransferableAddress(msg.sender,true);
        claimableAmount = 10_000 * 10 ** decimals();
    }

    function mint(address recipient, uint256 amount) public onlyMintable(){
        _mint(recipient, amount);
    }

    function burn(uint256 amount) public {
        _burn(msg.sender, amount);
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

    function updateClaimableAmount(uint256 _amount) public onlyOwner
    {
        claimableAmount = _amount;
    }

    function isTransferableAddress(address _address) public view returns (bool)
    {
        return _transferableAddresses[_address];
    }

    function isMintableAddress(address _address) public view returns (bool)
    {
        return _mintableAddresses[_address];
    }

    function isClaim(address user) public view returns (bool)
    {
        return claimedAddress[user];
    }

    function claim() public {
        address claimer = msg.sender;
        require(claimedAddress[claimer] != true, "already claimed");
        _mint(claimer, claimableAmount);
        claimedAddress[claimer] = true;
    }
}
