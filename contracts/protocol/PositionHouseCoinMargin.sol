// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;

import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "../interfaces/IPositionManager.sol";
import "./libraries/position/Position.sol";
import "./bases/PositionHouseBase.sol";
import "./modules/LimitOrder.sol";
import {Errors} from "./libraries/helpers/Errors.sol";
import {MarketMakerLogic} from "./modules/MarketMaker.sol";

contract PositionHouseCoinMargin is PositionHouseBase
{
    // map pair manager address to price of contract
    mapping (address => uint256) public contractPrice;

    function setContractPrice(address _pmAddress, uint256 _contractPrice) external onlyOwner {
        contractPrice[_pmAddress] = _contractPrice;
    }

    function openMarketPosition(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _quantity,
        uint16 _leverage
    ) public override nonReentrant {
        uint256 _contractQuantity = calculateContractQuantity(address(_positionManager), _quantity);
        PositionHouseBase.openMarketPosition(
            _positionManager,
            _side,
            _contractQuantity,
            _leverage
        );
    }

    function openLimitOrder(
        IPositionManager _positionManager,
        Position.Side _side,
        uint256 _uQuantity,
        uint128 _pip,
        uint16 _leverage
    ) public override nonReentrant {
        uint256 _contractQuantity = calculateContractQuantity(address(_positionManager), _uQuantity);
        PositionHouseBase.openLimitOrder(
            _positionManager,
            _side,
            _contractQuantity,
            _pip,
            _leverage
        );
    }

    function closePosition(
        IPositionManager _positionManager,
        uint256 _quantity
    ) public override nonReentrant {
        uint256 _contractQuantity = calculateContractQuantity(address(_positionManager), _quantity);
        PositionHouseBase.closePosition(
            _positionManager,
            _contractQuantity
        );
    }

    function instantlyClosePosition(
        IPositionManager _positionManager,
        uint256 _quantity
    ) public override nonReentrant {
        uint256 _contractQuantity = calculateContractQuantity(address(_positionManager), _quantity);
        PositionHouseBase.instantlyClosePosition(
            _positionManager,
            _contractQuantity
        );
    }

    function closeLimitPosition(
        IPositionManager _positionManager,
        uint128 _pip,
        uint256 _quantity
    ) public override nonReentrant {
        uint256 _contractQuantity = calculateContractQuantity(address(_positionManager), _quantity);
        PositionHouseBase.closeLimitPosition(
            _positionManager,
            _pip,
            _contractQuantity
        );
    }

    function liquidate(
        IPositionManager _positionManager,
        address _trader
    ) public nonReentrant {
        uint256 _contractPrice = contractPrice[address(_positionManager)];
        PositionHouseBase._internalLiquidate(
            _positionManager,
            _trader,
            _contractPrice
        );
    }

    function supply(
        IPositionManager _positionManager,
        MarketMaker.MMOrder[] memory _orders,
        uint16 _leverage
    ) external override(MarketMakerLogic) onlyMMWhitelist {
        int256 _contractPrice = int256(contractPrice[address(_positionManager)]);
        for(uint i = 0; i < _orders.length; i++) {
            _orders[i].quantity = _orders[i].quantity * _contractPrice;
        }
        _positionManager.marketMakerSupply(_orders, _leverage);
    }

    function calculateContractQuantity(address _pmAddress, uint256 _quantity) internal returns (uint256 _contractQuantity){
        uint256 WEI = 10**18;
        // input quantity is cont, must be integer
        require(_quantity % WEI == 0, Errors.VL_MUST_BE_INTEGER);
        _contractQuantity = _quantity * contractPrice[_pmAddress];
    }

    function _deposit(
        address positionManager,
        address trader,
        uint256 amount,
        uint256 fee
    )
    internal override
    {
        IPositionManager(positionManager).deposit(trader, amount, fee);
    }

    function _withdraw(
        address positionManager,
        address trader,
        uint256 amount
    ) internal override
    {
        IPositionManager(positionManager).withdraw(trader, amount);
    }

    function _reduceBonus(
        address positionManager,
        address trader,
        uint256 amount
    ) internal override {
        return;
    }
}