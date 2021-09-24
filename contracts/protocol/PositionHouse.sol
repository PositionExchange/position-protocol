pragma solidity ^0.8.0;

import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import "../interfaces/IPositionManager.sol";

contract PositionHouse is
    Context
{

    enum Side {BUY, SELL}

    modifier whenNotPause(){
        //TODO implement
        _;
    }

    function openMarketPosition(
        IPositionManager positionManager,
        Side side,
        uint256 size,
        uint256 leverage
    ) external whenNotPause nonReentrant {
       //check input
       address trader = _msgSender();
       bool isNewPosition = true;
        if(isNewPosition){

        }else{
            //adjust old position
        }
    }

    function openLimitPosition() external {
    }
}
