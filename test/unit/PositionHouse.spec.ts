import {BigNumber, BigNumberish, ContractFactory, Wallet} from 'ethers'
import {ethers, waffle} from 'hardhat'
// import {PositionHouse} from "../../typeChain";
import {loadFixture} from "ethereum-waffle";
// import checkObservationEquals from "../../shared/checkObservationEquals";
// import snapshotGasCost from "../../shared/snapshotGasCost";
// import {expect} from "../../shared/expect";
// import {TEST_POOL_START_TIME} from "../../shared/fixtures";
import {describe} from "mocha";
import {expect} from 'chai'
import {PositionManager, PositionHouse} from "../../typeChain";
import {priceToPip, toWeiBN, toWeiWithString} from "../shared/utilities";

const SIDE = {
    LONG: 0,
    SHORT: 1
}

interface PositionData {
    quantity: BigNumber
    margin: BigNumber
    openNotional: BigNumber
    side: BigNumber
}

describe("PositionHouse", () => {
    let positionHouse: PositionHouse;
    let trader: any;
    let trader1: any;
    let trader2: any;
    let positionManager: PositionManager;
    let positionManagerFactory: ContractFactory;

    beforeEach(async () => {
        [trader, trader1, trader2] = await ethers.getSigners()
        positionManagerFactory = await ethers.getContractFactory("PositionManager")
        // BTC-USD Perpetual, initial price is 5000
        // each pip = 0.01
        // => initial pip = 500000
        //quoteAsset BUSD_TestNet = 0x8301f2213c0eed49a7e28ae4c3e91722919b8b47
        positionManager = (await positionManagerFactory.deploy(500000, '0x8301f2213c0eed49a7e28ae4c3e91722919b8b47')) as unknown as PositionManager;
        const factory = await ethers.getContractFactory("PositionHouse")
        positionHouse = (await factory.deploy()) as unknown as PositionHouse;
    })

    const openMarketPosition = async ({
                                          quantity,
                                          leverage,
                                          side,
                                          trader,
                                          instanceTrader,
                                          expectedMargin,
                                          expectedNotional,
                                          expectedSize,
                                          price = 5000,
                                          _positionManager = positionManager
                                      }: {
        quantity: BigNumber,
        leverage: number,
        side: number,
        trader: string,
        instanceTrader: any,
        expectedMargin?: BigNumber,
        expectedNotional?: BigNumber | string,
        expectedSize?: BigNumber,
        price?: number,
        _positionManager?: any
    }) => {
        await positionHouse.connect(instanceTrader).openMarketPosition(
            _positionManager.address,
            side,
            quantity,
            leverage,
        )

        const positionInfo = await positionHouse.getPosition(_positionManager.address, trader) as unknown as PositionData;
        // console.log("positionInfo", positionInfo)
        console.log('openNotional :', positionInfo.openNotional.toString());
        console.log('quantity: ', positionInfo.quantity.toString());
        const currentPrice = Number((await _positionManager.getPrice()).toString())
        console.log('currentPrice ', currentPrice);

        const openNotional = positionInfo.openNotional.div('10000').toString()
        expectedNotional = expectedNotional && expectedNotional.toString() || quantity.mul(price).toString()
        console.log("actual quantity of position", positionInfo.quantity.toString())
        expect(positionInfo.quantity.toString()).eq(expectedSize || quantity.toString())
        expect(openNotional).eq(expectedNotional)
        expectedMargin && expect(positionInfo.margin.div('10000').toString()).eq(expectedMargin.toString())
    }

    const closePosition = async ({
                                     trader,
                                     instanceTrader,
                                     _positionManager = positionManager
                                 }: {
        trader: string,
        instanceTrader: any,
        _positionManager?: any
    }) => {
        await positionHouse.connect(instanceTrader).closePosition(
            _positionManager.address
        )
        console.log("in function closePosition")

        const positionData = (await positionHouse.getPosition(_positionManager.address, trader)) as unknown as PositionData;
        console.log("get position data in closePosition")
        console.log("margin ", positionData.margin.toString());
        // expect(positionData.margin).eq(0);
        // expect(positionData.quantity).eq(0);


    }

    describe('openMarketPosition', async () => {


        it('should open market a position', async function () {
            const [trader] = await ethers.getSigners()
            const quantity = toWeiBN('1')
            console.log(quantity)
            const leverage = 10
            await positionManager.openLimitPosition(
                priceToPip(5000),
                toWeiBN('1'),
                true
            );

            await openMarketPosition({
                    quantity: quantity,
                    leverage: leverage,
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader,
                    _positionManager: positionManager
                }
            );
        });

        describe('get PnL', function () {
            it('should get PnL market', async function () {

                await positionManager.openLimitPosition(
                    priceToPip(5000),
                    '2',
                    true
                );

                console.log('open limit done');
                await openMarketPosition({
                    quantity: BigNumber.from('2'),
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader,
                    leverage: 10,
                    _positionManager: positionManager
                });


                console.log('open market done');

                const positionNotionalAndPnL = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address,
                    1
                )
                console.log("positionNotionalAndPnL ", positionNotionalAndPnL.toString())
                expect(positionNotionalAndPnL.unrealizedPnl).eq(0)

            });

            it('pnl = 0', async function () {
                await positionManager.openLimitPosition(
                    priceToPip(5000),
                    '2',
                    true
                );
                await openMarketPosition({
                    quantity: BigNumber.from('2'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader,
                    _positionManager: positionManager
                })
                await positionManager.openLimitPosition(
                    priceToPip(5000),
                    toWeiBN('10'),
                    false
                );
                await openMarketPosition({
                    quantity: BigNumber.from('1'),
                    side: SIDE.LONG,
                    leverage: 10,
                    trader: trader.address,
                    instanceTrader: trader,
                    expectedSize: BigNumber.from('1'),
                    expectedNotional: BigNumber.from('5000'),
                    expectedMargin: BigNumber.from('500'),
                    _positionManager: positionManager
                })
            });
        });


        describe('should increase current position with PnL ', async function () {
            it('should pnl > 0 and increase position short', async function () {
                await positionManager.connect(trader1).openLimitPosition(
                    priceToPip(5000),
                    '1',
                    true
                );

                // trader0 short at price 5000, quantity 1 BTC, openNotional = 5000*1 = 5000, margin = openNotional / leverage = 5000 / 10 = 500
                await openMarketPosition({
                    quantity: BigNumber.from('1'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader,
                    _positionManager: positionManager
                })

                // trader1 open a long order at price 4990, quantity 0.5 BTC
                await positionManager.connect(trader1).openLimitPosition(
                    priceToPip(4990),
                    '5',
                    true
                );

                // trader0 short at price 4990 because of trader1's order, quantity 5 BTC, totalSize = 5 (plus old position),
                // openNotional = 4990*5 = 24950, totalNotional = 24950 + 5000 (open position) = 29950
                await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader,
                    price: Number('4990'),
                    expectedSize: BigNumber.from('6'),
                    expectedNotional: BigNumber.from('29950'),
                    _positionManager: positionManager

                })

                const positionNotionalAndPnL = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address,
                    1
                )

                // unrealizedPnl = openNotional - positionNotional = 29950 - totalSize * currentPrice = 29950 - 6*4990 = 10
                expect(positionNotionalAndPnL.unrealizedPnl).gte(0)
                expect(positionNotionalAndPnL.unrealizedPnl.div(10000)).eq(10)

                // trader1 long at price 4980, quantity 1 BTC
                await positionManager.connect(trader1).openLimitPosition(
                    priceToPip(4980),
                    '1',
                    true
                );

                // trader2 short at price 4980 because of trader1's order, quantity 1 BTC, currentPrice now reduce to 4980
                await openMarketPosition({
                    quantity: BigNumber.from('1'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    price: Number('4980'),
                    expectedSize: BigNumber.from('1'),
                    expectedNotional: BigNumber.from('4980'),
                    _positionManager: positionManager
                });

                const positionNotionalAndPnL1 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address,
                    1
                )
                // because current price is now 4980 so trader0's pnl increased to 70
                // calculated by pnl = openNotional - positionNotional = 29950 - totalSize * currentPrice = 29950 - 6 * 4980 = 70
                expect(positionNotionalAndPnL1.unrealizedPnl).gte(0)
                expect(positionNotionalAndPnL1.unrealizedPnl.div(10000)).eq(70)

            });
            it('should pnl < 0 and increase position short', async function () {

                await positionManager.connect(trader1).openLimitPosition(
                    priceToPip(5000),
                    '10',
                    true
                );

                await openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader,
                    _positionManager: positionManager

                })


                await positionManager.connect(trader1).openLimitPosition(
                    priceToPip(4990),
                    '5',
                    true
                );

                await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader,
                    price: Number('4990'),
                    expectedSize: BigNumber.from('15'),
                    expectedNotional: BigNumber.from('74950'),
                    _positionManager: positionManager

                })

                const positionNotionalAndPnL = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address,
                    1
                )

                expect(positionNotionalAndPnL.unrealizedPnl.div(10000)).eq(100)

                await positionManager.connect(trader1).openLimitPosition(
                    priceToPip(5010),
                    '10',
                    false
                );

                console.log("open market with trader 2")

                await openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    price: Number('5010'),
                    expectedSize: BigNumber.from('10'),
                    expectedNotional: BigNumber.from('50100')
                });

                const positionNotionalAndPnL1 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address,
                    1
                )

                console.log("positionNotionalAndPnL1 :", positionNotionalAndPnL1.unrealizedPnl.toString())
                expect(positionNotionalAndPnL1.unrealizedPnl.div(10000)).lte(0)
                // expect(positionNotionalAndPnL1.unrealizedPnl.div(10000)).eq(-200)

            });
            it('should pnl > 0 and increase position long', async function () {
                await positionManager.connect(trader1).openLimitPosition(
                    priceToPip(5000),
                    '1',
                    false
                );

                // trader0 long at price 5000, quantity 1 BTC, openNotional = 5000*1 = 5000, margin = openNotional / leverage = 5000 / 10 = 500
                await openMarketPosition({
                    quantity: BigNumber.from('1'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader.address,
                    instanceTrader: trader,
                    _positionManager: positionManager
                })

                // trader1 open a short order at price 5010, quantity 5 BTC
                await positionManager.connect(trader1).openLimitPosition(
                    priceToPip(5010),
                    '5',
                    false
                );

                // trader0 long at price 5010 because of trader1's order, quantity 5 BTC, totalSize = 6 (plus old position),
                // openNotional = 5010 * 5 = 25050, totalNotional = 25050 + 5000 (open position) = 30050
                await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader.address,
                    instanceTrader: trader,
                    price: Number('5010'),
                    expectedSize: BigNumber.from('6'),
                    expectedNotional: BigNumber.from('30050'),
                    _positionManager: positionManager

                })

                const positionNotionalAndPnL = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address,
                    1
                )

                // unrealizedPnl for long order = positionNotional - openNotional = totalSize * currentPrice - 30050 = 6*5010 - 30050 = 10
                expect(positionNotionalAndPnL.unrealizedPnl).gte(0)
                expect(positionNotionalAndPnL.unrealizedPnl.div(10000)).eq(10)
                // trader1 short at price 5020, quantity 10 BTC
                await positionManager.connect(trader1).openLimitPosition(
                    priceToPip(5020),
                    '10',
                    false
                );
                // trader2 short at price 5020 because of trader1's order, quantity 10 BTC, currentPrice now increase to 5020
                await openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    price: Number('5020'),
                    expectedSize: BigNumber.from('10'),
                    expectedNotional: BigNumber.from('50200'),
                    _positionManager: positionManager
                });

                const positionNotionalAndPnL1 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address,
                    1
                )
                // because current price is now 5020 so trader0's pnl increased to 70
                // calculated by pnl = positionNotional - openNotional = totalSize * currentPrice - 30050 = 6 * 5020 - 30050 = 70
                expect(positionNotionalAndPnL1.unrealizedPnl).gte(0)
                expect(positionNotionalAndPnL1.unrealizedPnl.div(10000)).eq(70)
            })
            it('should pnl < 0 and increase position long', async function () {
                await positionManager.connect(trader1).openLimitPosition(
                    priceToPip(5000),
                    '1',
                    false
                );

                // trader0 long at price 5000, quantity 1 BTC, openNotional = 5000*1 = 5000, margin = openNotional / leverage = 5000 / 10 = 500
                await openMarketPosition({
                    quantity: BigNumber.from('1'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader.address,
                    instanceTrader: trader,
                    _positionManager: positionManager
                })

                // trader1 open a short order at price 5010, quantity 5 BTC
                await positionManager.connect(trader1).openLimitPosition(
                    priceToPip(4990),
                    '5',
                    true
                );

                // trader2 short at price 4990 because of trader1's order, quantity 5 BTC
                // openNotional = 4990 * 5 = 24950
                await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    price: Number('4990'),
                    expectedSize: BigNumber.from('5'),
                    expectedNotional: BigNumber.from('24950'),
                    _positionManager: positionManager

                })

                const positionNotionalAndPnL = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address,
                    1
                )

                // unrealizedPnl for long order = positionNotional - openNotional = totalSize * currentPrice - 5000 = 1*4990 - 5000 = -10
                expect(positionNotionalAndPnL.unrealizedPnl).lte(0)
                expect(positionNotionalAndPnL.unrealizedPnl.div(10000)).eq(-10)
                // trader1 short at price 4990, quantity 10 BTC
                await positionManager.connect(trader1).openLimitPosition(
                    priceToPip(4990),
                    '10',
                    false
                );
                // trader0 long at price 4990 because of trader1's order, quantity 10 BTC, currentPrice is 4990
                await openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader.address,
                    instanceTrader: trader,
                    price: Number('4990'),
                    expectedSize: BigNumber.from('11'),
                    expectedNotional: BigNumber.from('54900'),
                    _positionManager: positionManager
                });

                const positionNotionalAndPnL1 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address,
                    1
                )
                // calculated by pnl = positionNotional - openNotional = totalSize * currentPrice - 54900 = 11 * 4990 - 54900 = 10
                expect(positionNotionalAndPnL1.unrealizedPnl).lte(0)
                expect(positionNotionalAndPnL1.unrealizedPnl.div(10000)).eq(-10)
            })
        })

        describe('should reduce current position with PnL', async function () {


            it('should pnl > 0 and reduce position', async function () {
                const positionManager2 = (await positionManagerFactory.deploy(priceToPip(50), '0x8301f2213c0eed49a7e28ae4c3e91722919b8b47')) as unknown as PositionManager;
                await positionManager2.connect(trader1).openLimitPosition(
                    priceToPip(50),
                    '1000',
                    true
                );

                console.log("open market 1")
                // trader0 short at price 50, quantity 1000 TRB, openNotional = 50*1000= 50000, margin = openNotional / leverage = 50000 / 20 = 250
                await openMarketPosition({
                    quantity: BigNumber.from('1000'),
                    leverage: 20,
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader,
                    _positionManager: positionManager2,
                    price: 50
                })

                // trader1 openLimit at price 49
                // quantity 1000 LONG
                await positionManager2.connect(trader1).openLimitPosition(
                    priceToPip(49),
                    '1000',
                    true,
                );

                console.log("open market 2")

                // trader2 short at price 49, quantity 1000 TRB, openNotional = 49*1000 = 49000
                await openMarketPosition({
                    quantity: BigNumber.from('1000'),
                    leverage: 20,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    price: Number('49'),
                    expectedSize: BigNumber.from('1000'),
                    expectedNotional: BigNumber.from('49000'),
                    _positionManager: positionManager2
                });
                // trader0 should get profit
                // openNotional = 50*1000 = 50000
                // => profit = openNotional - currentNotional = 50000 - quantity*currentPrice = 5000 - 49*1000 = 1000
                const positionNotionalAndPnL1 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                    positionManager2.address,
                    trader.address,
                    1
                )
                console.log(positionNotionalAndPnL1.unrealizedPnl.toString())

                expect(positionNotionalAndPnL1.unrealizedPnl.div(10000)).eq(1000)

                await positionManager2.connect(trader2).openLimitPosition(
                    priceToPip(49.5),
                    '500',
                    false
                );

                console.log("open market 3")

                // trader0 long at price 50.5, quantity 500 TRB, new openNotional = 50.5*500 = 25250
                // trader0 position should be modified as following:
                // current PNL = 1000*(50-49.5) = 500
                // openNotional = oldNotional - newNotional = 50*1000 (short before) - 50*500 (this long) = 25000
                await openMarketPosition({
                    quantity: BigNumber.from('500'),
                    leverage: 20,
                    side: SIDE.LONG,
                    trader: trader.address,
                    instanceTrader: trader,
                    price: Number('49.5'),
                    expectedSize: BigNumber.from('500'),
                    expectedNotional: BigNumber.from('25000'),
                    _positionManager: positionManager2
                })

                const positionNotionalAndPnL = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                    positionManager2.address,
                    trader.address,
                    1
                )
                console.log(await positionHouse.getPosition(positionManager2.address, trader.address))
                console.log((await positionManager2.getPrice()).toString())
                // pnl after = currentSize*(entryPrice - currentPrice) = 500*(50 - 49.5) = 250
                // trader's total receive will be = reducedMargin + pnl before - pnl after
                // = oldMargin - newSize / oldSize * oldMargin + pnl before - pnl after = 1250 + 250 = 1500
                expect(positionNotionalAndPnL.positionNotional.div(10000)).eq(24750)
                expect(positionNotionalAndPnL.unrealizedPnl).gte(0)
                console.log('positionNotionalAndPnL ', positionNotionalAndPnL.unrealizedPnl.toString())
                expect(positionNotionalAndPnL.unrealizedPnl.div(10000).toNumber()).eq(250)
            });

            it('should pnl < 0 and reduce position', async function () {
                const positionManager2 = (await positionManagerFactory.deploy(priceToPip(50), '0x8301f2213c0eed49a7e28ae4c3e91722919b8b47')) as unknown as PositionManager;
                await positionManager2.connect(trader1).openLimitPosition(
                    priceToPip(50),
                    '1000',
                    false
                );

                console.log("open market 1")

                // trader0 long at price 50, quantity 1000 TRB, openNotional = 50*1000 = 50000, margin = openNotional / leverage = 50000 / 20 = 250
                await openMarketPosition({
                    quantity: BigNumber.from('1000'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader.address,
                    instanceTrader: trader,
                    _positionManager: positionManager2,
                    price: 50
                })

                // trader1 openLimit at price 49
                // quantity 1000 LONG
                await positionManager2.connect(trader1).openLimitPosition(
                    priceToPip(49.9),
                    '1000',
                    true
                );

                console.log("open market 2");

                // trader2 short at price 49, quantity 1000 TRB, openNotional = 49.9 * 1000 = 49900
                await openMarketPosition({
                    quantity: BigNumber.from('1000'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    price: Number('49.9'),
                    expectedSize: BigNumber.from('1000'),
                    expectedNotional: BigNumber.from('49900'),
                    _positionManager: positionManager2
                });

                // trader0 should be loss
                // openNotional = 50*1000 = 50000
                // => profit of long position = currentNotional - openNotional = quantity*currentPrice - 50000 = 1000*49.9 - 50000 = 100
                const positionNotionalAndPnL1 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                    positionManager2.address,
                    trader.address,
                    1
                )

                expect(positionNotionalAndPnL1.unrealizedPnl.div(10000)).eq(-100)

                await positionManager2.connect(trader2).openLimitPosition(
                    priceToPip(49.8),
                    '500',
                    true
                )

                console.log("open market 3")

                // trader0 short at price 49.8, quantity 500 TRB, new openNotional = 49.8 * 500 = 24900
                // trader0 position should be modified as following:
                // currentPnl = 1000*(49.8-50) = -200
                // openNotional = oldNotional - newNotional = 50 * 1000 (long before) - 50 * 500 (this short) = 25000
                await openMarketPosition({
                    quantity: BigNumber.from('500'),
                    leverage: 20,
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader,
                    price: Number('49.8'),
                    expectedSize: BigNumber.from('500'),
                    expectedNotional: BigNumber.from('25000'),
                    _positionManager: positionManager2
                })

                const positionNotionalAndPnL = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                    positionManager2.address,
                    trader.address,
                    1
                )
                console.log(await positionHouse.getPosition(positionManager2.address, trader.address))
                console.log((await positionManager2.getPrice()).toString())
                // pnl after (for long position) = currentSize*(currentPrice - entryPrice) = 500*(49.8 - 50) = 100
                // trader's total receive will be = reducedMargin + pnl before - pnl after
                // = oldMargin - newSize / oldSize * oldMargin + pnl before - pnl after = 1250 - 100 = 1350
                expect(positionNotionalAndPnL.positionNotional.div(10000)).eq(24900)
                expect(positionNotionalAndPnL.unrealizedPnl).lte(0)
                console.log('positionNotionalAndPnL ', positionNotionalAndPnL.unrealizedPnl.toString())
                expect(positionNotionalAndPnL.unrealizedPnl.div(10000).toNumber()).eq(-100)

            });

        });
        describe('close and open reverse', function () {

            it('close SHORT and open reverse LONG', async function () {
                await positionManager.connect(trader1).openLimitPosition(
                    priceToPip(5000),
                    '100',
                    true
                );

                await openMarketPosition({
                    quantity: BigNumber.from('100'),
                    leverage: 20,
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader,
                    price: Number('5000'),
                });

                await positionManager.connect(trader1).openLimitPosition(
                    priceToPip(5010),
                    '200',
                    false
                );
                await openMarketPosition({
                    quantity: BigNumber.from('200'),
                    leverage: 20,
                    side: SIDE.LONG,
                    trader: trader.address,
                    instanceTrader: trader,
                    price: Number('5010'),
                    expectedNotional: BigNumber.from((100 * 5010).toString()),
                    expectedSize: BigNumber.from((100).toString())
                });

                // should open a reverse position
                const positionData = (await positionHouse.getPosition(positionManager.address, trader.address)) as unknown as PositionData
                expect(positionData.side).eq(SIDE.LONG);

                expect(positionData.quantity.toNumber()).eq(100);
                expect(positionData.openNotional.div(10000).toNumber()).eq(100 * 5010);


            })

            it('close and open reverse position LONG -> reverse SHORT', async function () {
                await positionManager.connect(trader1).openLimitPosition(
                    priceToPip(5000),
                    '100',
                    false
                );

                await openMarketPosition({
                    quantity: BigNumber.from('100'),
                    leverage: 20,
                    side: SIDE.LONG,
                    trader: trader.address,
                    instanceTrader: trader,
                    price: Number('5000'),
                });

                await positionManager.connect(trader1).openLimitPosition(
                    priceToPip(4990),
                    '200',
                    true
                );
                await openMarketPosition({
                    quantity: BigNumber.from('200'),
                    leverage: 20,
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader,
                    price: Number('4990'),
                    expectedNotional: BigNumber.from((100 * 4990).toString()),
                    expectedSize: BigNumber.from('100')
                });

                // should open a reverse position
                const positionData = (await positionHouse.getPosition(positionManager.address, trader.address)) as unknown as PositionData
                expect(positionData.side).eq(SIDE.SHORT);

                expect(positionData.quantity.toNumber()).eq(100);
                expect(positionData.openNotional.div(10000).toNumber()).eq(100 * 4990);
            })
        });

    })

    describe('openLimitPosition', async () => {

        it('should open limit a position', async function () {

            await positionManager.connect(trader).openLimitPosition(
                priceToPip(5000),
                '5',
                true
            );


            await positionManager.connect(trader1).openLimitPosition(
                priceToPip(5000),
                '5',
                true
            );


            await openMarketPosition({
                quantity: BigNumber.from('6'),
                leverage: 10,
                side: SIDE.SHORT,
                trader: trader.address,
                instanceTrader: trader
            })


            // await positionHouse.openLimitPosition(
            //     positionManager.address,
            //     1,
            //     ethers.utils.parseEther('10000'),
            //     ethers.utils.parseEther('5.22'),
            //     10,
            // );

        });

    })


    describe('adjust margin', async function () {

        it('add margin', async function () {
            await positionManager.openLimitPosition(
                priceToPip(5000),
                '2',
                true
            );

            await openMarketPosition({
                quantity: BigNumber.from('2'),
                side: SIDE.SHORT,
                trader: trader1.address,
                instanceTrader: trader1,
                leverage: 10,
                _positionManager: positionManager
            });

            const positionData = (await positionHouse.getPosition(positionManager.address, trader1.address)) as unknown as PositionData;

            console.log('positionData margin: ', positionData.margin.div(10000).toString());
            expect(positionData.margin.div(10000)).eq(1000)


            await positionHouse.connect(trader1).addMargin(positionManager.address, BigNumber.from('100'))

            const positionData1 = (await positionHouse.getPosition(positionManager.address, trader1.address)) as unknown as PositionData;

            console.log('positionData after add margin margin: ', positionData1.margin.div(10000).toString());

            expect(positionData1.margin.div(10000)).eq(1100);

        })

        it('remove margin', async function () {

            await positionManager.openLimitPosition(
                priceToPip(5000),
                '2',
                true
            );

            await openMarketPosition({
                quantity: BigNumber.from('2'),
                side: SIDE.SHORT,
                trader: trader1.address,
                instanceTrader: trader1,
                leverage: 10,
                _positionManager: positionManager
            });

            const positionData = (await positionHouse.getPosition(positionManager.address, trader1.address)) as unknown as PositionData;

            console.log('positionData margin: ', positionData.margin.div(10000).toString());
            expect(positionData.margin.div(10000)).eq(1000)


            await positionHouse.connect(trader1).removeMargin(positionManager.address, BigNumber.from('100'))

            const positionData1 = (await positionHouse.getPosition(positionManager.address, trader1.address)) as unknown as PositionData;

            console.log('positionData after add margin margin: ', positionData1.margin.div(10000).toString());

            expect(positionData1.margin.div(10000)).eq(900);


        })

    })

    describe('close position', async function () {

        it('should close position', async function () {
            const positionManager2 = (await positionManagerFactory.deploy(priceToPip(50), '0x8301f2213c0eed49a7e28ae4c3e91722919b8b47')) as unknown as PositionManager;
            await positionManager2.connect(trader1).openLimitPosition(
                priceToPip(50),
                '1000',
                true
            );

            console.log("open market 1");
            // trader0 short at price 50, quantity 1000 TRB, openNotional = 50*1000 = 50000,
            // margin = openNotional / leverage = 50000 / 20 = 250
            await openMarketPosition({
                quantity: BigNumber.from('1000'),
                leverage: 20,
                side: SIDE.SHORT,
                trader: trader.address,
                instanceTrader: trader,
                _positionManager: positionManager2,
                price: 50
            })

            // trader1 openLimit at price 50
            // quantity 1000 SHORT
            await positionManager2.connect(trader1).openLimitPosition(
                priceToPip(51),
                '1000',
                false
            );


            // const positionData = positionHouse.

            console.log("close position")
            await closePosition({
                trader: trader.address,
                instanceTrader: trader,
                _positionManager: positionManager2
            });


        })
    })

    describe('liquidate position', async function () {

    })
})
