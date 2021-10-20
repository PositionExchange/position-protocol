import {BigNumber, BigNumberish, ContractFactory, Signer, Wallet} from 'ethers'
import {ethers, waffle} from 'hardhat'
import {loadFixture} from "ethereum-waffle";

import {describe} from "mocha";
import {expect} from 'chai'
import {PositionManager, PositionHouse} from "../../typeChain";
import {
    ClaimFund, LimitOrderReturns,
    MaintenanceDetail, OpenLimitPositionAndExpectParams,
    PositionData,
    PositionLimitOrderID,
    priceToPip,
    SIDE,
    toWeiBN,
    toWeiWithString
} from "../shared/utilities";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import PositionManagerTestingTool from "../shared/positionManagerTestingTool";
import PositionHouseTestingTool from "../shared/positionHouseTestingTool";

const sideObj = {
    0: 'LONG',
    1: 'SHORT'
}

describe("PositionHouse_01", () => {
    let positionHouse: PositionHouse;
    let trader: any;
    let trader1: any;
    let trader2: any;
    let trader3: any;
    let tradercp: any;
    let positionManager: PositionManager;
    let positionManagerFactory: ContractFactory;
    let positionManagerTestingTool: PositionManagerTestingTool
    let positionHouseTestingTool: PositionHouseTestingTool

    beforeEach(async () => {
        [trader, trader1, trader2, trader3, tradercp] = await ethers.getSigners()
        positionManagerFactory = await ethers.getContractFactory("PositionManager")
        // BTC-USD Perpetual, initial price is 5000
        // each pip = 0.01
        // => initial pip = 500000
        //quoteAsset    BUSD_TestNet = 0x8301f2213c0eed49a7e28ae4c3e91722919b8b47
        positionManager = (await positionManagerFactory.deploy(500000, '0x8301f2213c0eed49a7e28ae4c3e91722919b8b47')) as unknown as PositionManager;
        positionManagerTestingTool = new PositionManagerTestingTool(positionManager)
        const factory = await ethers.getContractFactory("PositionHouse")
        positionHouse = (await factory.deploy()) as unknown as PositionHouse;
        positionHouseTestingTool = new PositionHouseTestingTool(positionHouse, positionManager)
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
        trader?: string,
        instanceTrader: any,
        expectedMargin?: BigNumber,
        expectedNotional?: BigNumber | string,
        expectedSize?: BigNumber,
        price?: number,
        _positionManager?: any
    }) => {
        // @ts-ignore
        console.group(`Open Market Order: ${sideObj[side.toString()]} ${quantity}`)
        trader = instanceTrader && instanceTrader.address || trader
        if (!trader) throw new Error("No trader")
        const tx = await positionHouse.connect(instanceTrader).openMarketPosition(
            _positionManager.address,
            side,
            quantity,
            leverage,
        )
        console.log("GAS USED MARKET", (await tx.wait()).gasUsed.toString())

        const positionInfo = await positionHouse.getPosition(_positionManager.address, trader) as unknown as PositionData;
        // console.log("positionInfo", positionInfo)
        const currentPrice = Number((await _positionManager.getPrice()).toString())
        const openNotional = positionInfo.openNotional.div('10000').toString()
        // expectedNotional = expectedNotional && expectedNotional.toString() || quantity.mul(price).toString()
        console.log(`Position Info of ${trader}`)
        console.table([
            {
                openNotional: positionInfo.openNotional.toString(),
                openNotionalFormated: openNotional,
                currentPrice: currentPrice,
                quantity: positionInfo.quantity.toString()
            }
        ])
        expect(positionInfo.quantity.toString()).eq(expectedSize || quantity.toString(), "Quantity not match")
        // expect(openNotional).eq(expectedNotional)
        expectedMargin && expect(positionInfo.margin.div('10000').toString()).eq(expectedMargin.toString())
        console.groupEnd()
    }

    async function getOrderIdByTx(tx: any) {
        const receipt = await tx.wait();
        const orderId = ((receipt?.events || [])[1]?.args || [])['orderId']
        const priceLimit = ((receipt?.events || [])[1]?.args || [])['priceLimit']
        return {
            orderId,
            priceLimit,
        }
    }

    async function openLimitPositionAndExpect({
                                                  _trader,
                                                  limitPrice,
                                                  leverage,
                                                  quantity,
                                                  side,
                                                  _positionManager
                                              }: OpenLimitPositionAndExpectParams): Promise<LimitOrderReturns> {
        _positionManager = _positionManager || positionManager
        _trader = _trader || trader
        if (!_positionManager) throw Error("No position manager")
        if (!_trader) throw Error("No trader")
        const tx = await positionHouse.connect(_trader).openLimitOrder(_positionManager.address, side, quantity, priceToPip(Number(limitPrice)), leverage, true)
        console.log("GAS USED LIMIT", (await tx.wait()).gasUsed.toString())
        const receipt = await tx.wait()
        console.log("Gas used to open limit order", receipt.gasUsed.toString())
        const {orderId, priceLimit} = await getOrderIdByTx(tx)
        console.log("order id", orderId)
        const pip = priceToPip(Number(limitPrice))
        await positionManagerTestingTool.expectPendingOrder({
            pip,
            orderId,
            isFilled: false,
            size: quantity,
            partialFilled: 0
        })
        return {
            orderId: orderId,
            pip
        } as LimitOrderReturns
        // expect(positionLimitInOrder..div(10000)).eq(limitPrice);
    }

    const closePosition = async ({
                                     trader,
                                     instanceTrader,
                                     _positionManager = positionManager,
                                    _percentQuantity = 100
                                 }: {
        trader: string,
        instanceTrader: any,
        _positionManager?: any,
        _percentQuantity?: any
    }) => {
        const positionData1 = (await positionHouse.connect(instanceTrader).getPosition(_positionManager.address, trader)) as unknown as PositionData;
        await positionHouse.connect(instanceTrader).closePosition(_positionManager.address, _percentQuantity);

        const positionData = (await positionHouse.getPosition(_positionManager.address, trader)) as unknown as PositionData;
        expect(positionData.margin).eq(0);
        expect(positionData.quantity).eq(0);
    }

    describe('openMarketPosition', async () => {


        it('should open market a position', async function () {
            const [trader] = await ethers.getSigners()
            const quantity = toWeiBN('1')
            console.log(quantity)
            const leverage = 10

            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 100
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('100'),
                    leverage: leverage,
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('0')
                }
            );
            await positionManagerTestingTool.debugPendingOrder(response1.pip, response1.orderId)
        });

        it('should open market a position with many open limit LONG', async function () {
            const [trader] = await ethers.getSigners()
            const leverage = 10

            // await positionManager.openLimitPosition(
            //     priceToPip(4989),
            //     '1',
            //     true
            // );

            let response = (await openLimitPositionAndExpect({
                _trader: trader,
                limitPrice: 4989,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 1
            })) as unknown as PositionLimitOrderID


            let response1 = (await openLimitPositionAndExpect({
                _trader: trader,
                limitPrice: 4991,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 2
            })) as unknown as PositionLimitOrderID

            let response2 = (await openLimitPositionAndExpect({
                _trader: trader,
                limitPrice: 4991,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 3
            })) as unknown as PositionLimitOrderID


            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: leverage,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-4')
                }
            );

        });

        it('should open market a position with have many open limit SHORT', async function () {
            const [trader] = await ethers.getSigners()
            const leverage = 10

            await positionManager.openLimitPosition(
                priceToPip(5011),
                '1',
                false
            );


            await positionManager.openLimitPosition(
                priceToPip(5009),
                '2',
                false
            );

            await positionManager.openLimitPosition(
                priceToPip(5012),
                '3',
                false
            );
            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: leverage,
                    side: SIDE.LONG,
                    trader: trader.address,
                    instanceTrader: trader,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('4')
                }
            );
        });

        // it('open order 2 side in the same word', async function () {
        //     const [trader] = await ethers.getSigners()
        //     const leverage = 10
        //
        //     await positionManager.openLimitPosition(
        //         priceToPip(5001),
        //         '1',
        //         true
        //     );
        //
        //
        //     await positionManager.openLimitPosition(
        //         priceToPip(5002),
        //         '2',
        //         false
        //     );
        //
        //     await positionManager.openLimitPosition(
        //         priceToPip(5003),
        //         '3',
        //         false
        //     );
        //     await openMarketPosition({
        //             quantity: BigNumber.from('4'),
        //             leverage: leverage,
        //             side: SIDE.LONG,
        //             trader: trader.address,
        //             instanceTrader: trader,
        //             _positionManager: positionManager,
        //             expectedSize: BigNumber.from('4')
        //         }
        //     );
        //
        // });


        it('should open market a position with not enough order to fill', async function () {
            // const [trader] = await ethers.getSigners()
            // const quantity = toWeiBN('1')
            // console.log(quantity)
            const leverage = 10
            await positionManager.connect(trader1).openLimitPosition(
                priceToPip(5000),
                5,
                true
            );


            await expect(openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: leverage,
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader,
                    _positionManager: positionManager
                }
            )).to.be.revertedWith('not enough liquidity to fulfill order');

            // const positionData = (await positionHouse.getPosition(positionManager.address, trader.address)) as unknown as PositionData;
            //
            // console.log('quantity: ', positionData.quantity.toString());


        });


        describe('get PnL', function () {
            it('should get PnL market', async function () {

                // await positionManager.openLimitPosition(
                //     priceToPip(5000),
                //     '2',
                //     true
                // );

                let response = (await openLimitPositionAndExpect({
                    _trader: trader,
                    limitPrice: 5000,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 2
                })) as unknown as PositionLimitOrderID

                console.log('open limit done');
                await openMarketPosition({
                    quantity: BigNumber.from('2'),
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    leverage: 10,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-2')


                });


                console.log('open market done');

                const positionNotionalAndPnL = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader1.address,
                    1
                )
                console.log("positionNotionalAndPnL ", positionNotionalAndPnL.toString())
                expect(positionNotionalAndPnL.unrealizedPnl).eq(0)

            });

            it('pnl > 0', async function () {

                let response = (await openLimitPositionAndExpect({
                    _trader: trader1,
                    limitPrice: 5000,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 2
                })) as unknown as PositionLimitOrderID

                await openMarketPosition({
                    quantity: BigNumber.from('2'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-2')

                })


                let response1 = (await openLimitPositionAndExpect({
                    _trader: trader1,
                    limitPrice: 4995,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 2
                })) as unknown as PositionLimitOrderID


                await openMarketPosition({
                    quantity: BigNumber.from('2'),
                    side: SIDE.SHORT,
                    leverage: 10,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    expectedSize: BigNumber.from('-2'),
                    // expectedNotional: BigNumber.from('5000'),
                    // expectedMargin: BigNumber.from('500'),
                    _positionManager: positionManager,

                })
                const positionNotionalAndPnL = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address,
                    1
                )

                expect(positionNotionalAndPnL.unrealizedPnl.div(10000)).eq(10);


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
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-1')
                })

                // trader1 open a long order at price 4990, quantity 5 BTC
                await positionManager.connect(trader1).openLimitPosition(
                    priceToPip(4990),
                    '5',
                    true
                );

                // trader0 short at price 4990 because of trader1's order, quantity 5 BTC, totalSize = 6 (plus old position),
                // openNotional = 4990*5 = 24950, totalNotional = 24950 + 5000 (open position) = 29950
                await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader,
                    price: Number('4990'),
                    expectedSize: BigNumber.from('-6'),
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
                    expectedSize: BigNumber.from('-1'),
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
                console.log(373);
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
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-10')


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
                    expectedSize: BigNumber.from('-15'),
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
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('1'),

                })

                // trader1 open a long order at price 4990, quantity 5 BTC
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
                    expectedSize: BigNumber.from('-5'),
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
                    price: 50,
                    expectedSize: BigNumber.from('-1000')
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
                    expectedSize: BigNumber.from('-1000'),
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
                console.log(' positionNotionalAndPnL1 ', positionNotionalAndPnL1.unrealizedPnl.toString())

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
                    expectedSize: BigNumber.from('-500'),
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
                    expectedSize: BigNumber.from('-1000'),
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
                // = oldMargin - newSize / oldSize * oldMargin + pnl before - pnl after = 1250 - 100 = 1150
                // IMPORTANT check total amount trader will receive (suppose to = 1150)
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
                    expectedSize: BigNumber.from('-100')
                });

                await positionManager.connect(trader1).openLimitPosition(
                    priceToPip(5010),
                    '200',
                    false
                );
                console.log(790);
                await openMarketPosition({
                    quantity: BigNumber.from('200'),
                    leverage: 20,
                    side: SIDE.LONG,
                    trader: trader.address,
                    instanceTrader: trader,
                    price: Number('5010'),
                    expectedNotional: BigNumber.from((100 * 5010).toString()),
                    expectedSize: BigNumber.from('100')

                });

                // should open a reverse position
                const positionData = (await positionHouse.getPosition(positionManager.address, trader.address)) as unknown as PositionData
                // IMPORTANT check total amount trader will receive because old position SHORT is loss,
                // amount margin trader will receive must minus the loss Pnl
                expect(positionData.quantity.toNumber()).gt(0);
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
                console.log('open market 2');
                await openMarketPosition({
                    quantity: BigNumber.from('200'),
                    leverage: 20,
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader,
                    price: Number('4990'),
                    expectedNotional: BigNumber.from((100 * 4990).toString()),
                    expectedSize: BigNumber.from('-100')
                });

                // should open a reverse position
                const positionData = (await positionHouse.getPosition(positionManager.address, trader.address)) as unknown as PositionData
                expect(positionData.quantity.toNumber()).lt(0);

                expect(positionData.quantity.toNumber()).eq(-100);
                expect(positionData.openNotional.div(10000).toNumber()).eq(100 * 4990);
            })
        });
    })

    describe('openLimitPosition', async () => {


        it('should open limit a position', async function () {
            const {pip, orderId} = await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 100
            })
            console.log('id: ', orderId);
            // B open market to 4990
            await openMarketPosition({
                instanceTrader: trader1,
                leverage: 10,
                quantity: BigNumber.from('100'),
                side: SIDE.SHORT,
                price: 4990,
                expectedSize: BigNumber.from('-100')
            })


            // get position should opened
            // const pendingOrder = await positionHouse["getPendingOrder(address,bytes)"](positionManager.address, orderId)
            const pendingOrder = await positionHouse.getPendingOrder(positionManager.address, pip, orderId);

            expect(pendingOrder.isFilled).eq(true)


            const positionData = await positionHouse.getPosition(positionManager.address, trader.address)
            // margin = quantity * price / leverage = 4990 * 100 / 10
            // expect(positionData.margin.toNumber()).eq(4990 * 100 / 10)
            expect(positionData.quantity.toNumber()).eq(100)
        });

        it('should open limit and filled with market by self ', async () => {

            const {pip, orderId} = await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 100
            })
            console.log('id: ', orderId);
            // B open market to 4990
            await openMarketPosition({
                instanceTrader: trader,
                leverage: 10,
                quantity: BigNumber.from('100'),
                side: SIDE.SHORT,
                price: 4990,
                expectedSize: BigNumber.from('0')
            })


        });

        describe('it will error', async () => {
            it('refill the full filled order', async () => {
                let response2 = (await openLimitPositionAndExpect({
                    limitPrice: 5008,
                    side: SIDE.SHORT,
                    leverage: 10,
                    quantity: 100
                })) as unknown as PositionLimitOrderID

                let response3 = (await openLimitPositionAndExpect({
                    limitPrice: 5012,
                    side: SIDE.SHORT,
                    leverage: 10,
                    quantity: 100
                })) as unknown as PositionLimitOrderID

                await openMarketPosition({
                    trader: trader2,
                    instanceTrader: trader2,
                    leverage: 10,
                    quantity: BigNumber.from('160'),
                    side: SIDE.LONG,
                    // price: 5008,
                    expectedSize: BigNumber.from('160')
                })

                const pendingOrder2 = await positionHouse.getPendingOrder(positionManager.address, response2.pip, response2.orderId);
                console.log("partialFilled", pendingOrder2.partialFilled.toString());
                expect(pendingOrder2.isFilled).eq(true)
                expect(pendingOrder2.size).eq(100);


                const pendingOrder3 = await positionHouse.getPendingOrder(positionManager.address, response3.pip, response3.orderId);
                expect(pendingOrder3.isFilled).eq(false)
                expect(pendingOrder3.size).eq(100);
                expect(pendingOrder3.partialFilled).eq(60);
                const positionData1 = await positionHouse.getPosition(positionManager.address, trader.address)
                const positionDataTrader2 = await positionHouse.getPosition(positionManager.address, trader2.address)
                expect(positionData1.quantity.toNumber()).eq(-160)

            })

            it('fill a short order by another short order', async () => {
                let response1 = (await openLimitPositionAndExpect({
                    limitPrice: 5010,
                    side: SIDE.SHORT,
                    leverage: 10,
                    quantity: 150
                })) as unknown as PositionLimitOrderID


                await openMarketPosition({
                    instanceTrader: trader1,
                    leverage: 10,
                    quantity: BigNumber.from('100'),
                    side: SIDE.LONG,
                    price: 5010,
                    expectedSize: BigNumber.from('100')
                })

                await expect(openMarketPosition({
                    instanceTrader: trader2,
                    leverage: 10,
                    quantity: BigNumber.from('50'),
                    side: SIDE.SHORT,
                    price: 5010,
                    expectedSize: BigNumber.from('-50')
                })).to.be.revertedWith('not enough liquidity to fulfill order');

                // const positionData1 = await positionHouse.getPosition(positionManager.address, trader.address)
                // expect(positionData1.quantity.toNumber()).eq(-100)
            })
        })

        describe('should open and cancel', async () => {

            it('cancel limit order has been partial filled', async () => {
                const {pip, orderId} = await openLimitPositionAndExpect({
                    limitPrice: 5000,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 100
                })

                await openMarketPosition({
                    instanceTrader: trader1,
                    leverage: 10,
                    quantity: BigNumber.from('60'),
                    side: SIDE.SHORT,
                    price: 5000,
                    expectedSize: BigNumber.from('-60')
                })

                await positionHouse.cancelLimitOrder(positionManager.address, pip, orderId);

                const positionData = await positionHouse.getPosition(positionManager.address, trader.address)
                expect(positionData.quantity).eq(60);

            })
            it('cancel with one order is pending', async () => {
                const {pip, orderId} = await openLimitPositionAndExpect({
                    limitPrice: 4990,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 100
                })

                await positionHouse.cancelLimitOrder(positionManager.address, pip, orderId);
                const positionData = await positionHouse.getPosition(positionManager.address, trader.address)
                // margin = quantity * price / leverage = 4990 * 100 / 10
                // expect(positionData.margin.toNumber()).eq(4990 * 100 / 10)
                expect(positionData.quantity.toNumber()).eq(0)

            })

            it('cancel with two order, one filled one cancel', async () => {
                let {pip, orderId} = await openLimitPositionAndExpect({
                    limitPrice: 4990,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 100
                })
                console.log('id: ', orderId);
                // B open market to 4990
                await openMarketPosition({
                    trader: trader1,
                    instanceTrader: trader1,
                    leverage: 10,
                    quantity: BigNumber.from('100'),
                    side: SIDE.SHORT,
                    price: 4990,
                    expectedSize: BigNumber.from('-100')
                })


                // get position should opened
                const pendingOrder = await positionHouse.getPendingOrder(positionManager.address, pip, orderId);

                expect(pendingOrder.isFilled).eq(true)


                const positionData1 = await positionHouse.getPosition(positionManager.address, trader.address)
                // margin = quantity * price / leverage = 4990 * 100 / 10
                // expect(positionData.margin.toNumber()).eq(4990 * 100 / 10)
                expect(positionData1.quantity.toNumber()).eq(100)
                let response = (await openLimitPositionAndExpect({
                    limitPrice: 4990,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 100
                })) as unknown as PositionLimitOrderID
                console.log("response pip", response.pip, Number(response.orderId))
                await positionHouse.cancelLimitOrder(positionManager.address, response.pip, response.orderId);
                const positionData = await positionHouse.getPosition(positionManager.address, trader.address)
                // margin = quantity * price / leverage = 4990 * 100 / 10
                // NEED UPDATE can't get margin, need leverage in limit order to calculate margin
                // expect(positionData.margin.toNumber()).eq(4990 * 100 / 10)
                expect(positionData.quantity.toNumber()).eq(100)
            })

            it('cancel with three order with the same price, one filled one cancel one partial filled', async () => {
                let {pip, orderId} = await openLimitPositionAndExpect({
                    limitPrice: 4990,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 100
                })
                // B open market to 4990
                await openMarketPosition({
                    trader: trader1,
                    instanceTrader: trader1,
                    leverage: 10,
                    quantity: BigNumber.from('100'),
                    side: SIDE.SHORT,
                    price: 4990,
                    expectedSize: BigNumber.from('-100')
                })

                // get position should opened
                const pendingOrder = await positionHouse.getPendingOrder(positionManager.address, pip, orderId);

                expect(pendingOrder.isFilled).eq(true)

                const positionData = await positionHouse.getPosition(positionManager.address, trader.address)
                // margin = quantity * price / leverage = 4990 * 100 / 10
                // expect(positionData.margin.toNumber()).eq(4990 * 100 / 10)
                expect(positionData.quantity.toNumber()).eq(100)

                let response1 = (await openLimitPositionAndExpect({
                    limitPrice: 4990,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 100
                })) as unknown as PositionLimitOrderID

                await openMarketPosition({
                    trader: trader2,
                    instanceTrader: trader2,
                    leverage: 10,
                    quantity: BigNumber.from('50'),
                    side: SIDE.SHORT,
                    price: 4990,
                    expectedSize: BigNumber.from('-50')
                })
                await positionManagerTestingTool.debugPendingOrder(response1.pip, response1.orderId)
                const pendingOrderDetails = await positionManager.getPendingOrderDetail(response1.pip, response1.orderId)
                expect(pendingOrderDetails.partialFilled.toString()).eq('50')
                const positionData1 = await positionHouse.getPosition(positionManager.address, trader.address)
                expect(positionData1.quantity.toNumber()).eq(150)

                let response2 = (await openLimitPositionAndExpect({
                    limitPrice: 4990,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 100
                })) as unknown as PositionLimitOrderID

                console.log("response pip", response2.pip, Number(response2.orderId))
                await positionHouse.cancelLimitOrder(positionManager.address, response2.pip, response2.orderId);
                const positionData2 = await positionHouse.getPosition(positionManager.address, trader.address)
                // margin = quantity * price / leverage = 4990 * 100 / 10
                // NEED UPDATE can't get margin, need leverage in limit order to calculate margin
                // expect(positionData.margin.toNumber()).eq(4990 * 100 / 10)
                console.log(1182);
                expect(positionData2.quantity.toNumber()).eq(150)
            })

            it('open 3 limit order with pending all, and cancel #2', async () => {

                let response1 = (await openLimitPositionAndExpect({
                    limitPrice: 4990,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 100
                })) as unknown as PositionLimitOrderID

                let response2 = (await openLimitPositionAndExpect({
                    limitPrice: 4992,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 100
                })) as unknown as PositionLimitOrderID

                let response3 = (await openLimitPositionAndExpect({
                    limitPrice: 4988,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 100
                })) as unknown as PositionLimitOrderID

                await positionHouse.cancelLimitOrder(positionManager.address, response2.pip, response2.orderId);

                const pendingOrder1 = await positionHouse.getPendingOrder(positionManager.address, response1.pip, response1.orderId);
                expect(pendingOrder1.isFilled).eq(false)
                expect(pendingOrder1.size).eq(100);


                const pendingOrder2 = await positionHouse.getPendingOrder(positionManager.address, response2.pip, response2.orderId);
                expect(pendingOrder2.isFilled).eq(false)
                expect(pendingOrder2.size).eq(0);


                const pendingOrder3 = await positionHouse.getPendingOrder(positionManager.address, response3.pip, response3.orderId);
                expect(pendingOrder3.isFilled).eq(false)
                expect(pendingOrder3.size).eq(100);


                const positionData1 = await positionHouse.getPosition(positionManager.address, trader.address)

                expect(positionData1.quantity.toNumber()).eq(0)


            })

            it('open 3 limit order, open market and cancel #1 ', async () => {

                let response1 = (await openLimitPositionAndExpect({
                    limitPrice: 5010,
                    side: SIDE.SHORT,
                    leverage: 10,
                    quantity: 100
                })) as unknown as PositionLimitOrderID

                let response2 = (await openLimitPositionAndExpect({
                    limitPrice: 5008,
                    side: SIDE.SHORT,
                    leverage: 10,
                    quantity: 100
                })) as unknown as PositionLimitOrderID

                let response3 = (await openLimitPositionAndExpect({
                    limitPrice: 5012,
                    side: SIDE.SHORT,
                    leverage: 10,
                    quantity: 100
                })) as unknown as PositionLimitOrderID

                // cancel order #1
                await positionHouse.cancelLimitOrder(positionManager.address, response1.pip, response1.orderId);
                console.log(`STRAT MARKET ORDER`)

                await openMarketPosition({
                    trader: trader2,
                    instanceTrader: trader2,
                    leverage: 10,
                    quantity: BigNumber.from('160'),
                    side: SIDE.LONG,
                    // price: 5008,
                    expectedSize: BigNumber.from('160')
                })

                // await openMarketPosition({
                //     trader: trader2,
                //     instanceTrader: trader2,
                //     leverage: 10,
                //     quantity: BigNumber.from('50'),
                //     side: SIDE.LONG,
                //     // price: 5008,
                //     expectedSize: BigNumber.from('150')
                // })
                console.log(1162)

                const pendingOrder1 = await positionHouse.getPendingOrder(positionManager.address, response1.pip, response1.orderId);
                console.log(pendingOrder1)
                // expect(pendingOrder1.isFilled).eq(false)
                expect(pendingOrder1.size).eq(0);

                // IMPORTANT expect pendingOrder2 is filled should be true
                const pendingOrder2 = await positionHouse.getPendingOrder(positionManager.address, response2.pip, response2.orderId);
                console.log("partialFilled", pendingOrder2.partialFilled.toString());
                // console.log(pendingOrder2.partialFilled.toString());
                expect(pendingOrder2.isFilled).eq(true)
                expect(pendingOrder2.size).eq(100);

                console.log(1175)

                const pendingOrder3 = await positionHouse.getPendingOrder(positionManager.address, response3.pip, response3.orderId);
                expect(pendingOrder3.isFilled).eq(false)
                expect(pendingOrder3.size).eq(100);
                expect(pendingOrder3.partialFilled).eq(60);
                console.log(1180)
                const positionData1 = await positionHouse.getPosition(positionManager.address, trader.address)
                const positionDataTrader2 = await positionHouse.getPosition(positionManager.address, trader2.address)
                console.log("line 1372", positionDataTrader2.quantity.toNumber())
                expect(positionData1.quantity.toNumber()).eq(-160)


            })
        })

        describe('should PnL when open limit', async () => {
            describe('PnL with fully filled', async () => {
                it('should pnl  > 0 with SHORT', async () => {

                    let response1 = (await openLimitPositionAndExpect({
                        limitPrice: 5010,
                        side: SIDE.SHORT,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID


                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.LONG,
                        price: 5010,
                        expectedSize: BigNumber.from('100')
                    })


                    let response2 = (await openLimitPositionAndExpect({
                        limitPrice: 5000,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 200,
                        _trader: trader2
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('200'),
                        side: SIDE.SHORT,
                        price: 5000,
                        expectedSize: BigNumber.from('-100')
                    })


                    console.log('*** start get PnL ***');
                    const positionNotionalAndPnL = await positionHouse.getPositionNotionalAndUnrealizedPnl(positionManager.address, trader.address, 1);

                    expect(positionNotionalAndPnL.unrealizedPnl.div(10000)).eq(1000)
                    expect(positionNotionalAndPnL.positionNotional.div(10000)).eq(500000)

                })

                it('should pnl < 0 with SHORT ', async () => {

                    let response1 = (await openLimitPositionAndExpect({
                        limitPrice: 5010,
                        side: SIDE.SHORT,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID
                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.LONG,
                        price: 5010,
                        expectedSize: BigNumber.from('100')
                    })
                    let response2 = (await openLimitPositionAndExpect({
                        limitPrice: 5020,
                        side: SIDE.SHORT,
                        leverage: 10,
                        quantity: 200,
                        _trader: trader2
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('200'),
                        side: SIDE.LONG,
                        price: 5020,
                        expectedSize: BigNumber.from('300')
                    })

                    console.log('*** start get PnL ***');
                    const positionNotionalAndPnL = await positionHouse.getPositionNotionalAndUnrealizedPnl(positionManager.address, trader.address, 1);

                    expect(positionNotionalAndPnL.unrealizedPnl.div(10000)).eq(-1000)
                    expect(positionNotionalAndPnL.positionNotional.div(10000)).eq(502000)

                })

                it('should pnl  > 0 with LONG', async () => {

                    let response1 = (await openLimitPositionAndExpect({
                        limitPrice: 4990,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID


                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.SHORT,
                        price: 4990,
                        expectedSize: BigNumber.from('-100')
                    })


                    let response2 = (await openLimitPositionAndExpect({
                        limitPrice: 5000,
                        side: SIDE.SHORT,
                        leverage: 10,
                        quantity: 200,
                        _trader: trader2
                    })) as unknown as PositionLimitOrderID


                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('200'),
                        side: SIDE.LONG,
                        price: 5000,
                        expectedSize: BigNumber.from('100')
                    })


                    console.log('*** start get PnL ***');
                    const positionNotionalAndPnL = await positionHouse.getPositionNotionalAndUnrealizedPnl(positionManager.address, trader.address, 1);

                    expect(positionNotionalAndPnL.unrealizedPnl.div(10000)).eq(1000)
                    expect(positionNotionalAndPnL.positionNotional.div(10000)).eq(500000)

                })


                it('should pnl < 0 with LONG', async () => {

                    let response1 = (await openLimitPositionAndExpect({
                        limitPrice: 4990,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID


                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.SHORT,
                        price: 4990,
                        expectedSize: BigNumber.from('-100')
                    })


                    let response2 = (await openLimitPositionAndExpect({
                        limitPrice: 4980,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 200,
                        _trader: trader2
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('200'),
                        side: SIDE.SHORT,
                        price: 4980,
                        expectedSize: BigNumber.from('-300')
                    })


                    console.log('*** start get PnL ***');
                    const positionNotionalAndPnL = await positionHouse.getPositionNotionalAndUnrealizedPnl(positionManager.address, trader.address, 1);

                    expect(positionNotionalAndPnL.unrealizedPnl.div(10000)).eq(-1000)
                    expect(positionNotionalAndPnL.positionNotional.div(10000)).eq(498000)

                })

            })

            describe('PnL with partial filled', async () => {
                it('should PnL > 0 with SHORT and partial filled', async () => {
                    // IMPORTANT get Pnl with partially filled order
                    let response1 = (await openLimitPositionAndExpect({
                        limitPrice: 5010,
                        side: SIDE.SHORT,
                        leverage: 10,
                        quantity: 150
                    })) as unknown as PositionLimitOrderID


                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.LONG,
                        price: 5010,
                        expectedSize: BigNumber.from('100')
                    })

                    let response2 = (await openLimitPositionAndExpect({
                        limitPrice: 5000,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 200,
                        _trader: trader2
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('200'),
                        side: SIDE.SHORT,
                        price: 5000,
                        expectedSize: BigNumber.from('-100')
                    })

                    console.log('*** start get PnL ***');
                    const positionNotionalAndPnL = await positionHouse.getPositionNotionalAndUnrealizedPnl(positionManager.address, trader.address, 1);
                    expect(positionNotionalAndPnL.positionNotional.div(10000)).eq(500000)
                    expect(positionNotionalAndPnL.unrealizedPnl.div(10000)).eq(1000)
                })

                it('should PnL < 0 with SHORT and partial filled', async () => {

                    let response1 = (await openLimitPositionAndExpect({
                        limitPrice: 5010,
                        side: SIDE.SHORT,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID


                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.LONG,
                        price: 5010,
                        expectedSize: BigNumber.from('100')
                    })

                    let response2 = (await openLimitPositionAndExpect({
                        limitPrice: 5015,
                        side: SIDE.SHORT,
                        leverage: 10,
                        quantity: 200,
                        _trader: trader2
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('200'),
                        side: SIDE.LONG,
                        price: 5015,
                        expectedSize: BigNumber.from('300')
                    })

                    let response3 = (await openLimitPositionAndExpect({
                        limitPrice: 5020,
                        side: SIDE.SHORT,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('50'),
                        side: SIDE.LONG,
                        price: 5020,
                        expectedSize: BigNumber.from('350')
                    })


                    console.log('*** start get PnL ***');
                    const positionNotionalAndPnL = await positionHouse.getPositionNotionalAndUnrealizedPnl(positionManager.address, trader.address, 1);

                    expect(positionNotionalAndPnL.unrealizedPnl.div(10000)).eq(-1000)
                    expect(positionNotionalAndPnL.positionNotional.div(10000)).eq(753000);

                })

                it('should pnl  > 0 with LONG and partial filled', async () => {

                    let response1 = (await openLimitPositionAndExpect({
                        limitPrice: 4990,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID


                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.SHORT,
                        price: 4990,
                        expectedSize: BigNumber.from('-100')
                    })


                    let response2 = (await openLimitPositionAndExpect({
                        limitPrice: 5000,
                        side: SIDE.SHORT,
                        leverage: 10,
                        quantity: 200,
                        _trader: trader2
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('200'),
                        side: SIDE.LONG,
                        price: 5000,
                        expectedSize: BigNumber.from('100')
                    })


                    let response3 = (await openLimitPositionAndExpect({
                        limitPrice: 4995,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('50'),
                        side: SIDE.SHORT,
                        price: 4995,
                        expectedSize: BigNumber.from('50')
                    })


                    console.log('*** start get PnL ***');
                    const positionNotionalAndPnL = await positionHouse.getPositionNotionalAndUnrealizedPnl(positionManager.address, trader.address, 1);

                    expect(positionNotionalAndPnL.unrealizedPnl.div(10000)).eq(500)
                    expect(positionNotionalAndPnL.positionNotional.div(10000)).eq(749250)

                })

                it('should PnL < 0 with LONG and partial filled', async () => {

                    let response1 = (await openLimitPositionAndExpect({
                        limitPrice: 4990,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID


                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.SHORT,
                        price: 4990,
                        expectedSize: BigNumber.from('-100')
                    })


                    let response2 = (await openLimitPositionAndExpect({
                        limitPrice: 4980,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 200,
                        _trader: trader2
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('200'),
                        side: SIDE.SHORT,
                        price: 4980,
                        expectedSize: BigNumber.from('-300')
                    })

                    let response3 = (await openLimitPositionAndExpect({
                        limitPrice: 4975,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('50'),
                        side: SIDE.SHORT,
                        price: 4975,
                        expectedSize: BigNumber.from('-350')
                    })


                    console.log('*** start get PnL ***');
                    const positionNotionalAndPnL = await positionHouse.getPositionNotionalAndUnrealizedPnl(positionManager.address, trader.address, 1);

                    expect(positionNotionalAndPnL.unrealizedPnl.div(10000)).eq(-1500)
                    expect(positionNotionalAndPnL.positionNotional.div(10000)).eq(746250)

                })
            });

        })


        describe('should close position with close limit', async () => {

            describe('should close position with close limit 100%', async () => {
                it('should close limit with LONG and PnL > 0 with fully filled', async () => {

                    let response1 = (await openLimitPositionAndExpect({
                        limitPrice: 4990,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID


                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.SHORT,
                        price: 4990,
                        expectedSize: BigNumber.from('-100')
                    })


                    let response2 = (await openLimitPositionAndExpect({
                        limitPrice: 5000,
                        side: SIDE.SHORT,
                        leverage: 10,
                        quantity: 50,
                        _trader: trader2
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('50'),
                        side: SIDE.LONG,
                        price: 5000,
                        expectedSize: BigNumber.from('-50')
                    })
                    console.log("line 1902 position house test 1")
                    await positionHouseTestingTool.closeLimitPosition({
                        trader,
                        price: 5005,
                        quantity: 100
                    })

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.LONG,
                        price: 5005,
                        expectedSize: BigNumber.from('50')
                    })

                    const dataClaim = (await positionHouse.canClaimFund(positionManager.address, trader.address)) as unknown as ClaimFund;
                    expect(dataClaim.amount.div(10000)).eq(51400);
                    expect(dataClaim.canClaim).eq(true);


                })

                it('should close limit with SHORT and PnL > 0 with fully filled', async () => {

                    let response1 = (await openLimitPositionAndExpect({
                        limitPrice: 5010,
                        side: SIDE.SHORT,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID


                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.LONG,
                        price: 5010,
                        expectedSize: BigNumber.from('100')
                    })


                    let response2 = (await openLimitPositionAndExpect({
                        limitPrice: 5000,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 50,
                        _trader: trader2
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('50'),
                        side: SIDE.SHORT,
                        price: 5000,
                        expectedSize: BigNumber.from('50')
                    })
                    await positionHouseTestingTool.closeLimitPosition({
                        trader,
                        price: 4995,
                        quantity: 100
                    })

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.SHORT,
                        price: 4995,
                        expectedSize: BigNumber.from('-50')
                    })

                    const dataClaim = (await positionHouse.canClaimFund(positionManager.address, trader.address)) as unknown as ClaimFund;
                    expect(dataClaim.amount.div(10000)).eq(51600);
                    expect(dataClaim.canClaim).eq(true);

                })

                it('should close limit with LONG and PnL > 0 with partial filled', async () => {

                    let response1 = (await openLimitPositionAndExpect({
                        limitPrice: 4990,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID


                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.SHORT,
                        price: 4990,
                        expectedSize: BigNumber.from('-100')
                    })


                    let response2 = (await openLimitPositionAndExpect({
                        limitPrice: 5000,
                        side: SIDE.SHORT,
                        leverage: 10,
                        quantity: 50,
                        _trader: trader2
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('50'),
                        side: SIDE.LONG,
                        price: 5000,
                        expectedSize: BigNumber.from('-50')
                    })
                    await positionHouseTestingTool.closeLimitPosition({
                        trader,
                        price: 5005,
                        quantity: 100
                    })

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('60'),
                        side: SIDE.LONG,
                        price: 5005,
                        expectedSize: BigNumber.from('10')
                    })

                    const dataClaim = (await positionHouse.canClaimFund(positionManager.address, trader.address)) as unknown as ClaimFund;
                    expect(dataClaim.amount.div(10000)).eq(30840);
                    expect(dataClaim.canClaim).eq(true);


                })

                it('should close limit with SHORT and PnL > 0 with partial filled', async () => {

                    let response1 = (await openLimitPositionAndExpect({
                        limitPrice: 5010,
                        side: SIDE.SHORT,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID


                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.LONG,
                        price: 5010,
                        expectedSize: BigNumber.from('100')
                    })


                    let response2 = (await openLimitPositionAndExpect({
                        limitPrice: 5000,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 50,
                        _trader: trader2
                    })) as unknown as PositionLimitOrderID

                    console.log(1771);
                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('50'),
                        side: SIDE.SHORT,
                        price: 5000,
                        expectedSize: BigNumber.from('50')
                    })

                    console.log(1780);
                    // open LONG to close short position
                    await positionHouseTestingTool.closeLimitPosition({
                        trader,
                        price: 4995,
                        quantity: 100
                    })

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('80'),
                        side: SIDE.SHORT,
                        price: 4995,
                        expectedSize: BigNumber.from('-30')
                    })

                    const dataClaim = (await positionHouse.canClaimFund(positionManager.address, trader.address)) as unknown as ClaimFund;
                    expect(dataClaim.amount.div(10000)).eq(41280);
                    expect(dataClaim.canClaim).eq(true);

                })

                it('should close limit with SHORT and PnL < 0 with fully filled', async () => {

                    let response1 = (await openLimitPositionAndExpect({
                        limitPrice: 5000,
                        side: SIDE.SHORT,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID


                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.LONG,
                        price: 5000,
                        expectedSize: BigNumber.from('100')
                    })


                    let response2 = (await openLimitPositionAndExpect({
                        limitPrice: 5020,
                        side: SIDE.SHORT,
                        leverage: 10,
                        quantity: 50,
                        _trader: trader2
                    })) as unknown as PositionLimitOrderID


                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('50'),
                        side: SIDE.LONG,
                        price: 5020,
                        expectedSize: BigNumber.from('150')
                    })
                    await positionHouseTestingTool.closeLimitPosition({
                        trader,
                        price: 5015,
                        quantity: 100
                    })

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('80'),
                        side: SIDE.SHORT,
                        price: 5015,
                        expectedSize: BigNumber.from('70')
                    })

                    const dataClaim = (await positionHouse.canClaimFund(positionManager.address, trader.address)) as unknown as ClaimFund;
                    expect(dataClaim.amount.div(10000)).eq(38800);
                    expect(dataClaim.canClaim).eq(true);


                })

                it('should close limit with LONG and PnL < 0 with fully filled', async () => {

                    let response1 = (await openLimitPositionAndExpect({
                        limitPrice: 5000,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID


                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.SHORT,
                        price: 5000,
                        expectedSize: BigNumber.from('-100')
                    })


                    let response2 = (await openLimitPositionAndExpect({
                        limitPrice: 4990,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 50,
                        _trader: trader2
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('50'),
                        side: SIDE.SHORT,
                        price: 4990,
                        expectedSize: BigNumber.from('-150')
                    })

                    // open LONG to close short position
                    await positionHouseTestingTool.closeLimitPosition({
                        trader,
                        price: 4995,
                        quantity: 100
                    })

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('80'),
                        side: SIDE.LONG,
                        price: 4995,
                        expectedSize: BigNumber.from('-70')
                    })

                    const dataClaim = (await positionHouse.canClaimFund(positionManager.address, trader.address)) as unknown as ClaimFund;
                    expect(dataClaim.amount.div(10000)).eq(39600);
                    expect(dataClaim.canClaim).eq(true);
                })


            })

            describe('close position with close limit when has openMarketPosition', async () => {
                it('close limit when has openMarketPosition SHORT and have no partialFilled before', async () => {
                    let response = (await openLimitPositionAndExpect({
                        _trader: trader1,
                        limitPrice: 4990,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID


                    await openMarketPosition({
                        instanceTrader: trader,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.SHORT,
                        price: 4990,
                        expectedSize: BigNumber.from('-100')
                    });
                    await positionHouseTestingTool.closeLimitPosition({
                        trader,
                        price: 4980,
                        quantity: 100
                    })


                    let response1 = (await openLimitPositionAndExpect({
                        limitPrice: 4985,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 50,
                        _trader: trader1
                    })) as unknown as PositionLimitOrderID


                    await openMarketPosition({
                        instanceTrader: trader2,
                        leverage: 10,
                        quantity: BigNumber.from('50'),
                        side: SIDE.SHORT,
                        price: 4985,
                        expectedSize: BigNumber.from('-50')
                    })

                    const positionDataTrader1 = (await positionHouse.getPosition(positionManager.address, trader1.address)) as unknown as PositionData;
                    console.log("position data trader 1", positionDataTrader1.quantity.toString());


                    console.log('***************line 2025************')
                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.SHORT,
                        // price: 4980,
                        expectedSize: BigNumber.from('50')
                    })

                    // const res = await positionManager.getPendingOrderDetail(pip, orderId)


                })
                it('ERROR open reverse: close limit when has openMarketPosition SHORT and has partialFilled before 01', async () => {
                    // trader1 long at 4990 quantity 100
                    let response = (await openLimitPositionAndExpect({
                        _trader: trader1,
                        limitPrice: 4990,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID

                    // trader market short
                    // trader1 should fullfil
                    await openMarketPosition({
                        instanceTrader: trader,
                        trader: trader.address,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.SHORT,
                        price: 4990,
                        expectedSize: BigNumber.from('-100')
                    });

                    await positionManagerTestingTool.expectPendingOrderByLimitOrderResponse(response, {
                        isFilled: true
                    })

                    await positionHouseTestingTool.expectPositionData(trader1, {
                        quantity: 100
                    })

                    // open a buy limit at price 4980
                    await positionHouseTestingTool.closeLimitPosition({
                        trader,
                        price: 4980,
                        quantity: 100
                    })

                    let response1 = (await openLimitPositionAndExpect({
                        limitPrice: 4985,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 100,
                        _trader: trader1
                    })) as unknown as PositionLimitOrderID


                    await openMarketPosition({
                        instanceTrader: trader2,
                        trader: trader2.address,
                        leverage: 10,
                        quantity: BigNumber.from('50'),
                        side: SIDE.SHORT,
                        price: 4985,
                        expectedSize: BigNumber.from('-50')
                    })

                    await positionManagerTestingTool.expectPendingOrderByLimitOrderResponse(response1, {
                        isFilled: false,
                        size: 100,
                        partialFilled: 50
                    })

                    await positionHouseTestingTool.debugPosition(trader1)
                    await positionHouseTestingTool.expectPositionData(trader1, {
                        quantity: 150
                    })

                    await openMarketPosition({
                        instanceTrader: trader1,
                        trader: trader1.address,
                        leverage: 10,
                        quantity: BigNumber.from('150'),
                        side: SIDE.SHORT,
                        price: 4980,
                        expectedSize: BigNumber.from('50')
                    })
                    await positionManagerTestingTool.debugPendingOrder(response1.pip, response1.orderId)
                })

                it('ERROR open reverse: close limit when has openMarketPosition SHORT and has partialFilled before 02', async () => {

                    let response = (await openLimitPositionAndExpect({
                        _trader: trader1,
                        limitPrice: 4990,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID


                    await openMarketPosition({
                        instanceTrader: trader,
                        trader: trader.address,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.SHORT,
                        price: 4990,
                        expectedSize: BigNumber.from('-100')
                    });
                    await positionHouseTestingTool.closeLimitPosition({
                        trader,
                        price: 4980,
                        quantity: 100
                    })

                    let response1 = (await openLimitPositionAndExpect({
                        limitPrice: 4985,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 100,
                        _trader: trader1
                    })) as unknown as PositionLimitOrderID


                    await openMarketPosition({
                        instanceTrader: trader2,
                        trader: trader2.address,
                        leverage: 10,
                        quantity: BigNumber.from('50'),
                        side: SIDE.SHORT,
                        price: 4985,
                        expectedSize: BigNumber.from('-50')
                    })


                    console.log('***************line 2025************')
                    await openMarketPosition({
                        instanceTrader: trader1,
                        trader: trader1.address,
                        leverage: 10,
                        quantity: BigNumber.from('130'),
                        side: SIDE.SHORT,
                        // price: 4980,
                        expectedSize: BigNumber.from('70')
                    })

                    const positionDataTrader1 = (await positionHouse.getPosition(positionManager.address, trader1.address)) as unknown as PositionData;
                    console.log("position data trader 1", positionDataTrader1.quantity.toString());


                })

            })
        })

        describe('should increase open limit with Pnl ', async () => {
            it('open limit order SHORT has been fully filled and open market with increase position', async () => {
                let response1: any;
                let response2: any;
                let response3: any;

                {
                    response1 = (await openLimitPositionAndExpect({
                        limitPrice: 5010,
                        side: SIDE.SHORT,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.LONG,
                        price: 5010,
                        expectedSize: BigNumber.from('100')
                    });
                }

                {

                    response2 = (await openLimitPositionAndExpect({
                        limitPrice: 5000,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 200,
                        _trader: trader2
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.SHORT,
                        price: 5000,
                        expectedSize: BigNumber.from('0')
                    });
                }

                {
                    response3 = (await openLimitPositionAndExpect({
                        limitPrice: 4995,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 50,
                        _trader: trader2
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader,
                        leverage: 10,
                        quantity: BigNumber.from('50'),
                        side: SIDE.SHORT,
                        price: 5015,
                        expectedSize: BigNumber.from('-150')
                    });
                }


            })

            it('ERROR self filled market: open limit order SHORT has been partial filled and open market with increase position', async () => {
                let response1: any;
                let response2: any;
                let response3: any;

                {
                    response1 = (await openLimitPositionAndExpect({
                        limitPrice: 5010,
                        side: SIDE.SHORT,
                        leverage: 10,
                        quantity: 200
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.LONG,
                        price: 5010,
                        expectedSize: BigNumber.from('100')
                    });
                }

                {

                    response2 = (await openLimitPositionAndExpect({
                        limitPrice: 5000,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 200,
                        _trader: trader2
                    })) as unknown as PositionLimitOrderID
                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.SHORT,
                        price: 5000,
                        expectedSize: BigNumber.from('0')
                    });
                }

                {
                    response3 = (await openLimitPositionAndExpect({
                        limitPrice: 4995,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 50,
                        _trader: trader2
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader,
                        leverage: 10,
                        quantity: BigNumber.from('50'),
                        side: SIDE.SHORT,
                        price: 5015,
                        expectedSize: BigNumber.from('-150')
                    });
                }


            })


        })


        describe('should reduce open limit', async () => {

            it('ERROR self filled market: open limit order has been partialFilled and open market with reduce position', async () => {
                let response1: any;
                let response2: any;
                let response3: any;

                {
                    response1 = (await openLimitPositionAndExpect({
                        limitPrice: 5010,
                        side: SIDE.SHORT,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('30'),
                        side: SIDE.LONG,
                        price: 5010,
                        expectedSize: BigNumber.from('30')
                    });
                }

                // TODO verify expected size
                await openMarketPosition({
                    instanceTrader: trader,
                    leverage: 10,
                    quantity: BigNumber.from('40'),
                    side: SIDE.LONG,
                    price: 5015,
                    expectedSize: BigNumber.from('0')
                });

                const pendingOrder = await positionHouse.getPendingOrder(positionManager.address, response1.pip, response1.orderId);
                expect(pendingOrder.partialFilled).eq(70);


            })
            it('ERROR self filled market: open limit order has been filled and open market with reduce position', async () => {
                let response1: any;
                let response2: any;
                let response3: any;

                {
                    response1 = (await openLimitPositionAndExpect({
                        limitPrice: 5010,
                        side: SIDE.SHORT,
                        leverage: 10,
                        quantity: 100
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.LONG,
                        price: 5010,
                        expectedSize: BigNumber.from('100')
                    });
                }

                {

                    response2 = (await openLimitPositionAndExpect({
                        limitPrice: 5000,
                        side: SIDE.LONG,
                        leverage: 10,
                        quantity: 200,
                        _trader: trader2
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.SHORT,
                        price: 5000,
                        expectedSize: BigNumber.from('0')
                    });
                }


                // TODO verify expected size
                {
                    response3 = (await openLimitPositionAndExpect({
                        limitPrice: 5015,
                        side: SIDE.SHORT,
                        leverage: 10,
                        quantity: 50,
                        _trader: trader2
                    })) as unknown as PositionLimitOrderID

                    await openMarketPosition({
                        instanceTrader: trader,
                        leverage: 10,
                        quantity: BigNumber.from('50'),
                        side: SIDE.LONG,
                        price: 5015,
                        expectedSize: BigNumber.from('-50')
                    });
                }


            })


            it('open limit order has been filled and open market with open reverse', async () => {

                let response1: any;
                let response2: any;
                let response3: any;

                // trader open limit SHORT at price 5010 quantity 100
                response1 = (await openLimitPositionAndExpect({
                    limitPrice: 5010,
                    side: SIDE.SHORT,
                    leverage: 10,
                    quantity: 100
                })) as unknown as PositionLimitOrderID;

                await openMarketPosition({
                    instanceTrader: trader1,
                    leverage: 10,
                    quantity: BigNumber.from('100'),
                    side: SIDE.LONG,
                    price: 5010,
                    expectedSize: BigNumber.from('100')
                });
                response2 = (await openLimitPositionAndExpect({
                    limitPrice: 5000,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 200,
                    _trader: trader2
                })) as unknown as PositionLimitOrderID
                await openMarketPosition({
                    instanceTrader: trader1,
                    leverage: 10,
                    quantity: BigNumber.from('100'),
                    side: SIDE.SHORT,
                    price: 5000,
                    expectedSize: BigNumber.from('0')
                });
                response3 = (await openLimitPositionAndExpect({
                    limitPrice: 5000,
                    side: SIDE.SHORT,
                    leverage: 10,
                    quantity: 200,
                    _trader: trader2
                })) as unknown as PositionLimitOrderID
                await openMarketPosition({
                    instanceTrader: trader,
                    leverage: 10,
                    quantity: BigNumber.from('100'),
                    side: SIDE.LONG,
                    // price: 5015,
                    expectedSize: BigNumber.from('0')
                });

            })


        })

        describe('liquidate with open limit order', async () => {

            it('liquidate partial position with limit order SHORT', async () => {
                let response1: any;
                let response2: any;
                let response3: any;

                response1 = (await openLimitPositionAndExpect({
                    limitPrice: 5000,
                    side: SIDE.SHORT,
                    leverage: 20,
                    quantity: 100
                })) as unknown as PositionLimitOrderID

                await openMarketPosition({
                    instanceTrader: trader1,
                    leverage: 20,
                    quantity: BigNumber.from('100'),
                    side: SIDE.LONG,
                    price: 5000,
                    expectedSize: BigNumber.from('100')
                });

                response2 = (await openLimitPositionAndExpect({
                    limitPrice: 5242,
                    side: SIDE.SHORT,
                    leverage: 20,
                    quantity: 100,
                    _trader: trader1
                })) as unknown as PositionLimitOrderID

                await openMarketPosition({
                    instanceTrader: trader2,
                    leverage: 20,
                    quantity: BigNumber.from('100'),
                    side: SIDE.LONG,
                    price: 5242,
                    expectedSize: BigNumber.from('100')
                });


                const maintenanceDetail = (await positionHouse.getMaintenanceDetail(positionManager.address, trader.address)) as unknown as MaintenanceDetail;
                const positionData = (await positionHouse.getPosition(positionManager.address, trader.address)) as unknown as PositionData;
                const positionNotionalAndPnL1 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address,
                    1
                )


                console.log('margin ', positionData.margin.div(10000).toString());
                console.log('Pnl :', positionNotionalAndPnL1.unrealizedPnl.div(10000).toString())

                console.log('margin maintenanceMargin: ', maintenanceDetail.maintenanceMargin.div(10000).toString());
                console.log('margin balance: ', maintenanceDetail.marginBalance.div(10000).toString());
                console.log('margin marginRatio: ', maintenanceDetail.marginRatio.toString());
                console.log("start liquidate");

                await positionManager.connect(trader1).openLimitPosition(
                    priceToPip(5242),
                    '20',
                    false
                );

                await positionHouse.liquidate(positionManager.address, trader.address);


                const positionData1 = (await positionHouse.getPosition(positionManager.address, trader.address)) as unknown as PositionData;

                console.log('quantity after liquidate ', positionData1.quantity.toString())
                console.log('margin after liquidate ', positionData1.margin.toString())


                expect(positionData1.quantity).eq(-80)

                expect(positionData1.margin.div(10000)).eq(24250)


            })

        })
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
                _positionManager: positionManager,
                expectedSize: BigNumber.from('-2')
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
                _positionManager: positionManager,
                expectedSize: BigNumber.from('-2')
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

        it('should close position with close Market', async function () {
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
                price: 50,
                expectedSize: BigNumber.from('-1000')
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

        it('should liquidate partial position with SHORT', async function () {
            const positionManager2 = (await positionManagerFactory.deploy(priceToPip(5000), '0x8301f2213c0eed49a7e28ae4c3e91722919b8b47')) as unknown as PositionManager;

            await positionManager2.connect(trader1).openLimitPosition(
                priceToPip(5000),
                '100',
                true
            );

            console.log("open market 1");
            // trader0 short at price 50, quantity 1000 TRB, openNotional = 50*1000 = 50000,
            // margin = openNotional / leverage = 500000 / 20 = 25000
            await openMarketPosition({
                quantity: BigNumber.from('100'),
                leverage: 20,
                side: SIDE.SHORT,
                trader: trader.address,
                instanceTrader: trader,
                _positionManager: positionManager2,
                price: 5000,
                expectedSize: BigNumber.from('-100')
            })

            await positionManager2.connect(trader1).openLimitPosition(
                priceToPip(5242),
                '100',
                false
            );

            console.log("open market 2");
            // trader0 short at price 50, quantity 1000 TRB, openNotional = 50*1000 = 50000,
            // margin = openNotional / leverage = 50000 / 20 = 2500
            await openMarketPosition({
                quantity: BigNumber.from('100'),
                leverage: 20,
                side: SIDE.LONG,
                trader: trader2.address,
                instanceTrader: trader2,
                _positionManager: positionManager2,
                price: 5242
            })

            const maintenanceDetail = (await positionHouse.getMaintenanceDetail(positionManager2.address, trader.address)) as unknown as MaintenanceDetail;
            const positionData = (await positionHouse.getPosition(positionManager2.address, trader.address)) as unknown as PositionData;
            const positionNotionalAndPnL1 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                positionManager2.address,
                trader.address,
                1
            )


            console.log('mmargin ', positionData.margin.div(10000).toString());
            console.log('Pnl :', positionNotionalAndPnL1.unrealizedPnl.div(10000).toString())

            console.log('margin maintenanceMargin: ', maintenanceDetail.maintenanceMargin.div(10000).toString());
            console.log('margin balance: ', maintenanceDetail.marginBalance.div(10000).toString());
            console.log('margin marginRatio: ', maintenanceDetail.marginRatio.toString());
            console.log("start liquidate");


            await positionManager2.connect(trader1).openLimitPosition(
                priceToPip(5242),
                '20',
                false
            );

            await positionHouse.liquidate(positionManager2.address, trader.address);


            const positionData1 = (await positionHouse.getPosition(positionManager2.address, trader.address)) as unknown as PositionData;

            console.log('quantity after liquidate ', positionData1.quantity.toString())
            console.log('margin after liquidate ', positionData1.margin.toString())


            expect(positionData1.quantity).eq(-80)

            expect(positionData1.margin.div(10000)).eq(24250)

        });

        it('should liquidate partial position with LONG', async function () {
            const positionManager2 = (await positionManagerFactory.deploy(priceToPip(5000), '0x8301f2213c0eed49a7e28ae4c3e91722919b8b47')) as unknown as PositionManager;
            await positionManager2.connect(trader1).openLimitPosition(
                priceToPip(5000),
                '100',
                false
            );

            console.log("open market 1");
            // trader0 short at price 50, quantity 1000 TRB, openNotional = 50*1000 = 50000,
            // margin = openNotional / leverage = 500000 / 20 = 25000
            await openMarketPosition({
                quantity: BigNumber.from('100'),
                leverage: 20,
                side: SIDE.LONG,
                trader: trader.address,
                instanceTrader: trader,
                _positionManager: positionManager2,
                price: 5000,
                expectedSize: BigNumber.from('100')
            })


            await positionManager2.connect(trader1).openLimitPosition(
                priceToPip(4758),
                '100',
                true
            );

            console.log("open market 2");
            // trader0 short at price 50, quantity 1000 TRB, openNotional = 50*1000 = 50000,
            // margin = openNotional / leverage = 50000 / 20 = 2500
            await openMarketPosition({
                quantity: BigNumber.from('100'),
                leverage: 20,
                side: SIDE.SHORT,
                trader: trader2.address,
                instanceTrader: trader2,
                _positionManager: positionManager2,
                price: 4758,
                expectedSize: BigNumber.from('-100')
                // expect().eq()
            })

            const maintenanceDetail = (await positionHouse.getMaintenanceDetail(positionManager2.address, trader.address)) as unknown as MaintenanceDetail;
            const positionData = (await positionHouse.getPosition(positionManager2.address, trader.address)) as unknown as PositionData;
            const positionNotionalAndPnL1 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                positionManager2.address,
                trader.address,
                1
            )


            console.log('margin ', positionData.margin.div(10000).toString());
            console.log('Pnl :', positionNotionalAndPnL1.unrealizedPnl.div(10000).toString())

            console.log('margin maintenanceMargin: ', maintenanceDetail.maintenanceMargin.div(10000).toString());
            console.log('margin balance: ', maintenanceDetail.marginBalance.div(10000).toString());
            console.log('margin marginRatio: ', maintenanceDetail.marginRatio.toString());
            console.log("start liquidate");


            await positionManager2.connect(trader1).openLimitPosition(
                priceToPip(4758),
                '20',
                true
            );

            await positionHouse.liquidate(positionManager2.address, trader.address);


            const positionData1 = (await positionHouse.getPosition(positionManager2.address, trader.address)) as unknown as PositionData;

            console.log('quantity after liquidate ', positionData1.quantity.toString())
            console.log('margin after liquidate ', positionData1.margin.toString())


            expect(positionData1.quantity).eq(80)

            expect(positionData1.margin.div(10000)).eq(24250)

        });

        it('should liquidate full position with SHORT', async function () {
            const positionManager2 = (await positionManagerFactory.deploy(priceToPip(5000), '0x8301f2213c0eed49a7e28ae4c3e91722919b8b47')) as unknown as PositionManager;
            await positionManager2.connect(trader1).openLimitPosition(
                priceToPip(5000),
                '100',
                true
            );

            console.log("open market 1");
            // trader0 short at price 50, quantity 1000 TRB, openNotional = 50*1000 = 50000,
            // margin = openNotional / leverage = 500000 / 20 = 25000
            await openMarketPosition({
                quantity: BigNumber.from('100'),
                leverage: 20,
                side: SIDE.SHORT,
                trader: trader.address,
                instanceTrader: trader,
                _positionManager: positionManager2,
                price: 5000,
                expectedSize: BigNumber.from('-100')
            })


            await positionManager2.connect(trader1).openLimitPosition(
                priceToPip(5245),
                '100',
                false
            );

            console.log("open market 2");
            // trader0 short at price 50, quantity 1000 TRB, openNotional = 50*1000 = 50000,
            // margin = openNotional / leverage = 50000 / 20 = 2500
            await openMarketPosition({
                quantity: BigNumber.from('100'),
                leverage: 20,
                side: SIDE.LONG,
                trader: trader2.address,
                instanceTrader: trader2,
                _positionManager: positionManager2,
                price: 5245
            })

            const maintenanceDetail = (await positionHouse.getMaintenanceDetail(positionManager2.address, trader.address)) as unknown as MaintenanceDetail;

            const positionData = (await positionHouse.getPosition(positionManager2.address, trader.address)) as unknown as PositionData;
            const positionNotionalAndPnL1 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                positionManager2.address,
                trader.address,
                1
            )


            console.log('mmargin ', positionData.margin.div(10000).toString());
            console.log('Pnl :', positionNotionalAndPnL1.unrealizedPnl.div(10000).toString())

            console.log('margin maintenanceMargin: ', maintenanceDetail.maintenanceMargin.div(10000).toString());
            console.log('margin balance: ', maintenanceDetail.marginBalance.div(10000).toString());
            console.log('margin marginRatio: ', maintenanceDetail.marginRatio.toString());
            console.log("start liquidate");

            await positionHouse.liquidate(positionManager2.address, trader.address);


            const positionData1 = (await positionHouse.getPosition(positionManager2.address, trader.address)) as unknown as PositionData;

            console.log('quantity after liquidate ', positionData1.quantity.toString())
            console.log('margin after liquidate ', positionData1.margin.toString())


            expect(positionData1.quantity).eq(0)

            expect(positionData1.margin.div(10000)).eq(0)

        });


        it('should liquidate full position with LONG', async function () {
            const positionManager2 = (await positionManagerFactory.deploy(priceToPip(5000), '0x8301f2213c0eed49a7e28ae4c3e91722919b8b47')) as unknown as PositionManager;
            await positionManager2.connect(trader1).openLimitPosition(
                priceToPip(5000),
                '100',
                false
            );

            console.log("open market 1");
            // trader0 short at price 50, quantity 1000 TRB, openNotional = 50*1000 = 50000,
            // margin = openNotional / leverage = 500000 / 20 = 25000
            await openMarketPosition({
                quantity: BigNumber.from('100'),
                leverage: 20,
                side: SIDE.LONG,
                trader: trader.address,
                instanceTrader: trader,
                _positionManager: positionManager2,
                price: 5000,
                expectedSize: BigNumber.from('100')
            })


            await positionManager2.connect(trader1).openLimitPosition(
                priceToPip(4755),
                '100',
                true
            );

            console.log("open market 2");
            // trader0 short at price 50, quantity 1000 TRB, openNotional = 50*1000 = 50000,
            // margin = openNotional / leverage = 50000 / 20 = 2500
            await openMarketPosition({
                quantity: BigNumber.from('100'),
                leverage: 20,
                side: SIDE.SHORT,
                trader: trader2.address,
                instanceTrader: trader2,
                _positionManager: positionManager2,
                price: 4755,
                expectedSize: BigNumber.from('-100')
            })

            const maintenanceDetail = (await positionHouse.getMaintenanceDetail(positionManager2.address, trader.address)) as unknown as MaintenanceDetail;

            const positionData = (await positionHouse.getPosition(positionManager2.address, trader.address)) as unknown as PositionData;
            const positionNotionalAndPnL1 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                positionManager2.address,
                trader.address,
                1
            )


            console.log('mmargin ', positionData.margin.div(10000).toString());
            console.log('Pnl :', positionNotionalAndPnL1.unrealizedPnl.div(10000).toString())

            console.log('margin maintenanceMargin: ', maintenanceDetail.maintenanceMargin.div(10000).toString());
            console.log('margin balance: ', maintenanceDetail.marginBalance.div(10000).toString());
            console.log('margin marginRatio: ', maintenanceDetail.marginRatio.toString());
            console.log("start liquidate");

            await positionHouse.liquidate(positionManager2.address, trader.address);


            const positionData1 = (await positionHouse.getPosition(positionManager2.address, trader.address)) as unknown as PositionData;

            console.log('quantity after liquidate ', positionData1.quantity.toString())
            console.log('margin after liquidate ', positionData1.margin.toString())


            expect(positionData1.quantity).eq(0)

            expect(positionData1.margin.div(10000)).eq(0)

        });

    })

    describe('claim fund', async () => {

        it('close position with PnL > 0, trader not claim fund yet and liquidate', async () => {

            const response = (await openLimitPositionAndExpect({
                limitPrice: 5005,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 100,
                _trader: trader
            })) as unknown as PositionLimitOrderID


            await openMarketPosition({
                quantity: BigNumber.from('100'),
                leverage: 20,
                side: SIDE.LONG,
                trader: trader1.address,
                instanceTrader: trader1,
                _positionManager: positionManager,
                price: 5005,
                expectedSize: BigNumber.from('100')
            })


             {
                let response1 = (await openLimitPositionAndExpect({
                    limitPrice: 4900,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 1,
                    _trader: tradercp,
                })) as unknown as PositionLimitOrderID

                await openMarketPosition({
                        quantity: BigNumber.from('1'),
                        leverage: 10,
                        side: SIDE.SHORT,
                        trader: tradercp.address,
                        instanceTrader: tradercp,
                        _positionManager: positionManager,
                        expectedSize: BigNumber.from(0)
                    }
                );
            }


            await positionHouse.closeLimitPosition(positionManager.address, 4850, 75);

            await openMarketPosition({
                    quantity: BigNumber.from('75'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: tradercp.address,
                    instanceTrader: tradercp,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from(-76)
                }
            );

            //
            // {
            //     let response1 = (await openLimitPositionAndExpect({
            //         limitPrice: 5500,
            //         side: SIDE.SHORT,
            //         leverage: 10,
            //         quantity: 1,
            //         _trader: tradercp,
            //     })) as unknown as PositionLimitOrderID
            //
            //     await openMarketPosition({
            //             quantity: BigNumber.from('1'),
            //             leverage: 10,
            //             side: SIDE.LONG,
            //             trader: tradercp.address,
            //             instanceTrader: tradercp,
            //             _positionManager: positionManager,
            //             expectedSize: BigNumber.from(-1)
            //         }
            //     );
            // }
            //
            //
            //
            // await positionHouse.liquidate(positionManager.address, trader.address);
            //
            //
            // const positionData1 = (await positionHouse.getPosition(positionManager.address, trader.address)) as unknown as PositionData;
            //
            // console.log('quantity after liquidate ', positionData1.quantity.toString())
            // console.log('margin after liquidate ', positionData1.margin.toString())

            //
            // expect(positionData1.quantity).eq(-80)
            //
            // expect(positionData1.margin.div(10000)).eq(24250)
            //












        })

    })
})
