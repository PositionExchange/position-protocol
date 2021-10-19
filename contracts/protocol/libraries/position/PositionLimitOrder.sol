pragma solidity ^0.8.0;
import "./Position.sol";
import "hardhat/console.sol";

library PositionLimitOrder {
    enum OrderType {
        OPEN_LIMIT,
        CLOSE_LIMIT
    }
    struct Data {
        int128 pip;
        uint64 orderId;
        uint16 leverage;
        OrderType typeLimitOrder;
        // TODO add blockNumber open create a new struct
        uint8 isBuy;
        uint8 isSelfFilled;
    }

    function checkFilledToSelfOrders(
        mapping(address => mapping(address => PositionLimitOrder.Data[])) storage limitOrderMap,
        address _positionManager,
        address _trader,
        int128 startPip,
        int128 endPip,
        uint8 side
    ) internal {
        console.log("current pip, before pip", uint256(uint128(endPip)), uint256(uint128(startPip)), uint256(side) );
        uint256 gasBefore = gasleft();
        if(startPip != endPip){
            // check if fill to self limit orders
            PositionLimitOrder.Data[] memory listLimitOrder = limitOrderMap[address(_positionManager)][_trader];
            // TODO set self filled quantity
            for(uint256 i; i<listLimitOrder.length; i++){
                PositionLimitOrder.Data memory limitOrder = listLimitOrder[i];
                //            (bool isFilled,,,) = _positionManager.getPendingOrderDetail(listLimitOrder[i].pip, listLimitOrder[i].orderId);
                console.log("order pip", uint256(uint128(limitOrder.pip)));
                if(limitOrder.isBuy == 1 && side == uint8(Position.Side.SHORT)){
                    if(endPip <= limitOrder.pip && startPip >= limitOrder.pip){
                        limitOrderMap[address(_positionManager)][_trader][i].isSelfFilled = 1;
                    }
                }
                if(limitOrder.isBuy == 2 && side == uint8(Position.Side.LONG)){
                    if(endPip >= limitOrder.pip){
                        limitOrderMap[address(_positionManager)][_trader][i].isSelfFilled = 1;
                    }
                }
            }
        }
        console.log("gas spent", gasBefore - gasleft());
    }

}
