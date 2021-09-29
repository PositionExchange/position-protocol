import {ethers} from 'hardhat';
import BigNumber from 'BigNumber.js'
import {expect} from 'chai';
import {PositionManager} from "../../typeChain/PositionManager"

describe('Position Manager', async function () {
    let positionManager: PositionManager;
    beforeEach(async () => {
        const factory = await ethers.getContractFactory("PositionManager")
        positionManager = (await factory.deploy(200, '0x8301f2213c0eed49a7e28ae4c3e91722919b8b47')) as unknown as PositionManager
    })

    async function createLimitOrder(pip: number, size: number, isBuy: boolean) {
        return positionManager.openLimitPosition(pip, size, isBuy);
    }

    async function createLimitOrderAndVerify(pip: number, size: number, isBuy: boolean) {
        const {liquidity: liquidityBefore} = await positionManager.tickPosition(pip)
        const pipPositionData = await positionManager.tickPosition(pip)
        const orderId = pipPositionData.currentIndex.add(1)
        await createLimitOrder(pip, size, isBuy);
        console.log(`Create limit order ${isBuy ? 'BUY' : 'SELL'}`, orderId.toNumber(), `SIZE: ${size} at ${pip}`)
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
    const shouldBuyMarketAndVerify = async function(size: number, expectOut: number, isBuy: boolean = true) {
        const [caller] = await ethers.getSigners()
        await expect(marketBuy(size, isBuy)).to.emit(positionManager, 'Swap')
            .withArgs(caller.address, size, expectOut)
    }
    const verifyLimitOrderDetail = async function(
        {pip, orderId, partialFilled, isFilled}: {pip: number, orderId: number, partialFilled: number, isFilled: boolean}
            = {
            partialFilled: 0,
            pip: 0,
            orderId: 0,
            isFilled: false
        }
    ) {
        const orderDetail = await positionManager.getPendingOrderDetail(pip, Number(orderId).toString());
        expect(orderDetail.partialFilled.toNumber()).eq(partialFilled, `Incorrect partial filled amount`)
        expect(orderDetail.isFilled).eq(isFilled, "Order not filled")
    }
    const checkLiquidityAtPip = async function(pip: number, hasLiquidity: boolean) {
        expect(await positionManager.hasLiquidity(pip)).eq(hasLiquidity, `!hasLiquidity pip: ${pip}`)
    }
    const shouldReachPip = async function(pip: number){
        expect((await positionManager.getCurrentPip()).toNumber()).eq(pip)
    }
    async function createLimitOrderInPipRanges(pipRanges: number[], size: number[], isBuy = false) {
        const orders = []
        for(let i in pipRanges) {
            const orderId = await createLimitOrderAndVerify(pipRanges[i], size[i], isBuy)
            orders.push([pipRanges[i], orderId])
        }
        return orders
    }
    interface CreateMarketOrderAndVerifyAfterArg {
        size: number;
        sizeOut: number
        pips: number[]
        pipsHasLiquidity: boolean[]
        reachPip: number
        orders?: number[][]
        partialFilledAmounts?: number[]
        isFilledAmounts?: boolean[],
        isBuy?: boolean
    }
    async function createMarketOrderAndVerifyAfter(
        {
            size,
            sizeOut,
            pips,
            pipsHasLiquidity,
            reachPip,
            orders,
            partialFilledAmounts,
            isFilledAmounts,
            isBuy = true
        }: CreateMarketOrderAndVerifyAfterArg
    ) {
        await shouldBuyMarketAndVerify(size, sizeOut, isBuy)
        for(let i in pipsHasLiquidity){
            await checkLiquidityAtPip(pips[i], pipsHasLiquidity[i])
        }
        if(orders && partialFilledAmounts && isFilledAmounts && orders.length > 0)
            for(let orderIndex in orders){
                await verifyLimitOrderDetail({
                    pip: orders[orderIndex][0],
                    orderId: orders[orderIndex][1],
                    partialFilled: partialFilledAmounts[orderIndex],
                    isFilled: isFilledAmounts[orderIndex]
                })
            }

        await shouldReachPip(reachPip)
    }
    describe('single market buy limit sell', function () {

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
            await shouldBuyMarketAndVerify(8, 0)
        });
        it('should fulfill buy market and partial fill limit sell order success', async function () {
            // sell limit size: 10 at 240
            // buy market 8
            const sellPip = 240
            const orderId = await createLimitOrderAndVerify(sellPip, 10, false);
            // market buy
            const [caller] = await ethers.getSigners()
            await expect(marketBuy(8)).to.emit(positionManager, 'Swap')
                .withArgs(caller.address, 8, 8)
            // limit order should partial fill
            const orderDetail = await positionManager.getPendingOrderDetail(sellPip, Number(orderId).toString());
            console.log("orderDetail: ", orderDetail)
            expect(orderDetail.partialFilled.toNumber()).eq(8)
            expect((await positionManager.getCurrentPip()).toNumber()).eq(240)
        });

        it('should partial fill market order fulfill limit sell order', async function () {
            // sell limit size: 10 at 240
            // buy market 12
            const sellPip = 240
            const orderId = await createLimitOrderAndVerify(sellPip, 10, false);
            const [caller] = await ethers.getSigners()
            await expect(marketBuy(12)).to.emit(positionManager, 'Swap')
                .withArgs(caller.address, 12, 10)
            expect(await positionManager.hasLiquidity(sellPip)).eq(false)
            const orderDetail = await positionManager.getPendingOrderDetail(sellPip, Number(orderId).toString());
            expect(orderDetail.partialFilled.toNumber()).eq(0)
            expect(orderDetail.isFilled).eq(true)
            expect((await positionManager.getCurrentPip()).toNumber()).eq(240)
        });
        it('should fulfill market and single limit order', async function () {
            // sell limit size: 10 at 240
            // buy market 10
            const sellPip = 240
            const orderId = await createLimitOrderAndVerify(sellPip, 10, false);
            const [caller] = await ethers.getSigners()
            await expect(marketBuy(10)).to.emit(positionManager, 'Swap')
                .withArgs(caller.address, 10, 10)
            expect(await positionManager.hasLiquidity(sellPip)).eq(false)
            const orderDetail = await positionManager.getPendingOrderDetail(sellPip, Number(orderId).toString());
            expect(orderDetail.partialFilled.toNumber()).eq(0)
            expect(orderDetail.isFilled).eq(true)
            expect((await positionManager.getCurrentPip()).toNumber()).eq(240)
        });


        describe('should fulfill market and multiple limit orders', async function () {
            let orderIds = {} as any, pips = [240, 241, 242]
            beforeEach(async () => {
                // create 3 sell limit orders
                const sizes = [5,3,2]
                for(const i in pips){
                    orderIds[pips[i]] = (await createLimitOrderAndVerify(pips[i], sizes[i], false))
                }
            })
            it('should fulfill market and multiple limit orders 1.1', async function () {
                // 3 limit orders at:
                // 240: 5
                // 241: 3
                // 242: 2
                // buy market: 5 -> out 5
                // price should reach 241. fulfill pip 240
                await shouldBuyMarketAndVerify(5, 5)
                await verifyLimitOrderDetail({
                    pip: 240,
                    orderId: orderIds[240],
                    partialFilled: 0,
                    isFilled: true
                })
                await verifyLimitOrderDetail({
                    pip: 241,
                    orderId: orderIds[241],
                    partialFilled: 0,
                    isFilled: false
                })
                await verifyLimitOrderDetail({
                    pip: 242,
                    orderId: orderIds[242],
                    partialFilled: 0,
                    isFilled: false
                })
                await checkLiquidityAtPip(240, false)
                await checkLiquidityAtPip(241, true)
                await checkLiquidityAtPip(242, true)
                await shouldReachPip(240)
            });
            it('should fulfill market and multiple limit orders 1', async function () {
                // 3 limit orders at:
                // 240: 5
                // 241: 3
                // 242: 2
                // buy market: 8 -> out 8
                // price should reach 241. fulfill pip 240, 241
                await shouldBuyMarketAndVerify(8, 8)
                await checkLiquidityAtPip(240, false)
                await checkLiquidityAtPip(241, false)
                await checkLiquidityAtPip(242, true)
                await verifyLimitOrderDetail({
                    pip: 240,
                    orderId: orderIds[240],
                    partialFilled: 0,
                    isFilled: true
                })
                await verifyLimitOrderDetail({
                    pip: 241,
                    orderId: orderIds[241],
                    partialFilled: 0,
                    isFilled: true
                })
                await verifyLimitOrderDetail({
                    pip: 242,
                    orderId: orderIds[242],
                    partialFilled: 0,
                    isFilled: false
                })
                await shouldReachPip(241)
            });

            it('should fulfill market and multiple limit orders 2', async function () {
                // 3 limit orders at:
                // 240: 5
                // 241: 3
                // 242: 2
                // buy market: 9 -> out 9
                // price should reach 241. fulfill pip 240, 241, partial fill 242
                await shouldBuyMarketAndVerify(9, 9)
                await verifyLimitOrderDetail({
                    pip: 240,
                    orderId: orderIds[240],
                    partialFilled: 0,
                    isFilled: true
                })
                await verifyLimitOrderDetail({
                    pip: 241,
                    orderId: orderIds[241],
                    partialFilled: 0,
                    isFilled: true
                })
                await verifyLimitOrderDetail({
                    pip: 242,
                    orderId: orderIds[242],
                    partialFilled: 1,
                    isFilled: false
                })
                await checkLiquidityAtPip(240, false)
                await checkLiquidityAtPip(241, false)
                await checkLiquidityAtPip(242, true)
                await shouldReachPip(242)
            });
            it('should fulfill market and multiple limit orders 3', async function () {
                // 3 limit orders at:
                // 240: 5
                // 241: 3
                // 242: 2
                // buy market: 10 -> out 10
                // price should reach 241. fulfill pip 240, 241, 242
                await shouldBuyMarketAndVerify(10, 10)
                await verifyLimitOrderDetail({
                    pip: 240,
                    orderId: orderIds[240],
                    partialFilled: 0,
                    isFilled: true
                })
                await verifyLimitOrderDetail({
                    pip: 241,
                    orderId: orderIds[241],
                    partialFilled: 0,
                    isFilled: true
                })
                await verifyLimitOrderDetail({
                    pip: 242,
                    orderId: orderIds[242],
                    partialFilled: 0,
                    isFilled: true
                })
                await checkLiquidityAtPip(240, false)
                await checkLiquidityAtPip(241, false)
                await checkLiquidityAtPip(242, false)
                await shouldReachPip(242)
            });
            it('should fulfill market and multiple limit orders 4', async function () {
                // 3 limit orders at:
                // 240: 5
                // 241: 3
                // 242: 2
                // buy market: 12 -> out 10, left: 2
                // price should reach 241. fulfill pip 240, 241, 242
                await shouldBuyMarketAndVerify(12, 10)
                await verifyLimitOrderDetail({
                    pip: 240,
                    orderId: orderIds[240],
                    partialFilled: 0,
                    isFilled: true
                })
                await verifyLimitOrderDetail({
                    pip: 241,
                    orderId: orderIds[241],
                    partialFilled: 0,
                    isFilled: true
                })
                await verifyLimitOrderDetail({
                    pip: 242,
                    orderId: orderIds[242],
                    partialFilled: 0,
                    isFilled: true
                })
                await checkLiquidityAtPip(240, false)
                await checkLiquidityAtPip(241, false)
                await checkLiquidityAtPip(242, false)
                await shouldReachPip(242)
            });
        });

    });
    describe('multiple market buys and multiple sell limit orders', function () {

        it('scenario 1', async function () {
            const pips = [220, 222, 230]
            const pipSizes = [10, 15, 20]
            const orders = await createLimitOrderInPipRanges(pips, pipSizes)
            await createMarketOrderAndVerifyAfter({
                sizeOut: 5,
                size: 5,
                pips,
                pipsHasLiquidity: [true, true, true],
                reachPip: 220,
                orders,
                partialFilledAmounts: [5, 0, 0],
                isFilledAmounts: [false, false, false]
            })
            await createLimitOrderAndVerify(220, 5, false)
            await createMarketOrderAndVerifyAfter({
                sizeOut: 5,
                size: 5,
                pips,
                pipsHasLiquidity: [true, true, true],
                reachPip: 220,
                orders,
                partialFilledAmounts: [5, 0, 0],
                isFilledAmounts: [false, false, false]
            })
            await createLimitOrderAndVerify(220, 5, false)
            await createMarketOrderAndVerifyAfter({
                sizeOut: 45,
                size: 50,
                pips,
                pipsHasLiquidity: [false, false, false],
                reachPip: 230,
                orders,
                partialFilledAmounts: [0, 0, 0],
                isFilledAmounts: [true, true, true]
            })
        });
    });
    describe('single market sell limit buy orders', function () {
        it('should test 1', async function () {
            const pips = [100, 101,102]
            const pipSizes = [10,20,30]
            const orders = await createLimitOrderInPipRanges(pips,pipSizes, true)
            await createMarketOrderAndVerifyAfter({
                sizeOut: 5,
                size: 5,
                pips,
                pipsHasLiquidity: [true, true, true],
                reachPip: 102,
                orders,
                partialFilledAmounts: [0, 0, 5],
                isFilledAmounts: [false, false, false],
                isBuy: false
            })
        });
        it('should test 2', async function () {
            const pips = [100, 101,102]
            const pipSizes = [10,20,30]
            const orders = await createLimitOrderInPipRanges(pips,pipSizes, true)
            await createMarketOrderAndVerifyAfter({
                sizeOut: 35,
                size:35,
                pips,
                pipsHasLiquidity: [true, true, false],
                reachPip: 101,
                orders,
                partialFilledAmounts: [0, 5, 0],
                isFilledAmounts: [false, false, true],
                isBuy: false
            })
        });
        it('should test 3', async function () {
            const pips = [100, 101,102]
            const pipSizes = [10,20,30]
            const orders = await createLimitOrderInPipRanges(pips,pipSizes, true)
            await createMarketOrderAndVerifyAfter({
                sizeOut: 60,
                size:60,
                pips,
                pipsHasLiquidity: [false, false, false],
                reachPip: 100,
                orders,
                partialFilledAmounts: [0, 0, 0],
                isFilledAmounts: [true, true, true],
                isBuy: false
            })
        });
        it('should test 4', async function () {
            const pips = [100, 101,102]
            const pipSizes = [10,20,30]
            const orders = await createLimitOrderInPipRanges(pips,pipSizes, true)
            await createMarketOrderAndVerifyAfter({
                sizeOut: 60,
                size:65,
                pips,
                pipsHasLiquidity: [false, false, false],
                reachPip: 100,
                orders,
                partialFilledAmounts: [0, 0, 0],
                isFilledAmounts: [true, true, true],
                isBuy: false
            })
        });
    });
    describe('buy sell in multiple ranges', async function () {
        it('should cross buy market in multiple ranges limit orders', async function () {
            const pips = [250, 253, 254, 255, 256, 257, 258]
            const pipSizes = [10, 10, 10, 10, 10, 10, 10]
            const orders = await createLimitOrderInPipRanges(pips, pipSizes)
            await createMarketOrderAndVerifyAfter({
                sizeOut: 60,
                size: 60,
                pips,
                pipsHasLiquidity: [false, false, false, false, false, false, true],
                reachPip: 257,
                orders,
                partialFilledAmounts: [...pips].fill(0),
                isFilledAmounts: [true, true, true, true, true, true, false]
            })
        });
        it('should cross sell market in multiple ranges limit orders', async function () {
            await createLimitOrderAndVerify(260, 10, false)
            await shouldBuyMarketAndVerify(10, 10, true)
            await checkLiquidityAtPip(260, false)
            const pips = [258, 257, 256, 255, 254, 253, 252]
            const pipSizes = [10, 10, 10, 10, 10, 10, 10]
            const orders = await createLimitOrderInPipRanges(pips, pipSizes, true)
            await createMarketOrderAndVerifyAfter({
                sizeOut: 50,
                size: 50,
                pips,
                pipsHasLiquidity: [false, false, false, false, false, true, true],
                reachPip: 254,
                orders,
                partialFilledAmounts: [...pips].fill(0),
                isFilledAmounts: [true, true, true, true, true, false, false],
                isBuy: false
            })
        });
    });
});

