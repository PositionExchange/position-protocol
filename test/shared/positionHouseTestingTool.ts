import {PositionHouse, PositionHouseViewer, PositionManager} from "../../typeChain";
import {BigNumber} from "ethers";
import {
    ClaimFund,
    LimitOrderReturns, MaintenanceDetail,
    OpenLimitPositionAndExpectParams,
    OpenMarketPositionParams, PendingOrder,
    PositionData,
    priceToPip
} from "./utilities";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";

async function getOrderIdByTx(tx: any) {
    const receipt = await tx.wait();
    const orderId = ((receipt?.events || [])[1]?.args || [])['orderIdInPip']
    const priceLimit = ((receipt?.events || [])[1]?.args || [])['priceLimit']
    return {
        orderId,
        priceLimit,
    }
}

export interface CloseLimitPositionParams {
    trader: SignerWithAddress
    price: number | string
    percentQuantity: number | string
}

export interface CloseMarketPositionParams {
    trader: SignerWithAddress,
    _positionManager?: any,
    _percentQuantity?: any
}

export interface BasicParam {
    trader: SignerWithAddress
}

export interface PendingOrderParam {
    pip: number | string,
    orderId: number | string

}


export default class PositionHouseTestingTool {
    private positionHouse: PositionHouse;
    private positionManager: PositionManager;
    private positionHouseViewer: PositionHouseViewer;

    constructor(positionHouse: PositionHouse, positionManager: PositionManager, positionHouseViewer: PositionHouseViewer) {
        this.positionHouse = positionHouse;
        this.positionManager = positionManager;
        this.positionHouseViewer = positionHouseViewer
    }

    async openMarketPosition({
                                 quantity,
                                 leverage,
                                 side,
                                 trader,
                                 instanceTrader,
                                 expectedMargin,
                                 expectedNotional,
                                 expectedSize,
                                 price = 5000,
                                 _positionManager = this.positionManager
                             }: OpenMarketPositionParams) {
        trader = instanceTrader && instanceTrader.address || trader
        if (!trader) throw new Error("No trader")
        await this.positionHouse.connect(instanceTrader).openMarketPosition(
            _positionManager.address,
            side,
            quantity,
            leverage,
        )

        const positionInfo = await this.positionHouse.getPosition(_positionManager.address, trader) as unknown as PositionData;
        const currentPrice = Number((await _positionManager.getPrice()).toString())
        const openNotional = positionInfo.openNotional.div('10000').toString()
        expectedNotional = expectedNotional && expectedNotional.toString() || quantity.mul(price).toString()
        expect(positionInfo.quantity.toString()).eq((expectedSize || quantity).toString())
    }

    async openLimitPositionAndExpect({
                                         _trader,
                                         limitPrice,
                                         leverage,
                                         quantity,
                                         side,
                                         _positionManager
                                     }: OpenLimitPositionAndExpectParams) {
        _positionManager = _positionManager || this.positionManager
        const [trader0] = await ethers.getSigners()
        _trader = _trader || trader0;
        if (!_positionManager) throw Error("No position manager")
        if (!_trader) throw Error("No trader")
        const tx = await this.positionHouse.connect(_trader).openLimitOrder(_positionManager.address, side, quantity, priceToPip(Number(limitPrice)), leverage, )
        const {orderId, priceLimit} = await getOrderIdByTx(tx)
        // const orderDetails = await this.getPendingOrder({orderId, pip: priceToPip(Number(limitPrice))})
        // expect(orderDetails.isFilled).eq(false)
        // return {
        //     orderId: orderId,
        //     pip: priceToPip(Number(limitPrice))
        // } as LimitOrderReturns
    }

    async closeLimitPosition({trader, price, percentQuantity}: CloseLimitPositionParams) {
        const tx = await this.positionHouse
            .connect(trader)
            .closeLimitPosition(
                this.positionManager.address,
                priceToPip(Number(price)),
                percentQuantity
            );
        console.log("has liquidity",await this.positionManager.hasLiquidity(priceToPip(price)))
        const {orderId, priceLimit} = await getOrderIdByTx(tx)
        console.log("priceLimit", priceLimit)
        // const orderDetails = await this.getPendingOrder({orderId, pip: priceToPip(Number(price))})
        // expect(orderDetails.isFilled).eq(false)
        // // expect(orderDetails.size).eq(quantity)
        // expect(orderDetails.partialFilled).eq(0)
        return {
            orderId,
            pip: priceToPip(Number(price))
        } as LimitOrderReturns
    }

