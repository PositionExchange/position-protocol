import {PositionHouse, PositionManager} from "../../typeChain";
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
    const orderId = ((receipt?.events || [])[1]?.args || [])['orderId']
    const priceLimit = ((receipt?.events || [])[1]?.args || [])['priceLimit']
    return {
        orderId,
        priceLimit,
    }
}

export interface CloseLimitPositionParams {
    trader: SignerWithAddress
    price: number | string
    quantity: number | string
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

    constructor(positionHouse: PositionHouse, positionManager: PositionManager) {
        this.positionHouse = positionHouse;
        this.positionManager = positionManager
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
        const tx = await this.positionHouse.connect(_trader).openLimitOrder(_positionManager.address, side, quantity, priceToPip(Number(limitPrice)), leverage, true)
        const {orderId, priceLimit} = await getOrderIdByTx(tx)
        const orderDetails = await this.getPendingOrder({orderId, pip: priceToPip(Number(limitPrice))})
        expect(orderDetails.isFilled).eq(false)
        return {
            orderId: orderId,
            pip: priceToPip(Number(limitPrice))
        } as LimitOrderReturns
    }

    async closeLimitPosition({trader, price, quantity}: CloseLimitPositionParams) {
        const tx = await this.positionHouse
            .connect(trader)
            .closeLimitPosition(
                this.positionManager.address,
                priceToPip(Number(price)),
                quantity
            );
        console.log("has liquidity",await this.positionManager.hasLiquidity(priceToPip(price)))
        const {orderId, priceLimit} = await getOrderIdByTx(tx)
        console.log("priceLimit", priceLimit)
        const orderDetails = await this.getPendingOrder({orderId, pip: priceToPip(Number(price))})
        expect(orderDetails.isFilled).eq(false)
        expect(orderDetails.size).eq(quantity)
        expect(orderDetails.partialFilled).eq(0)
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

    async canClaim({trader}: BasicParam): Promise<ClaimFund> {

        return (await this.positionHouse.canClaimFund(this.positionManager.address, trader.address)) as unknown as ClaimFund

    }

    async getPosition(trader: SignerWithAddress): Promise<PositionData> {

        return (await this.positionHouse.getPosition(this.positionManager.address, trader.address)) as unknown as PositionData;

    }

    async expectPositionData(trader: SignerWithAddress, {
        margin,
        quantity,
        notional
    }: any) {
        const positionData = (await this.getPosition(trader))
        margin && expect(positionData.margin.div('10000').toString()).eq(margin.toString());
        quantity && expect(positionData.quantity.toString()).eq(quantity.toString());
        notional && expect(positionData.openNotional.div('10000').toString()).eq(notional.toString());
    }

    async debugPosition(trader: SignerWithAddress){
        const positionInfo = await this.positionHouse.getPosition(this.positionManager.address, trader.address) as unknown as PositionData;
        // console.log("positionInfo", positionInfo)
        const currentPrice = Number((await this.positionManager.getPrice()).toString())
        const openNotional = positionInfo.openNotional.div('10000').toString()
        // expectedNotional = expectedNotional && expectedNotional.toString() || quantity.mul(price).toString()
        console.log(`debugPosition Position Info of ${trader}`)
        console.table([
            {
                openNotional: positionInfo.openNotional.toString(),
                openNotionalFormated: openNotional,
                currentPrice: currentPrice,
                quantity: positionInfo.quantity.toString(),
                margin: positionInfo.margin.div('10000').toString()
            }
        ])
    }

    async getMaintenanceDetail({trader}: BasicParam): Promise<MaintenanceDetail> {


        return (await this.positionHouse.getMaintenanceDetail(this.positionManager.address, trader.address)) as unknown as MaintenanceDetail;

    }

    async getPendingOrder({pip, orderId}: PendingOrderParam): Promise<PendingOrder> {

        return (await this.positionHouse.getPendingOrder(this.positionManager.address, pip.toString(), orderId.toString())) as unknown as PendingOrder;

    }


}