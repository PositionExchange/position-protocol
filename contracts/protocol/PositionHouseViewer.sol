// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../interfaces/IPositionHouse.sol";
import "./libraries/position/Position.sol";
import "./libraries/types/PositionHouseStorage.sol";
import {PositionHouseFunction} from "./libraries/position/PositionHouseFunction.sol";

contract PositionHouseViewer is Initializable, OwnableUpgradeable {
    IPositionHouse positionHouse;
    function initialize(IPositionHouse _positionHouse) public initializer {
        __Ownable_init();
        positionHouse = _positionHouse;
    }

    function getClaimAmount(address _pmAddress, address _trader)
    public
    view
    returns (int256 totalClaimableAmount)
    {
        Position.Data memory positionData = positionHouse.getPosition(_pmAddress, _trader);
        return
        PositionHouseFunction.getClaimAmount(
            _pmAddress,
            _trader,
            positionData,
            positionHouse.positionMap(_pmAddress, _trader),
            positionHouse._getLimitOrders(_pmAddress, _trader),
            positionHouse._getReduceLimitOrders(_pmAddress, _trader),
            positionHouse.getClaimableAmount(_pmAddress, _trader),
            positionHouse._getManualMargin(_pmAddress, _trader)
        );
    }

    function getListOrderPending(
        IPositionManager _positionManager,
        address _trader
    ) public view returns (PositionHouseStorage.LimitOrderPending[] memory) {
        address _pmAddress = address(_positionManager);
        return
        PositionHouseFunction.getListOrderPending(
            _pmAddress,
            _trader,
            positionHouse._getLimitOrders(_pmAddress, _trader),
            positionHouse._getReduceLimitOrders(_pmAddress, _trader)
        );
    }


}
