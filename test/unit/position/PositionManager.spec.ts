import {ethers} from 'hardhat';
import BigNumber from 'BigNumber.js'
import {expect} from 'chai';
import {PositionManager} from "../../../typeChain/PositionManager"

describe('Position Manager',async function () {
    let positionManager: PositionManager;
   beforeEach(async () => {
       const factory = await ethers.getContractFactory("PositionManager")
       positionManager = (await factory.deploy()) as unknown as PositionManager
   })

    async function createLimitOrder(pip: number, size: number, isBuy: boolean){
       return positionManager.openLimitPosition(pip, size, isBuy);
    }
    async function createLimitOrderAndVerify(pip: number, size: number, isBuy: boolean) {
        const orderId = await createLimitOrder(pip, size, isBuy);
        const hasLiquidity = await positionManager.hasLiquidity(pip)
        expect(hasLiquidity).eq(true, `Pip #${pip}`)
        return orderId
    }

    async function marketBuy(size: number, isBuy: boolean = true) {
       return positionManager.openMarketPosition(size, isBuy)
    }

    it('should create limit order', async function () {
        await createLimitOrderAndVerify(105, 10, true)
        await createLimitOrderAndVerify(100, 10, true)
        await createLimitOrderAndVerify(90, 10, true)
        await createLimitOrderAndVerify(110, 10, true)
    });

    it('should not fill any orders', async function () {
        // create limit order
        await createLimitOrderAndVerify(90, 10, true)
        const sizeOut = await marketBuy(8, true)
        // should not fill any orders
        expect(sizeOut).eq(0)
    });
    it('should fill buy limit order success', async function () {
        // sell at pip 90
        const sellPip = 90
        const orderId = await createLimitOrderAndVerify(sellPip, 10, false);
        // market buy
        const sizeOut = await marketBuy(8)
        // should fill the market order
        expect(sizeOut).eq(8)
        console.log("Start Send Market order")
        // limit order should partial fill
        const orderDetail = await positionManager.getPendingOrderDetail(sellPip, orderId.toString());
        expect(orderDetail.size).eq(2)
    });
});

