import {BigNumber, BigNumberish, ContractFactory, Signer, Wallet} from 'ethers'
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
import {
    ClaimFund,
    LimitOrderReturns,
    PositionData,
    PositionLimitOrderID,
    ChangePriceParams,
    priceToPip, SIDE,
    toWeiBN,
    toWeiWithString, ExpectTestCaseParams
} from "../shared/utilities";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

describe("PositionHouse_02", () => {
    let positionHouse: PositionHouse;
    let trader0: any;
    let trader1: any;
    let trader2: any;
    let trader3: any;
    let trader4: any;
    let trader5: any;
    let tradercp: any;
    let positionManager: PositionManager;
    let positionManagerFactory: ContractFactory;

    beforeEach(async () => {
        [trader0, trader1, trader2, trader3, trader4, trader5, tradercp] = await ethers.getSigners()
        positionManagerFactory = await ethers.getContractFactory("PositionManager")
        // BTC-USD Perpetual, initial price is 5000
        // each pip = 0.01
        // => initial pip = 500000
        //quoteAsset    BUSD_TestNet = 0x8301f2213c0eed49a7e28ae4c3e91722919b8b47
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
        trader?: string,
        instanceTrader: any,
        expectedMargin?: BigNumber,
        expectedNotional?: BigNumber | string,
        expectedSize?: BigNumber,
        price?: number,
        _positionManager?: any
    }) => {
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
        expectedNotional = expectedNotional && expectedNotional.toString() || quantity.mul(price).toString()
        // console.table([
        //     {
        //         openNotional: positionInfo.openNotional.toString(),
        //         openNotionalFormated: openNotional,
        //         currentPrice: currentPrice,
        //         quantity: positionInfo.quantity.toString()
        //     }
        // ])
        // expect(positionInfo.quantity.toString()).eq(expectedSize || quantity.toString())
        // expect(openNotional).eq(expectedNotional)
        // expectedMargin && expect(positionInfo.margin.div('10000').toString()).eq(expectedMargin.toString())
    }

    interface OpenLimitPositionAndExpectParams {
        _trader?: SignerWithAddress
        limitPrice: number | string
        leverage: number,
        quantity: number
        side: number
        _positionManager?: PositionManager
    }


    async function debugPendingOrder(pip: any, orderId: any) {
        const res = await positionManager.getPendingOrderDetail(pip, orderId)
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
        _trader = _trader || trader0
        if (!_positionManager) throw Error("No position manager")
        if (!_trader) throw Error("No trader")
        const tx = await positionHouse.connect(_trader).openLimitOrder(_positionManager.address, side, quantity, priceToPip(Number(limitPrice)), leverage, true)
        console.log("GAS USED LIMIT", (await tx.wait()).gasUsed.toString())
        const {orderId, priceLimit} = await getOrderIdByTx(tx)
        console.log('orderId: ', orderId.toString())
        console.log('priceLimit: ', priceLimit.toString());
        // const positionLimitInOrder = (await positionHouse["getPendingOrder(address,bytes)"](_positionManager.address, orderId)) as unknown as PendingOrder;
        // expect(positionLimitInOrder.size.toNumber()).eq(quantity);

        return {
            orderId: orderId,
            pip: priceToPip(Number(limitPrice))
        } as LimitOrderReturns
        // expect(positionLimitInOrder..div(10000)).eq(limitPrice);
    }


    async function changePrice({
                                   limitPrice,
                                   toHigherPrice
                               }: ChangePriceParams) {
        if (toHigherPrice) {
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: limitPrice,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 3,
                _trader: tradercp,
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: tradercp.address,
                    instanceTrader: tradercp,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from(0)
                }
            );
        } else {
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: limitPrice,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 3,
                _trader: tradercp,
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: tradercp.address,
                    instanceTrader: tradercp,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from(0)
                }
            );
        }
    }

    async function expectMarginPnlAndOP({
                                            positionManagerAddress,
                                            traderAddress,
                                            expectedOpenNotional,
                                            expectedMargin,
                                            expectedPnl = undefined,
                                            expectedQuantity = 0
                                        }: ExpectTestCaseParams) {
        const positionNotionalAndPnLTrader = await positionHouse.getPositionNotionalAndUnrealizedPnl(
            positionManagerAddress,
            traderAddress,
            1
        )
        console.log("expect margin pnl and op");
        const positionTrader = (await positionHouse.getPosition(positionManagerAddress, traderAddress)) as unknown as PositionData
        expect(positionTrader.openNotional.div((10000))).eq(expectedOpenNotional);
        if (expectedQuantity != 0) {
            expect(positionTrader.quantity.div((10000))).eq(expectedQuantity);
        }
        expect(positionTrader.margin.div((10000))).eq(expectedMargin);
        console.log("expect success", positionTrader.openNotional, positionTrader.margin, positionNotionalAndPnLTrader.unrealizedPnl);
        if (expectedOpenNotional != undefined) expect(positionNotionalAndPnLTrader.unrealizedPnl.div(10000)).eq(expectedPnl)
        return true;
        // balance.address,
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
        // console.log(t)
        const positionData1 = (await positionHouse.connect(instanceTrader).getPosition(_positionManager.address, trader)) as unknown as PositionData;
        // await positionHouse.connect(instanceTrader).closePosition(_positionManager.address, BigNumber.from(positionData1.quantity.toString()));
        await positionHouse.connect(instanceTrader).closePosition(_positionManager.address);
        const positionData = (await positionHouse.getPosition(_positionManager.address, trader)) as unknown as PositionData;
        expect(positionData.margin).eq(0);
        expect(positionData.quantity).eq(0);
    }

    describe('reduce size position', async function () {


        it('reduce size by reverse limit order', async function () {


        })


    })

    describe('Increase size in order', async () => {

        /**
         * Code: PS_FUTU_21
         - S1: Trade0 open Limit Long(4980,8)
         - S2: Trade1 open Market SHORT(8)
         - S3: Trade2 open Limit Long(4950,7)
         - S4: Trade1 open market SHORT(5)
         - S5: Trade0 open Limit Long(4900,6)
         - S6: Trade1 open Market SHORT(5)
         - S7: Trade3 open Market SHORT(1)
         - S8: Trade2 open Limit Long(4850,4)=>  2
         - S9: Trade3 open Market SHORT(4)

         - S10: Trade(cp1) open Limit short(5000,2)
         - S11: Trade(cp2) open Market long(2)
         */
        it('PS_FUTU_21 increase size by market order and limit order', async () => {
            console.log('****** Step 1 and Step 2')
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 8,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('8'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader0.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-8')
                }
            );


            console.log('****** Step 3 and Step 4')

            let response2 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 7,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-13'),
                }
            );


            console.log('****** Step 5 and Step 6')

            let response3 = (await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 6,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-18'),
                }
            );


            console.log('****** Step 7 and Step 8')

            await openMarketPosition({
                    quantity: BigNumber.from('1'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-1')
                }
            );

            let response4 = (await openLimitPositionAndExpect({
                limitPrice: 4850,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 4,
                _trader: trader2
            })) as unknown as PositionLimitOrderID


            console.log('****** Step 9')

            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-5'),
                    expectedNotional: BigNumber.from('24400')
                }
            );

            console.log('****** Step 10 and 11')

            await changePrice({
                limitPrice: 5000,
                toHigherPrice: true
            })

            const expectTrader0 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 69240,
                expectedMargin: 6924,
                expectedPnl: 760
            });

            const expectTrader1 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 89190,
                expectedMargin: 8919,
                expectedPnl: -810
            });

            const expectTrader2 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 44350,
                expectedMargin: 4435,
                expectedPnl: 650
            });

            const expectTrader3 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader3.address,
                expectedOpenNotional: 24400,
                expectedMargin: 2440,
                expectedPnl: -600
            });
        })

    })

    describe('Market reverse Market > Limit reverse Limit', async () => {

        /**
         PS_FUTU_22
         -S1: Trade0 open Limit Long(4980,15)
         -S2: Trade1 open Market SHORT(11)
         -S3: Trade0 open Limit Short(5000,3)
         -S4: Trade2 open MARKET LONG(3)

         -S5: Trade3 open Limit SHORT(5010,5)
         -S6: Trade1 open MARKET LONG(4)
         -S7: Trade0 open Limit Short(5020,2)=> have 1
         -S8: Trade1 open MARKET LONG(2)

         -S9: Trade2 open MARKET SHORT(1)
         -S10: Trade3 open Limit long(4970,2)
         -S11: Trade4 open Market SHORT(5)

         - S12: Trade(cp1) open Limit LONG(4950,2)
         - S13: Trade(cp2) open Market SHORT(2)
         */

        it('PS_FUTU_22: Market reverse Market; Limit reverse Limit', async () => {

            // ******************************
            //-S1: Trade0 open Limit Long(4980,15)
            //-S2: Trade1 open Market SHORT(11)
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 15,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('11'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-11')
                }
            );


            // *****************************
            //-S3: Trade0 open Limit Short(5000,3)
            //-S4: Trade2 open MARKET LONG(3)
            let response2 = (await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 3,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('3')
                }
            );


            // *****************************
            //-S5: Trade3 open Limit SHORT(5010,5)
            //-S6: Trade1 open MARKET LONG(4)
            let response3 = (await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 5,
                _trader: trader3
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-7')
                }
            );


            // *****************************
            //-S7: Trade0 open Limit Short(5020,2)=> have 1
            //-S8: Trade1 open MARKET LONG(2)
            let response4 = (await openLimitPositionAndExpect({
                limitPrice: 5020,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 2,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('2'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-5')
                }
            );

            // *****************************
            //-S9: Trade2 open Market Short(1)
            //-S10: Trade3 open Limit Long(4970, 2)
            //-S11: Trade4 open MARKET Short(5)
            await openMarketPosition({
                    quantity: BigNumber.from('1'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('2')
                }
            );

            let response5 = (await openLimitPositionAndExpect({
                limitPrice: 4970,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 2,
                _trader: trader3
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader4.address,
                    instanceTrader: trader4,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-5')
                }
            );

            await changePrice({
                limitPrice: 4950,
                toHigherPrice: false
            })

            const expectTrader0 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 54780,
                expectedMargin: 5478,
                expectedPnl: -330,
                expectedQuantity: 11
            });
            console.log("expect trader0", expectTrader0);
            console.log("line 583")
            const expectTrader1 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 89190,
                expectedMargin: 8919,
                expectedPnl: -810,
            });

            const expectTrader2 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 44350,
                expectedMargin: 4435,
                expectedPnl: 650,
            });

            const expectTrader3 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader3.address,
                expectedOpenNotional: 24400,
                expectedMargin: 2440,
                expectedPnl: -600,
            });
        })


        /**
         PS_FUTU_24
         -S1: Trade0 open Limit Long(4950,10)
         -S2: Trade1 open Market Short(9)
         -S3: Trade2 open Limit Short(5005,7)
         -S4: Trade1 open Market LONG(3)
         -S5: Trade0 open Limit Short(5010,2)
         -S6: Trade1 open Market LONG(6)
         -S7: Trade2 open Limit Long(5000,3)
         -S8: Trade0 open Market Short(4)
         -S9: Trade3 open Limit Long(4900,4)
         -S10: Trade2 open Market SHORT(2)
         -S11: Trade3 open MARKET SHORT(2)

         -S12: Trade(cp) open Limit short(5008,3)
         -S13: Trade(cp1) open Market long(3)
         */
        it('PS_FUTU_24', async () => {

            // ******************************
            //-S1: Trade0 open Limit Long(4950,10)
            //-S2: Trade1 open Market Short(9)
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('9'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-9')
                }
            );


            // ******************************
            //-S3: Trade2 open Limit Short(5005,7)
            //-S4: Trade1 open Market LONG(3)
            let response2 = (await openLimitPositionAndExpect({
                limitPrice: 5005,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 7,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-8')
                }
            );


            // ******************************
            //-S5: Trade0 open Limit Short(5010,2)
            //-S6: Trade1 open Market LONG(6)
            let response3 = (await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 2,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('6'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-2')
                }
            );

            const expectTrader1AfterS6 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 0,
                expectedMargin: 0,
                expectedPnl: 0,
            });

            // ******************************
            //-S7: Trade2 open Limit Long(5000,3)
            //-S8: Trade0 open Market Short(4)
            let response4 = (await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 3,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('4')
                }
            );

            const expectTrader0AfterS8 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 29700,
                expectedMargin: 2970,
                expectedPnl: 232,
            });

            // ******************************
            //-S9: Trade3 open Limit Long(4900,4)
            //-S10: Trade2 open Market SHORT(2)
            //-S11: Trade3 open MARKET SHORT(2)
            let response5 = (await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 4,
                _trader: trader3
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('2'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-4')
                }
            );

            const expectTrader2AfterS10 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 30050,
                expectedMargin: 3005,
                expectedPnl: -15,
            });

            await openMarketPosition({
                    quantity: BigNumber.from('2'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-2')
                }
            );

            await changePrice({limitPrice: 5008, toHigherPrice: true})

            const expectTrader3End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader3.address,
                expectedOpenNotional: 9800,
                expectedMargin: 980,
                expectedPnl: 216,
            });

        })


    })

    describe('openReversePosition old Quantity < new quantity  (Market reverse Market; Limit reverse Limit)', async () => {

        /**
         * PS_FUTU_23
         -S1: Trade0 open Limit Long(4980,10)
         -S2: Trade1 open Market SHORT(4)
         -S3: Trade0 open Limit Short(5000,9)
         -S4: Trade2 open MARKET LONG(6)

         -S5: Trade3 open Limit short(5010,5)
         -S6: Trade1 open MARKET LONG(8)
         -S7: Trade0 open Limit Long(4990,6)
         -S8: Trade1 open MARKET SHORT(5)

         -S9: Trade2 open MARKET SHORT(7)
         -S10: Trade3 open Limit long(4950,7)
         -S11: Trade4 open Market SHORT(7)

         - S12: Trade(ps1) open Limit SHORT (4970,2)
         - S13: Trade(ps2) open Market LONG(2)
         */
        it('PS_FUTU_23', async () => {

            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 5,
                _trader: trader1
            })) as unknown as PositionLimitOrderID
            console.log("line 246")

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-5')
                }
            );

            await changePrice({limitPrice: 5010, toHigherPrice: true})

            await positionHouse.connect(trader0).closeLimitPosition(positionManager.address, priceToPip(Number(5005)), 2);

            // let response2 = (await openLimitPositionAndExpect({
            //     limitPrice: 5005,
            //     side: SIDE.LONG,
            //     leverage: 10,
            //     quantity: 2
            // })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('2'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('3')
                }
            );

            const dataClaimTrader1 = (await positionHouse.canClaimFund(positionManager.address, trader1.address)) as unknown as ClaimFund;
            expect(dataClaimTrader1.amount.div(10000)).eq(968);
            expect(dataClaimTrader1.canClaim).eq(true);


            await changePrice({limitPrice: 5000, toHigherPrice: false})


            const positionData1 = (await positionHouse.getPosition(positionManager.address, trader0.address)) as unknown as PositionData;
            const positionNotionalAndPnL1 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                positionManager.address,
                trader0.address,
                1
            )
            expect(positionNotionalAndPnL1.unrealizedPnl.div(10000)).eq(-30)


            // expect(positionData1.openNotional.div(10000)).eq(14970)
            // expect(positionData1.margin.div(10000)).eq(1497)
            expect(positionNotionalAndPnL1.unrealizedPnl.div(10000)).eq(-30)


        })

        /**
         * PS_FUTU_25
         -S1: Trade0 open Limit Long(4950,7) 3
         -S2: Trade1 open Market Short(4)
         -S3: Trade2 open Limit Short(5005,5)
         -S4: Trade1 open Market LONG(5)
         -S5: Trade0 open Limit Short(5010,7) 1
         -S6: Trade1 open Market LONG(6)
         -S7: Trade2 open Limit Long(5000,7)
         -S8: Trade0 open Market short(5)
         -S9: Trade3 open Limit Long(4990,4)
         -S10: Trade2 open Market SHORT(2)
         -S11: Trade3 open MARKET SHORT(4)

         -S12: Trade(cp) open Limit short(5008,3)
         -S13: Trade(cp1) open Market long(3)
         */
        it('PS_FUTU_25', async () => {

            // *****************************
            //-S1: Trade0 open Limit Long(4950,7) 3
            //-S2: Trade1 open Market Short(4)
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 7,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-4')
                }
            );


            // *****************************
            //-S3: Trade2 open Limit Short(5005,5)
            //-S4: Trade1 open Market LONG(5)
            let response2 = (await openLimitPositionAndExpect({
                limitPrice: 5005,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 5,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('1')
                }
            );


            // *****************************
            //-S5: Trade0 open Limit Short(5010,7) 1
            //-S6: Trade1 open Market LONG(6)
            let response3 = (await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 5,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('1')
                }
            );





            const expectTrader1 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 35065,
                expectedMargin: 3506.5,
                expectedPnl: undefined
            });





            // *****************************
            //-S7: Trade2 open Limit Long(5000,7)
            //-S8: Trade0 open Market short(5)
            let response4 = (await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 7,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('')
                }
            );

            const expectTrader0 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 35020,
                expectedMargin: 3502,
                expectedPnl: undefined
            });


            // *****************************
            //-S9: Trade3 open Limit Long(4990,4)
            //-S10: Trade2 open Market SHORT(2)
            //-S11: Trade3 open MARKET SHORT(4)
            let response5 = (await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 4,
                _trader: trader3
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('')
                }
            );


            const expectTrader2 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 0,
                expectedMargin: 0,
                expectedPnl: undefined
            });


            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('')
                }
            );


            await changePrice({limitPrice: 5008, toHigherPrice: true})


        })

    })


    describe('Open Reverse + Increase', async () => {
        /**
         * PS_FUTU_26
         -S1: Trade0 open Limit Long(4950,7) 1 =>  1
         -S2: Trade1 open Limit short(5010,9)
         -S3: Trade2 open Market Short(6)
         -S4: Trade3 open Limit short(5020,8) 5 =>1
         -S5: Trade1 open Market Long(12)
         -S6: Trade0 open Limit Long(5000,5)
         -S7: Trade1 open Market Short(4)
         -S8: Trade2 open Limit Long(4990,8)
         -S9: Trade0 open Market Short(9)
         -S10: Trade2 open Limit Short(5007,4)
         -S11:Trade3 open Market Long(8)

         -S12: Trade(cp) open Limit Long(5008,3)
         -S13: Trade(cp1) open Market SHORT(3)
         */

        it('PS_FUTU_26', async () => {

            // *****************************
            //-S1: Trade0 open Limit Long(4950,7) 1 =>  1
            //-S2: Trade1 open Limit short(5010,9)
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 7,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            let response2 = (await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 9,
                _trader: trader1
            })) as unknown as PositionLimitOrderID


            // *****************************
            // -S3: Trade2 open Market Short(6)
            // -S4: Trade3 open Limit short(5020,8) 5 =>1
            await openMarketPosition({
                    quantity: BigNumber.from('6'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-6')
                }
            );

            let response3 = (await openLimitPositionAndExpect({
                limitPrice: 5020,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 8,
                _trader: trader3
            })) as unknown as PositionLimitOrderID


            // *****************************
            //-S5: Trade1 open Market Long(12)
            //-S6: Trade0 open Limit Long(5000,5)
            await openMarketPosition({
                    quantity: BigNumber.from('12'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('3')
                }
            );

            let response4 = (await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 5,
                _trader: trader0
            })) as unknown as PositionLimitOrderID


            // *****************************
            //-S7: Trade1 open Market Short(4)
            //-S8: Trade2 open Limit Long(4990,8)
            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-1')
                }
            );


            const expectTrader1 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 5000,
                expectedMargin: 500,
                expectedPnl: undefined
            });

            let response5 = (await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 8,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            // *****************************
            // -S9: Trade0 open Market Short(9)
            // -S10: Trade2 open Limit Short(5007,4)
            // -S11:Trade3 open Market Long(8)
            await openMarketPosition({
                    quantity: BigNumber.from('9'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('3')
                }
            );

            const expectTrader = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 9940,
                expectedMargin: 994 ,
                expectedPnl: undefined
            });

            const expectTrader0 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 9940,
                expectedMargin: 994,
                expectedPnl: undefined
            });


            let response6 = (await openLimitPositionAndExpect({
                limitPrice: 5007,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 4,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('8'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('2')
                }
            );


            await changePrice({limitPrice: 5008, toHigherPrice: false})

        })

        /**
         * PS_FUTU_27
         -S1: Trade0 open Limit Short(5010,6)
         -S2: Trade1 open Limit Short(5020,7)
         -S3: Trade2 open Market Long(10)
         -S4: Trade3 open Limit Long(5000,6)
         -S5: Trade0 open Market Long(3)
         -S6: Trade1 open Market Short(5)
         -S7: Trade2 open Limit Short(5008,7)
         -S8: Trade3 open Market Long(2)
         -S9: Trade0 open Market Long(5)
         -S10: Trade1 open Limit Long(4990,6)
         -S11: Trade2 open Market Short(4)
         -S12: Trade3 open Market Short(3)

         - B13: Trade(cp) open Limit LONG(4980,2)
         - B14: Trade(cp) open MARKET SHORT(2)
         */
        it('PS_FUTU_27', async () => {


            // *****************************
            // -S1: Trade0 open Limit Short(5010,6)
            // -S2: Trade1 open Limit Short(5020,7)
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 6,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            let response2 = (await openLimitPositionAndExpect({
                limitPrice: 5020,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 7,
                _trader: trader1
            })) as unknown as PositionLimitOrderID


            // *****************************
            //-S3: Trade2 open Market Long(10)
            //-S4: Trade3 open Limit Long(5000,6)
            await openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('10')
                }
            );

            let response3 = (await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 6,
                _trader: trader3
            })) as unknown as PositionLimitOrderID


            // *****************************
            // -S5: Trade0 open Market Long(3)
            // -S6: Trade1 open Market Short(5)
            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-3')
                }
            );

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-12')
                }
            );

            // *****************************
            // -S7: Trade2 open Limit Short(5008,7)
            // -S8: Trade3 open Market Long(2)
            let response4 = (await openLimitPositionAndExpect({
                limitPrice: 5008,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 7,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('2'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('4')
                }
            );

            // *****************************
            // -S9: Trade0 open Market Long(5)
            // -S10: Trade1 open Limit Long(4990,6)
            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('2')
                }
            );
            let response5 = (await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 6,
                _trader: trader2
            })) as unknown as PositionLimitOrderID


            // *****************************
            // -S11: Trade2 open Market Short(4)
            // -S12: Trade3 open Market Short(3)
            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-1')
                }
            );
            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('1')
                }
            );


            await changePrice({limitPrice: 4980, toHigherPrice: false})


        })


        /**
         * PS_FUTU_28
         -S1: Trade0 open Limit Long(4995,7)
         -S2: Trade1 open Limit Short(5010,8)
         -S3: Trade2 open Market Long(3)
         -S4: Trade3 open Market Short(6)
         -S5: Trade0 open Limit Long(4990,8)
         -S6: Trade1 open Market Short(5)
         -S7: Trade2 open Market short(4)
         -S8: Trade3 open Limit Long(4980,4)
         -S9: Trade0 open Market Short(3)
         -S10: Trade2 open Market long(4)
         -S11: Trade1 open Market Long(1)
         -S12: Trade0 open Limit Long(4950,2)
         -S13: Trade3 open Market Short(3)

         -S14: Trade(cp0) open Limit Short(5015,6)
         -S15: Trade(cp1) open Market Long(6)
         */
        it('PS_FUTU_28', async () => {
            // *****************************
            //-S1: Trade0 open Limit Long(4995,7)
            // -S2: Trade1 open Limit Short(5010,8)
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4995,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 7,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            let response2 = (await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 8,
                _trader: trader1
            })) as unknown as PositionLimitOrderID


            // *****************************
            //-S3: Trade2 open Market Long(3)
            //-S4: Trade3 open Market Short(6)
            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-3')
                }
            );

            await openMarketPosition({
                    quantity: BigNumber.from('6'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-6')
                }
            );


            // *****************************
            //-S5: Trade0 open Limit Long(4990,8)
            //-S6: Trade1 open Market Short(5)
            let response3 = (await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 8,
                _trader: trader1
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('6'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-6')
                }
            );


            // *****************************
            // -S7: Trade2 open Market short(4)
            // -S8: Trade3 open Limit Long(4980,4)
            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-1')
                }
            );

            let response4 = (await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 4,
                _trader: trader3
            })) as unknown as PositionLimitOrderID


            // *****************************
            // -S9: Trade0 open Market Short(3)
            // -S10: Trade2 open Market long(4)
            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('')
                }
            );


            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('')
                }
            );


            // -S11: Trade1 open Market Long(1)
            // -S12: Trade0 open Limit Long(4950,2)
            // -S13: Trade3 open Market Short(3)

            await openMarketPosition({
                    quantity: BigNumber.from('1'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('')
                }
            );

            let response5 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 2,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('')
                }
            );


            await changePrice({limitPrice: 5015, toHigherPrice: true})


        })

    })

    describe('Limit reverse market', async () => {

        /**
         PS_FUTU_29
         - S1: Trade1 open limit LONG (4990,5)
         - S2: Trade0 open MARKET SHORT (5)
         - S3: Trader2 open limit SHORT  (5010, 1)
         - S4: Trader3 open market LONG (1)
         - S5: Trade0 open limit LONG (5005,2)
         - S6: Trade1 open reverse MARKET position SHORT( 2)

         - S5: Tradeps open Limit LONG(5000,2)
         - S6: Tradeps open MARKET SHORT(2)

         */
        it('PS_FUTU_29', async () => {
            // *****************************
            //- S1: Trade1 open limit LONG (4990,5)
            //- S2: Trade0 open MARKET SHORT (5)
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 5,
                _trader: trader1
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-5')
                }
            );


            // *****************************
            //- S3: Trader2 open limit SHORT  (5010, 1)
            //- S4: Trader3 open market LONG (1)
            let response2 = (await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 1,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('1'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-1')
                }
            );


            // *****************************
            // - S5: Trade0 open limit LONG (5005,2)
            // - S6: Trade1 open reverse MARKET position SHORT( 2)
            let response3 = (await openLimitPositionAndExpect({
                limitPrice: 5005,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 2,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('2'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('3')
                }
            );


            await changePrice({limitPrice: 5000, toHigherPrice: false})


        })

    })

    describe('position with price  > currentPrice', async () => {
        /**
         * PS_FUTU_31
         -S1: Trade0 open Limit Short(4995,7)
         -S2: Trade1 open Limit Short(5010,8)
         -S3: Trade0 open Limit Short(5020,8)
         -S4: Trade2 open Limit Long(5030,19)
         -S5: Trade3 open Limit Long(5020,6)
         -S6: Trade1 open Limit Long(5000,9)
         -S7: Trade2 open Market Short(8)
         -S8: Trade1 open Limit Short(4990,7)
         -S9: Trade3 open Market Long(4)
         -S10: Trade0 open Limit Short(5010,3)
         -S11: Trade2 open Market Long(3)

         - S11: Trade(cp) open Limit long(5000,2)
         - S12: Trade(cp) open MARKET short(2)
         */
        it('PS_FUTU_30', async () => {

            // *****************************
            //-S1: Trade0 open Limit Short(4995,7)
            //-S2: Trade1 open Limit Short(5010,8)
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4995,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 7,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            let response2 = (await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 8,
                _trader: trader1
            })) as unknown as PositionLimitOrderID


            // *****************************
            // -S3: Trade0 open Limit Short(5020,8)
            // -S4: Trade2 open Limit Long(5030,19)
            let response3 = (await openLimitPositionAndExpect({
                limitPrice: 5020,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 8,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            let response4 = (await openLimitPositionAndExpect({
                limitPrice: 5030,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 19,
                _trader: trader2
            })) as unknown as PositionLimitOrderID


            // *****************************
            // -S5: Trade3 open Limit Long(5020,6)
            // -S6: Trade1 open Limit Long(5000,9)
            let response5 = (await openLimitPositionAndExpect({
                limitPrice: 5020,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 6,
                _trader: trader3
            })) as unknown as PositionLimitOrderID

            let response6 = (await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 9,
                _trader: trader1
            })) as unknown as PositionLimitOrderID


            // *****************************
            // -S7: Trade2 open Market Short(8)
            // -S8: Trade1 open Limit Short(4990,7)
            await openMarketPosition({
                    quantity: BigNumber.from('8'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('')
                }
            );

            let response8 = (await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 7,
                _trader: trader1
            })) as unknown as PositionLimitOrderID


            // *****************************
            // -S9: Trade3 open Market Long(4)
            // -S10: Trade0 open Limit Short(5010,3)
            // -S11: Trade2 open Market Long(3)

            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('')
                }
            );

            let response9 = (await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 3,
                _trader: trader0
            })) as unknown as PositionLimitOrderID


            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('')
                }
            );

            await changePrice({limitPrice: 5000, toHigherPrice: false})


        })

    })


    describe('Open reverse and partial self filled', async function () {
        /**
         * PS_FUTU_102
         -S1: Trade0 open Limit Long(4990,10)
         -S2: Trade1 open Limit Long(4950,5)
         -S3: Trade2 open Market Short(12)
         -S4: Trade0 open Limit LONG(4900,5)
         -S5: Trade1 open Market Short(8)
         -S6: Price change to 4900
         */
        it('PS_FUTU_102: increase limit position quantity', async function () {
            let response1Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            let response1Trader1 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 5,
                _trader: trader1
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('12'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-12')
                }
            );

            let response2Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 5,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('8'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-6')
                }
            );

            const expectTrader0 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 74400,
                expectedMargin: 7440,
                expectedPnl: -900
            });

            const expectTrader1 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 4900,
                expectedMargin: 490,
                expectedPnl: 0
            });

            const expectTrader2 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 59800,
                expectedMargin: 5980,
                expectedPnl: 1000
            });
        })

        /**
         * PS_FUTU_106
         S1: Trader0 open limit order Long (4950, 5)
         S2: Trader1 open limit order Long (4980,3)
         S3: Trader2 open market order Short (6)
         S4: Trader0 open limit order Long (4900,5)
         S5: Trader1 open market order Short (5)
         S6: Trader2 open limit order Short(4910,1)
         S7: Trader1 open market order Long (1)
         S8: Current price 4910
         */
        it('PS_FUTU_106: reverse limit position quantity', async function () {
            /**
             S1: Trader0 open limit order Long (4950, 5)
             S2: Trader1 open limit order Long (4980,3)
             S3: Trader2 open market order Short (6) => fulfill S2, partial fill S1
             */
            let response1Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 5,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            let response1Trader1 = (await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 3,
                _trader: trader1
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('6'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-6')
                }
            );

            let response2Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 5,
                _trader: trader0
            })) as unknown as PositionLimitOrderID


            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-2')
                }
            );

            let response2Trader2 = (await openLimitPositionAndExpect({
                limitPrice: 4910,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 1,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('1'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-1')
                }
            );

            // UPDATE EXPECT
            const expectTrader0 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 10000,
                expectedMargin: 5000,
                expectedPnl: 6000
            });

            const expectTrader1 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 10000,
                expectedMargin: 5000,
                expectedPnl: 6000
            });

            const expectTrader2 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 10000,
                expectedMargin: 5000,
                expectedPnl: 6000
            });
        })

        /**
         * PS_FUTU_107
         S1: Trader0 open limit order Long (4950, 5)
         S2: Trader1 open market order Short (5)
         S3: Trader2 open limit order Long (4900,10)
         S4: Trader1 open 2 limit order Long (4940,3), (4890,5)
         S5: Trader2 open market order Short (8)
         S6: Trader1 open market order Short (10)
         S7: Current price 4890
         */
        it('PS_FUTU_107: reverse by different order type, self filled', async function () {
            let response1Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 5,
                _trader: trader0
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-5')
                }
            );

            let response1Trader2 = (await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            let response1Trader1 = (await openLimitPositionAndExpect({
                limitPrice: 4940,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 3,
                _trader: trader1
            })) as unknown as PositionLimitOrderID

            let response2Trader1 = (await openLimitPositionAndExpect({
                limitPrice: 4890,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 5,
                _trader: trader1
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('8'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-6')
                }
            );

            await openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-6')
                }
            );

            // UPDATE EXPECT
            const expectTrader0 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 74400,
                expectedMargin: 7440,
                expectedPnl: -900
            });

            const expectTrader1 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 4900,
                expectedMargin: 490,
                expectedPnl: 0
            });

            const expectTrader2 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 59800,
                expectedMargin: 5980,
                expectedPnl: 1000
            });
        })

    })

})