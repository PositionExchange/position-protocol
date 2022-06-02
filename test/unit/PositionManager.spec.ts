import {ethers} from 'hardhat';
import {BigNumber} from 'ethers'
import {expect} from 'chai';
import {PositionManager} from "../../typeChain/PositionManager"
import {BEP20Mintable} from "../../typeChain";

describe('Position Manager', async function () {
    let deployer: any;
    let positionManager: PositionManager;
    let bep20Mintable: BEP20Mintable
    beforeEach(async () => {
        [deployer] = await ethers.getSigners()

        // Deploy mock busd contract
        const bep20MintableFactory = await ethers.getContractFactory('BEP20Mintable')
        bep20Mintable = (await bep20MintableFactory.deploy('BUSD Mock', 'BUSD')) as unknown as BEP20Mintable

        const factory = await ethers.getContractFactory("PositionManagerTest")
        positionManager = (await factory.deploy()) as unknown as PositionManager
        await positionManager.initialize(BigNumber.from(200), bep20Mintable.address, ethers.utils.formatBytes32String('BTC'), BigNumber.from(100), BigNumber.from(10000), BigNumber.from(10000), BigNumber.from(3000), BigNumber.from(1000), '0x5741306c21795FdCBb9b265Ea0255F499DFe515C'.toLowerCase(), deployer.address);
    })

    async function createLimitOrder(pip: number, size: number | string, isBuy: boolean) {
        return positionManager.openLimitPosition(pip, size, isBuy);
    }

    async function createLimitOrderAndVerify(pip: number, size: number | string, isBuy: boolean) {
        const {liquidity: liquidityBefore} = await positionManager.tickPosition(pip)
        const pipPositionData = await positionManager.tickPosition(pip)
        const orderId = pipPositionData.currentIndex.add(1)
        await createLimitOrder(pip, size, isBuy);
        console.log(`Create limit order ${isBuy ? 'BUY' : 'SELL'}`, orderId.toNumber(), `SIZE: ${size} at ${pip}`)
        const hasLiquidity = await positionManager.hasLiquidity(pip)
        expect(hasLiquidity).eq(true, `Pip #${pip}`)
        const {liquidity} = await positionManager.tickPosition(pip)
        expect(liquidity.sub(liquidityBefore)).eq(size)
        const orderDetail = await positionManager.getPendingOrderDetail(pip, orderId.toNumber());
        expect(orderDetail.size, "size not match").eq(size)
        return orderId.toNumber()
    }

    async function marketBuy(size: number | string, isBuy: boolean = true) {
        return positionManager.openMarketPosition(size, isBuy)
    }

    const shouldBuyMarketAndVerify = async function (size: number, expectOut: number, isBuy: boolean = true) {
        const [caller] = await ethers.getSigners()
        const tx = await marketBuy(size, isBuy)
        const receipt = await ethers.provider.getTransactionReceipt(tx.hash)
        const interfaceEvent = new ethers.utils.Interface(["event MarketFilled(bool isBuy, uint256 indexed amount, uint128 toPip, uint256 passedPipCount, uint128 remainingLiquidity)"]);

        const data = receipt.logs[1].data
        const topics = receipt.logs[1].topics
        const event = interfaceEvent.decodeEventLog("MarketFilled", data, topics)
        expect(event.isBuy).to.equal(isBuy)
        expect(event.amount).to.equal(expectOut)
    }

    const shouldOpenLimitAndVerify = async function (pip: number, size: number, expectOut: number, isBuy: boolean = true) {
        const [caller] = await ethers.getSigners()
        const tx = await positionManager.openLimitPosition(pip, size, isBuy)
        const receipt = await ethers.provider.getTransactionReceipt(tx.hash)
        const interfaceEvent = new ethers.utils.Interface(["event MarketFilled(bool isBuy, uint256 indexed amount, uint128 toPip, uint256 passedPipCount, uint128 remainingLiquidity)"]);

        const data = receipt.logs[1].data
        const topics = receipt.logs[1].topics
        const event = interfaceEvent.decodeEventLog("MarketFilled", data, topics)
        expect(event.isBuy).to.equal(isBuy)
        expect(event.amount).to.equal(expectOut)
    }

    const verifyLimitOrderDetail = async function (
        {
            pip,
            orderId,
            partialFilled,
            isFilled
        }: { pip: number, orderId: number, partialFilled: number, isFilled: boolean }
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
    const checkLiquidityAtPip = async function (pip: number, hasLiquidity: boolean) {
        expect(await positionManager.hasLiquidity(pip)).eq(hasLiquidity, `!hasLiquidity pip: ${pip}`)
    }

    const checkLiquidityAmountAtPip = async function (pip: number, liquidity: number) {
        const liquidityAmount = await positionManager.getLiquidityInPipRange(BigNumber.from(pip), 1, true)
        await expect(Number(liquidityAmount[0][0].liquidity)).eq(Number(liquidity))
    }

    const shouldReachPip = async function (pip: number) {
        expect((await positionManager.getCurrentPip()).toNumber()).eq(pip)
    }

    async function createLimitOrderInPipRanges(pipRanges: number[], size: number[] | string[], isBuy = false) {
        const orders = []
        for (let i in pipRanges) {
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
        for (let i in pipsHasLiquidity) {
            await checkLiquidityAtPip(pips[i], pipsHasLiquidity[i])
        }
        if (orders && partialFilledAmounts && isFilledAmounts && orders.length > 0)
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

    interface CreateLimitOrderAndVerifyAfterArg {
        pip: number;
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

    async function createLimitOrderAndVerifyAfter(
        {
            pip,
            size,
            sizeOut,
            pips,
            pipsHasLiquidity,
            reachPip,
            orders,
            partialFilledAmounts,
            isFilledAmounts,
            isBuy = true
        }: CreateLimitOrderAndVerifyAfterArg
    ) {
        console.log("before open limit and verify")
        await shouldOpenLimitAndVerify(pip, size, sizeOut, isBuy)
        console.log("before check liquidity at pip")
        for (let i in pipsHasLiquidity) {
            await checkLiquidityAtPip(pips[i], pipsHasLiquidity[i])
        }
        console.log("before check liquidity amount at pip")
        if (reachPip == pip) {
            await checkLiquidityAmountAtPip(pip, size - sizeOut)
        }
        if (orders && partialFilledAmounts && isFilledAmounts && orders.length > 0)
            console.log("before verify limit order detail")
            for(let orderIndex in orders){
                await verifyLimitOrderDetail({
                    pip: orders[orderIndex][0],
                    orderId: orders[orderIndex][1],
                    partialFilled: partialFilledAmounts[orderIndex],
                    isFilled: isFilledAmounts[orderIndex]
                })
            }
        console.log("before check reach pip")
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
            await shouldBuyMarketAndVerify(8,8,true)

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
            // market buy
            await shouldBuyMarketAndVerify(12,10,true)

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
            // market buy
            await shouldBuyMarketAndVerify(10,10,true)

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
            const newOrderId = await createLimitOrderAndVerify(220, 5, false)
            // orders.push(newOrderId)
            console.log((await positionManager.tickPosition(220)).liquidity.toString())
            await createMarketOrderAndVerifyAfter({
                sizeOut: 5,
                size: 5,
                pips,
                pipsHasLiquidity: [true, true, true],
                reachPip: 220,
                orders,
                partialFilledAmounts: [10, 0, 0, 0, ],
                isFilledAmounts: [true, false, false, false, ]
            });
            const newLimitOrderId = await createLimitOrderAndVerify(220, 5, false)
            // @ts-ignore
            // orders.push(newLimitOrderId)
            await createMarketOrderAndVerifyAfter({
                sizeOut: 45,
                size: 50,
                pips,
                pipsHasLiquidity: [false, false, false],
                reachPip: 230,
                orders,
                partialFilledAmounts: [10, 0, 0, 0],
                isFilledAmounts: [true, true, true, true]
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

        it('market short should revert transaction due to price too far from index price', async function () {
            /**
             * Step 1:
             * Current pip = 200
             * User A created limit L(2, 10)
             *
             * Step 2:
             * After update MaxFindingWordsIndex to 0,
             * User B open market S(10). Should not match with user A and revert due to out of price range
             * */
            await createLimitOrderAndVerify(2, 10, true)

            await positionManager.updateMaxFindingWordsIndex(BigNumber.from("0"))

            await expect(marketBuy(10, false)).to.be.revertedWith("VM Exception while processing transaction: reverted with reason string '25'")
        });
        it('market long should revert transaction due to price too far from index price', async function () {
            /**
             * Step 1:
             * Current pip = 200
             * User A created limit S(255, 10), S(500, 10)
             *
             * Step 2:
             * After update MaxFindingWordsIndex to 1,
             * User B open market L(20). Should not match with user A and revert due to out of price range
             * */
            const pips = [200, 255, 460]
            const pipSizes = [10, 5, 5]
            await createLimitOrderInPipRanges(pips, pipSizes, false)

            await positionManager.updateMaxFindingWordsIndex(BigNumber.from("1"))

            await expect(marketBuy(20, true)).to.be.revertedWith("VM Exception while processing transaction: reverted with reason string '25'")
        });
    });


    describe("debug finding pip buy error", async () => {
        it('should debug case 1', async  function () {
            //2931455,17900000000000000,2931500,3711300000000000000
            const pips = [2931455, 2931500]
            const pipSizes = ['17900000000000000', '3711300000000000000']
            await positionManager.updateMaxFindingWordsIndex(BigNumber.from("120000"))
            await createLimitOrderInPipRanges(pips, pipSizes, false)
            await marketBuy('17900000000000001', true)
        });
    })

    describe("open limit LONG higher than current price", async () => {
        it("should fill all pending limit order expect first LONG order then stop at the last order", async () => {
            const pips = [201, 203, 204, 205, 216, 217, 218]
            const pipSizes = [1, 2, 3, 4, 5, 6, 7]
            const orders = await createLimitOrderInPipRanges(pips, pipSizes, false)
            await createLimitOrderInPipRanges([200], [9], true)

            await createLimitOrderAndVerifyAfter({
                pip: 220,
                size: 28,
                sizeOut: 28,
                pips,
                pipsHasLiquidity: [false, false, false, false, false, false, false],
                reachPip: 218,
                orders,
                partialFilledAmounts: [...pips].fill(0),
                isFilledAmounts: [true, true, true, true, true, true, true]
            })
        })

        it("should fill all pending limit order include first SHORT order then stop at the last order ", async () => {
            const pips = [200, 201, 203, 204, 205, 216, 217, 218]
            const pipSizes = [8, 1, 2, 3, 4, 5, 6, 7]
            const orders = await createLimitOrderInPipRanges(pips, pipSizes, false)
            console.log("before create limit order and verify")

            await createLimitOrderAndVerifyAfter({
                pip: 220,
                size: 36,
                sizeOut: 36,
                pips,
                pipsHasLiquidity: [false, false, false, false, false, false, false, false],
                reachPip: 218,
                orders,
                partialFilledAmounts: [...pips].fill(0),
                isFilledAmounts: [true, true, true, true, true, true, true, true],
                isBuy: true
            })
        })

        it("should fill all pending limit order than create a new pending order at the target pip", async () => {
            const pips = [201, 203, 204, 205, 216, 217, 218]
            const pipSizes = [1, 2, 3, 4, 5, 6, 7]
            const orders = await createLimitOrderInPipRanges(pips, pipSizes)

            await createLimitOrderAndVerifyAfter({
                pip: 220,
                size: 30,
                sizeOut: 28,
                pips,
                pipsHasLiquidity: [false, false, false, false, false, false, false],
                reachPip: 220,
                orders,
                partialFilledAmounts: [...pips].fill(0),
                isFilledAmounts: [true, true, true, true, true, true, true],
                isBuy: true
            })
        })

        it("should fulfill size of limit order and partial filled last matched pip", async () => {
            const pips = [201, 203, 204, 205, 216, 217, 218]
            const pipSizes = [1, 2, 3, 4, 5, 6, 7]
            const orders = await createLimitOrderInPipRanges(pips, pipSizes)
            console.log("before create limit order and verify")
            await createLimitOrderAndVerifyAfter({
                pip: 220,
                size: 12,
                sizeOut: 12,
                pips,
                pipsHasLiquidity: [false, false, false, false, true, true, true],
                reachPip: 216,
                orders,
                partialFilledAmounts: [0, 0, 0, 0, 2, 0, 0],
                isFilledAmounts: [true, true, true, true, false, false, false],
                isBuy: true
            })
        })

        it("should fulfill limit order size and fulfilled last matched pip", async () => {
            const pips = [201, 203, 204, 205, 216, 217, 218]
            const pipSizes = [1, 2, 3, 4, 5, 6, 7]
            const orders = await createLimitOrderInPipRanges(pips, pipSizes)
            console.log("before create limit order and verify")
            await createLimitOrderAndVerifyAfter({
                pip: 220,
                size: 10,
                sizeOut: 10,
                pips,
                pipsHasLiquidity: [false, false, false, false, true, true, true],
                reachPip: 205,
                orders,
                partialFilledAmounts: [0, 0, 0, 0, 0, 0, 0],
                isFilledAmounts: [true, true, true, true, false, false, false],
                isBuy: true
            })
        })

        it("should create a new pending order and change price to target pip", async () => {
            await createLimitOrderAndVerifyAfter({
                pip: 230,
                size: 30,
                sizeOut: 0,
                pips: [],
                pipsHasLiquidity: [],
                reachPip: 230,
            })
        })
    })

    describe("open limit SHORT lower than current price", async () => {
        it("should fill all pending limit order expect first SHORT order then stop at the last order", async () => {
            const pips = [199, 197, 196, 195, 184, 183, 182]
            const pipSizes = [1, 2, 3, 4, 5, 6, 7]
            const orders = await createLimitOrderInPipRanges(pips, pipSizes, true)
            await createLimitOrderInPipRanges([200], [9], false)


            await createLimitOrderAndVerifyAfter({
                pip: 180,
                size: 28,
                sizeOut: 28,
                pips,
                pipsHasLiquidity: [false, false, false, false, false, false, false],
                reachPip: 182,
                orders,
                partialFilledAmounts: [...pips].fill(0),
                isFilledAmounts: [true, true, true, true, true, true, true],
                isBuy: false
            })
        })

        it("should fill all pending limit order include first LONG order then stop at the last order", async () => {
            const pips = [200, 199, 197, 196, 195, 184, 183, 182]
            const pipSizes = [9, 1, 2, 3, 4, 5, 6, 7]
            const orders = await createLimitOrderInPipRanges(pips, pipSizes, true)
            console.log("before create limit order and verify")

            await createLimitOrderAndVerifyAfter({
                pip: 180,
                size: 37,
                sizeOut: 37,
                pips,
                pipsHasLiquidity: [false, false, false, false, false, false, false, false],
                reachPip: 182,
                orders,
                partialFilledAmounts: [...pips].fill(0),
                isFilledAmounts: [true, true, true, true, true, true, true, true],
                isBuy: false
            })
        })

        it("should fill all pending limit order than create a new pending order at the target pip", async () => {
            const pips = [199, 197, 196, 195, 184, 183, 182]
            const pipSizes = [1, 2, 3, 4, 5, 6, 7]
            const orders = await createLimitOrderInPipRanges(pips, pipSizes, true)

            await createLimitOrderAndVerifyAfter({
                pip: 180,
                size: 30,
                sizeOut: 28,
                pips,
                pipsHasLiquidity: [false, false, false, false, false, false, false],
                reachPip: 180,
                orders,
                partialFilledAmounts: [...pips].fill(0),
                isFilledAmounts: [true, true, true, true, true, true, true],
                isBuy: false
            })
        })

        it("should fulfill size of limit order and partial filled last matched pip", async () => {
            const pips = [199, 197, 196, 195, 184, 183, 182]
            const pipSizes = [1, 2, 3, 4, 5, 6, 7]
            const orders = await createLimitOrderInPipRanges(pips, pipSizes, true)
            console.log("before create limit order and verify")
            await createLimitOrderAndVerifyAfter({
                pip: 180,
                size: 12,
                sizeOut: 12,
                pips,
                pipsHasLiquidity: [false, false, false, false, true, true, true],
                reachPip: 184,
                orders,
                partialFilledAmounts: [0, 0, 0, 0, 2, 0, 0],
                isFilledAmounts: [true, true, true, true, false, false, false],
                isBuy: false
            })
        })

        it("should fulfill limit order size and fulfilled last matched pip", async () => {
            const pips = [199, 197, 196, 195, 184, 183, 182]
            const pipSizes = [1, 2, 3, 4, 5, 6, 7]
            const orders = await createLimitOrderInPipRanges(pips, pipSizes, true)
            console.log("before create limit order and verify")
            await createLimitOrderAndVerifyAfter({
                pip: 180,
                size: 10,
                sizeOut: 10,
                pips,
                pipsHasLiquidity: [false, false, false, false, true, true, true],
                reachPip: 195,
                orders,
                partialFilledAmounts: [0, 0, 0, 0, 0, 0, 0],
                isFilledAmounts: [true, true, true, true, false, false, false],
                isBuy: false
            })
        })

        it("should create a new pending order and change price to target pip", async () => {
            await createLimitOrderAndVerifyAfter({
                pip: 180,
                size: 30,
                sizeOut: 0,
                pips: [],
                pipsHasLiquidity: [],
                reachPip: 180,
                isBuy: false
            })
        })
    })
});

