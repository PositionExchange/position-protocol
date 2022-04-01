// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../../interfaces/IPositionManager.sol";
import "../libraries/helpers/Quantity.sol";
import "./LimitOrder.sol";
import "../libraries/types/PositionHouseStorage.sol";
import "../libraries/types/MarketMaker.sol";

abstract contract MarketMakerLogic is OwnableUpgradeable {
    using Quantity for int256;
    mapping(address => bool) private _whitelist;

    //    event MMWhitelistChanged(address addr, bool value);

    modifier onlyMMWhitelist() {
        require(isMarketMaker(msg.sender), "!MMW");
        _;
    }

    function setMMWhitelist(address addr, bool status) external onlyOwner {
        _whitelist[addr] = status;
        //        emit MMWhitelistChanged(addr, status);
    }

    function marketMakerFill(
        IPositionManager _positionManager,
        MarketMaker.MMFill[] memory _mmFills,
        uint256 _leverage
    ) external onlyMMWhitelist {
        _positionManager.marketMakerFill(_mmFills, _leverage);
    }

    function supplyFresh(
        IPositionManager _positionManager,
        MarketMaker.MMCancelOrder[] memory _cOrders,
        MarketMaker.MMOrder[] memory _oOrders,
        uint256 _leverage
    ) external onlyMMWhitelist {
        _positionManager.marketMakerRemove(_cOrders);
        _positionManager.marketMakerSupply(_oOrders, _leverage);
    }

    function remove(
        IPositionManager _positionManager,
        MarketMaker.MMCancelOrder[] memory _orders
    ) external onlyMMWhitelist {
        _positionManager.marketMakerRemove(_orders);
    }

    function supply(
        IPositionManager _positionManager,
        MarketMaker.MMOrder[] memory _orders,
        uint16 _leverage
    ) external onlyMMWhitelist {
        _positionManager.marketMakerSupply(_orders, _leverage);
    }

    function isMarketMaker(address addr) public view returns (bool) {
        return _whitelist[addr];
    }

    function min(uint256 a, uint256 b) private pure returns (uint256) {
        if (a == 0) return b;
        if (b == 0) return a;
        return a > b ? b : a;
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[49] private __gap;
}