    async closeMarketPosition({trader, _percentQuantity}: CloseMarketPositionParams) {
        const positionData1 = (await this.positionHouse.connect(trader).getPosition(this.positionManager.address, trader.address)) as unknown as PositionData;
        await this.positionHouse.connect(trader).closePosition(this.positionManager.address, _percentQuantity);

        const positionData = (await this.positionHouse.getPosition(this.positionManager.address, trader.address)) as unknown as PositionData;
        expect(positionData.margin).eq(0);
        expect(positionData.quantity).eq(0);
    }

    async liquidate({trader}: BasicParam) {
        await this.positionHouse.liquidate(this.positionManager.address, trader.address);

    }

    // async canClaim({trader}: BasicParam): Promise<ClaimFund> {
    //
    //     // return (await this.positionHouse.canClaimFund(this.positionManager.address, trader.address)) as unknown as ClaimFund
    //
    // }

    async getPosition(trader: SignerWithAddress): Promise<PositionData> {

        return (await this.positionHouse.getPosition(this.positionManager.address, trader.address)) as unknown as PositionData;

    }

    async expectPositionData(trader: SignerWithAddress, {
        margin,
        quantity,
        notional
    }: any) {
        const positionData = (await this.getPosition(trader))
        margin && expect(positionData.margin.toString()).eq(margin.toString());
        quantity && expect(positionData.quantity.toString()).eq(quantity.toString());
        notional && expect(positionData.openNotional.toString()).eq(notional.toString());
    }

    async debugPosition(trader: SignerWithAddress){
        const positionInfo = await this.positionHouse.getPosition(this.positionManager.address, trader.address) as unknown as PositionData;
        // console.log("positionInfo", positionInfo)
        const currentPrice = Number((await this.positionManager.getPrice()).div('10000').toString())
        const openNotional = positionInfo.openNotional.div('10000').toString()
        // expectedNotional = expectedNotional && expectedNotional.toString() || quantity.mul(price).toString()
        console.log(`debugPosition Position Info of ${trader.address}`)
        const oldPosition = await this.positionHouse.getPosition(this.positionManager.address, trader.address)
        const pnl = await this.positionHouseViewer.getPositionNotionalAndUnrealizedPnl(this.positionManager.address, trader.address,0, oldPosition)
        console.table([
            {
                openNotional: openNotional,
                currentPrice: currentPrice,
                quantity: positionInfo.quantity.toString(),
                margin: positionInfo.margin.div('10000').toString(),
                unrealizedPnl: pnl.unrealizedPnl.div('10000').toString(),
                entryPrice: positionInfo.openNotional.div(positionInfo.quantity.abs()).div('10000').toString()
            }
        ])
    }

    async getMaintenanceDetail({trader}: BasicParam): Promise<MaintenanceDetail> {

        const calcOptionSpot = 1
        return (await this.positionHouseViewer.getMaintenanceDetail(this.positionManager.address, trader.address, calcOptionSpot)) as unknown as MaintenanceDetail;

    }

    // async getPendingOrder({pip, orderId}: PendingOrderParam): Promise<PendingOrder> {
    //
    //     return (await this.positionHouse.getPendingOrder(this.positionManager.address, pip.toString(), orderId.toString())) as unknown as PendingOrder;
    //
    // }


    /*
     * Pump price when empty order book
     */
    async pumpPrice({toPrice, pumper, pumper2} : any) {
        await this.openLimitPositionAndExpect({
            _trader: pumper, leverage: 10, limitPrice: toPrice, quantity: 1, side: 1
        })
        await this.openMarketPosition({
            instanceTrader: pumper2, leverage: 10, quantity: BigNumber.from('1'), side: 0, expectedSize: BigNumber.from('1')
        })
    }

    async dumpPrice() {

    }


}