import {ethers} from 'hardhat';
import BigNumber from 'BigNumber.js'
import {expect} from 'chai';
import {PositionManager} from "../../../typeChain/PositionManager"

describe('Position Manager', async function () {
    let positionManager: PositionManager;
    beforeEach(async () => {
        const factory = await ethers.getContractFactory("PositionManager")
        positionManager = (await factory.deploy(200)) as unknown as PositionManager
    })

    async function createLimitOrder(pip: number, size: number, isBuy: boolean) {
        return positionManager.openLimitPosition(pip, size, isBuy);
    }

    async function createLimitOrderAndVerify(pip: number, size: number, isBuy: boolean) {
        const {liquidity: liquidityBefore} = await positionManager.tickPosition(pip)
        const pipPositionData = await positionManager.tickPosition(pip)
        const orderId = pipPositionData.currentIndex.add(1)
        await createLimitOrder(pip, size, isBuy);
        console.log("orderId: ", orderId.toNumber())
        const hasLiquidity = await positionManager.hasLiquidity(pip)
        expect(hasLiquidity).eq(true, `Pip #${pip}`)
        const {liquidity} = await positionManager.tickPosition(pip)
        expect(liquidity.sub(liquidityBefore).toNumber()).eq(size)
        const orderDetail = await positionManager.getPendingOrderDetail(pip, orderId.toNumber());
        expect(orderDetail.size.toNumber(), "size not match").eq(size)
        return orderId.toNumber()
    }

    async function marketBuy(size: number, isBuy: boolean = true) {
        return positionManager.openMarketPosition(size, isBuy)
    }

    it('should create limit order', async function () {
        await createLimitOrderAndVerify(105, 10, true)
        await createLimitOrderAndVerify(105, 15, true)
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
    it('should fulfill buy market and partial fill limit sell order success', async function () {
        const sellPip = 240
        const orderId = await createLimitOrderAndVerify(sellPip, 10, false);
        // market buy
        const [caller] = await ethers.getSigners()
        await expect(marketBuy(8)).to.emit(positionManager, 'Swap')
            .withArgs(caller.address, 8, 8)
        // limit order should partial fill
        const orderDetail = await positionManager.getPendingOrderDetail(sellPip, Number(orderId).toString());
        console.log("orderDetail: ", orderDetail)
        expect(orderDetail.partiallyFilled.toNumber()).eq(8)
        expect((await positionManager.getCurrentPip()).toNumber()).eq(240)
    });

    it('should partial fill market order fulfill limit sell order', async function () {
        const sellPip = 240
        const orderId = await createLimitOrderAndVerify(sellPip, 10, false);
        const [caller] = await ethers.getSigners()
        await expect(marketBuy(12)).to.emit(positionManager, 'Swap')
            .withArgs(caller.address, 12, 10)
        const orderDetail = await positionManager.getPendingOrderDetail(sellPip, Number(orderId).toString());
        console.log("orderDetail: ", orderDetail)
        expect(orderDetail.partiallyFilled.toNumber()).eq(0)
        expect(orderDetail.isFilled).eq(true)
        expect((await positionManager.getCurrentPip()).toNumber()).eq(240)
    });

});

