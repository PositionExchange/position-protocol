import {PositionManager} from "../../typeChain";
import {LimitOrderReturns, PositionLimitOrderID} from "./utilities";
import {expect} from "chai";

export default class PositionManagerTestingTool {
    private positionManager: PositionManager;

    constructor(positionManager: PositionManager) {
        this.positionManager = positionManager;
    }


    async expectPendingOrderByLimitOrderResponse({pip, orderId}: LimitOrderReturns | PositionLimitOrderID, {isFilled, isBuy, size, partialFilled} : any ){
        return this.expectPendingOrder({
            pip, orderId, isFilled, isBuy, size, partialFilled
        })
    }

    async expectPendingOrder({ pip, orderId, isFilled, isBuy, size, partialFilled} : any){
        console.log("line 20 expect pending", pip, orderId)
        const res = await this.positionManager.getPendingOrderDetail(pip, orderId)
        typeof isFilled != 'undefined' && expect(res.isFilled).eq(isFilled, `isFilled is not correct`)
        typeof isBuy != 'undefined' && expect(res.isBuy).eq(isBuy)
        typeof size != 'undefined' && expect(res.size.toString()).eq(size.toString(), `Size is not correct`)
        typeof partialFilled != 'undefined' && expect(res.partialFilled.toString()).eq(partialFilled.toString(), `Partial filled is not correct`)
    }

    async debugPendingOrder(pip: any, orderId: any) {
        const res = await this.positionManager.getPendingOrderDetail(pip, orderId)
        console.table([
            {
                pip,
                orderId: orderId.toString(),
                isFilled: res.isFilled,
                isBuy: res.isBuy,
                size: res.size.toString(),
                partialFilled: res.partialFilled.toString(),
            }
        ])
    }
}