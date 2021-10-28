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
import { CHAINLINK_ABI_TESTNET} from "../../constants";

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
    let chainlinkContract : any;

    beforeEach(async () => {
        [trader0, trader1, trader2, trader3, trader4, trader5, tradercp] = await ethers.getSigners()
        positionManagerFactory = await ethers.getContractFactory("PositionManager")
        // BTC-USD Perpetual, initial price is 5000
        // each pip = 0.01
        // => initial pip = 500000
        //quoteAsset    BUSD_TestNet = 0x8301f2213c0eed49a7e28ae4c3e91722919b8b47
        positionManager = (await positionManagerFactory.deploy(500000, '0x8301f2213c0eed49a7e28ae4c3e91722919b8b47')) as unknown as PositionManager;
        const factory = await ethers.getContractFactory("PositionHouse")
        const provider = await ethers.getDefaultProvider('https://data-seed-prebsc-1-s1.binance.org:8545/')
        chainlinkContract = new ethers.Contract('0xf805e852ef3794c6c3bf5ab4254f02e8906d8863', CHAINLINK_ABI_TESTNET, provider)
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
        const tx = await positionHouse.connect(_trader).openLimitOrder(_positionManager.address, side, quantity, priceToPip(Number(limitPrice)), leverage)
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
        const positionTrader = (await positionHouse.getPosition(positionManagerAddress, traderAddress)) as unknown as PositionData
        console.log("expect all: openNotional, positionNotional, margin, unrealizedPnl", Number(positionTrader.openNotional.div(10000)), Number(positionNotionalAndPnLTrader.positionNotional.div(10000)), Number(positionTrader.margin.div(10000)), Number(positionNotionalAndPnLTrader.unrealizedPnl.div(10000)))
        if (expectedQuantity != 0) {
            expect(positionTrader.quantity).eq(expectedQuantity);
        }
        if (expectedOpenNotional != undefined) expect(positionNotionalAndPnLTrader.unrealizedPnl.div(10000)).eq(expectedPnl)
        expect(positionTrader.openNotional.div(10000)).eq(expectedOpenNotional);
        expect(positionTrader.margin.div(10000)).eq(expectedMargin);
        return true;
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

            const expectTrader1 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 24900,
                expectedMargin: 2490,
                expectedPnl: 150,
                expectedQuantity: -5
            });

            const expectTrader2 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 10000,
                expectedMargin: 1000,
                expectedPnl: -100,
                expectedQuantity: 2
            });

            const expectTrader3 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader3.address,
                expectedOpenNotional: 15030,
                expectedMargin: 1503,
                expectedPnl: 180,
                expectedQuantity: -3
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
            console.log("done step 1")
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

            console.log("done step 2")

            // ******************************
            //-S3: Trade2 open Limit Short(5005,7)
            //-S4: Trade1 open Market LONG(3)
            let response2 = (await openLimitPositionAndExpect({
                limitPrice: 5005,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 7,
                _trader: trader2
            })) as unknown as PositionLimitOrderID
            console.log("done step 3")

            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-6')
                }
            );
            console.log("done step 4")


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
            console.log("done step 5")

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
            console.log("done step 6")

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
            console.log("done step 7")

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
            console.log("done step 8")

            const expectTrader2AfterS8 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 20020,
                expectedMargin: 2002,
                expectedPnl: 220,
                expectedQuantity: -4
            });

            const expectTrader0AfterS8 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 19800,
                expectedMargin: 1980,
                expectedPnl: 0,
                expectedQuantity: 4
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
            console.log("done step 9")

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
            console.log("done step 10")

            // ERROR return 29890 instead of 29820 because reduce limit order got wrong entryPrice, expected to get entryPrice = 5005 but it got average price of 5005*7 and 4900*2
            const expectTrader2AfterS10 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 29820,
                expectedMargin: 2982,
                expectedPnl: 490,
                expectedQuantity: -6
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
            console.log("done step 11")

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

            // -S1: Trade0 open Limit Long(4980,10)
            // -S2: Trade1 open Market SHORT(4)
            let response1Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10,
                _trader: trader0
            })) as unknown as PositionLimitOrderID
            console.log("done S1")

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
            console.log("done S2")
            // -S3: Trade0 open Limit Short(5000,9)
            // -S4: Trade2 open MARKET LONG(6)
            let response2Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 9,
                _trader : trader0
            })) as unknown as PositionLimitOrderID
            console.log("done S3")
            await openMarketPosition({
                    quantity: BigNumber.from('6'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('6')
                }
            );
            console.log("done S4")
            // ERROR Pnl, margin and OP
            const expectTrader0AfterS4 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 10000,
                expectedMargin: 1000,
                expectedPnl: 0,
                expectedQuantity: -2
            });

            // -S5: Trade3 open Limit short(5010,5)
            // -S6: Trade1 open MARKET LONG(8)
            let response1Trader3 = (await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 5,
                _trader : trader3
            })) as unknown as PositionLimitOrderID
            console.log("done S5")
            await openMarketPosition({
                    quantity: BigNumber.from('8'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );
            console.log("done S6")
            // ERROR Pnl, margin and OP
            const expectTrader0AfterS6 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 10000,
                expectedMargin: 1000,
                expectedPnl: 0,
                expectedQuantity: -5
            });

            // -S7: Trade0 open Limit Long(4990,6)
            // -S8: Trade1 open MARKET SHORT(5)
            let response3Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 6,
                _trader : trader0
            })) as unknown as PositionLimitOrderID
            console.log("done S7")

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );
            console.log("done S8")

            // -S9: Trade2 open MARKET SHORT(7)
            // -S10: Trade3 open Limit long(4950,7)
            // -S11: Trade4 open Market SHORT(7)
            await openMarketPosition({
                    quantity: BigNumber.from('7'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );
            console.log("done S9")

            let response2Trader3 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 7,
                _trader : trader3
            })) as unknown as PositionLimitOrderID
            console.log("done S10")

            await openMarketPosition({
                    quantity: BigNumber.from('7'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader4.address,
                    instanceTrader: trader4,
                    _positionManager: positionManager,
                }
            );
            console.log("done S11")

            // - S12: Trade(ps1) open Limit SHORT (4970,2)
            // - S13: Trade(ps2) open Market LONG(2)
            await changePrice({
                limitPrice : 4970,
                toHigherPrice : true
            })
            // ERROR Pnl, margin and OP
            const expectTrader0End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 34920,
                expectedMargin: 3492,
                expectedPnl: -70,
                expectedQuantity: 7
            });

            // CORRECT
            const expectTrader1End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 4990,
                expectedMargin: 499,
                expectedPnl: 20,
                expectedQuantity: -1
            });

            // CORRECT
            const expectTrader2End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 4980,
                expectedMargin: 498,
                expectedPnl: 10,
                expectedQuantity: -1
            });

            // ERROR Pnl, margin and OP
            const expectTrader3End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader3.address,
                expectedOpenNotional: 9900,
                expectedMargin: 990,
                expectedPnl: 40,
                expectedQuantity: 2
            });
        })

        /**
         * PS_FUTU_25
         -S1: Trade0 open Limit Long(4950,7) => 3 left when end
         -S2: Trade1 open Market Short(4)
         -S3: Trade2 open Limit Short(5005,5)
         -S4: Trade1 open Market LONG(5)
         -S5: Trade0 open Limit Short(5010,7) => 1 left when end
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
            //-S1: Trade0 open Limit Long(4950,7) => 3 left when end
            //-S2: Trade1 open Market Short(4)
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 7,
                _trader: trader0
            })) as unknown as PositionLimitOrderID
            console.log("done s1");

            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );
            console.log("done s2");

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
            console.log("done s3");

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
            console.log("done s4");

            // *****************************
            //-S5: Trade0 open Limit Short(5010,7) => 1 left when end
            //-S6: Trade1 open Market LONG(6)
            let response3 = (await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 7,
                _trader: trader0
            })) as unknown as PositionLimitOrderID
            console.log("done s5");

            await openMarketPosition({
                    quantity: BigNumber.from('6'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('7')
                }
            );
            console.log("done s6");

            // ERROR expectedMargin should be 3506.5 but underflow
            const expectTrader1AfterS6 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 35065,
                expectedMargin: 3506.5,
                expectedPnl: 5,
                expectedQuantity: 7
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
            console.log("done s7");

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager,
                }
            );
            console.log("done s8");

            // ERROR Pnl, margin and OP
            const expectTrader0 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 35020,
                expectedMargin: 3502,
                expectedPnl: -36,
                expectedQuantity: -7
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
            console.log("done s9");

            await openMarketPosition({
                    quantity: BigNumber.from('2'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );
            console.log("done s10");

            // CORRECT
            const expectTrader2AfterS10 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 0,
                expectedMargin: 0,
                expectedPnl: 0,
                expectedQuantity: 0
            });

            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                }
            );
            console.log("done s11");

            await changePrice({limitPrice: 5008, toHigherPrice: true})

            // ERROR Pnl, margin and OP
            const expectTrader0End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 35020,
                expectedMargin: 3502,
                expectedPnl: -36,
                expectedQuantity: -7
            });

            // ERROR expectedMargin should be 3506.5 but underflow
            const expectTrader1End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 35065,
                expectedMargin: 3506,
                expectedPnl: -9,
                expectedQuantity: 7
            });

        })

    })


    describe('Open Reverse + Increase', async () => {
        /**
         * PS_FUTU_26
         -S1: Trade0 open Limit Long(4950,7) => 1 left when end
         -S2: Trade1 open Limit short(5010,9)
         -S3: Trade2 open Market Short(6)
         -S4: Trade3 open Limit short(5020,8) => 1 left when end
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
            //-S1: Trader0 open Limit Long(4950,7) => 1 left when end
            //-S2: Trader1 open Limit short(5010,9)
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 7,
                _trader: trader0
            })) as unknown as PositionLimitOrderID
            console.log("done s1");

            let response2 = (await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 9,
                _trader: trader1
            })) as unknown as PositionLimitOrderID
            console.log("done s2");

            // *****************************
            // -S3: Trader2 open Market Short(6)
            // -S4: Trader3 open Limit short(5020,8) => 1 left when end
            await openMarketPosition({
                    quantity: BigNumber.from('6'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );
            console.log("done s3");

            let response3 = (await openLimitPositionAndExpect({
                limitPrice: 5020,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 8,
                _trader: trader3
            })) as unknown as PositionLimitOrderID
            console.log("done s4");

            // *****************************
            //-S5: Trader1 open Market Long(12)
            //-S6: Trader0 open Limit Long(5000,5)
            await openMarketPosition({
                    quantity: BigNumber.from('12'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );
            console.log("done s5");

            let response4 = (await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 5,
                _trader: trader0
            })) as unknown as PositionLimitOrderID
            console.log("done s6");

            // *****************************
            //-S7: Trader1 open Market Short(4)
            //-S8: Trader2 open Limit Long(4990,8)
            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );
            console.log("done s7");

            const expectTrader1AfterS7 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 5000,
                expectedMargin: 500,
                expectedPnl: 0,
                expectedQuantity : -1
            });

            let response5 = (await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 8,
                _trader: trader2
            })) as unknown as PositionLimitOrderID
            console.log("done s8");



            // *****************************
            // -S9: Trader0 open Market Short(9)
            // -S10: Trader2 open Limit Short(5007,4)
            // -S11: Trader3 open Market Long(8)
            await openMarketPosition({
                    quantity: BigNumber.from('9'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager
                }
            );
            console.log("done s9");

            // ERROR Pnl, margin and ON
            // const expectTrader2AfterS9 = await expectMarginPnlAndOP({
            //     positionManagerAddress: positionManager.address,
            //     traderAddress: trader2.address,
            //     expectedOpenNotional: 9980,
            //     expectedMargin: 998 ,
            //     expectedPnl: 0,
            //     expectedQuantity : 2
            // });

            // ERROR Pnl, margin and ON. ON supposed to be 9940 but expected 9970
            // const expectTrader0AfterS9 = await expectMarginPnlAndOP({
            //     positionManagerAddress: positionManager.address,
            //     traderAddress: trader0.address,
            //     expectedOpenNotional: 9940,
            //     expectedMargin: 994 ,
            //     expectedPnl: 40,
            //     expectedQuantity : 2
            // });

            let response6 = (await openLimitPositionAndExpect({
                limitPrice: 5007,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 4,
                _trader: trader2
            })) as unknown as PositionLimitOrderID
            console.log("done s10");

            await openMarketPosition({
                    quantity: BigNumber.from('8'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager
                }
            );
            console.log("done s11");

            // ERROR Pnl, margin and ON
            // const expectTrader2AfterS11 = await expectMarginPnlAndOP({
            //     positionManagerAddress: positionManager.address,
            //     traderAddress: trader2.address,
            //     expectedOpenNotional: 10014,
            //     expectedMargin: 1001.4 ,
            //     expectedPnl: 0,
            //     expectedQuantity : -2
            // });

            // ERROR Quantity. Quantity supposed to be 1 but expected 5
            // trader3 self filled 4 quantity of limit order short and not counted
            console.log("expectTrader3AfterS11")
            const expectTrader3AfterS11 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader3.address,
                expectedOpenNotional: 5007,
                expectedMargin: 500.7 ,
                expectedPnl: -2,
                expectedQuantity : 1
            });

            // -S12: Trader(cp) open Limit Long(5008,3)
            // -S13: Trader(cp1) open Market SHORT(3)
            await changePrice({limitPrice: 5008, toHigherPrice: true})



        })

        /**
         * PS_FUTU_27
         -S1: Trader0 open Limit Short(5010,6)
         -S2: Trader1 open Limit Short(5020,7)
         -S3: Trader2 open Market Long(10)
         -S4: Trader3 open Limit Long(5000,6)
         -S5: Trader0 open Market Long(3)
         -S6: Trader1 open Market Short(5)
         -S7: Trader2 open Limit Short(5008,7)
         -S8: Trader3 open Market Long(2)
         -S9: Trader0 open Market Long(5)
         -S10: Trader1 open Limit Long(4990,6)
         -S11: Trader2 open Market Short(4)
         -S12: Trader3 open Market Short(3)

         - B13: Trader(cp) open Limit LONG(4980,2)
         - B14: Trader(cp) open MARKET SHORT(2)
         */
        it('PS_FUTU_27', async () => {


            // *****************************
            // -S1: Trader0 open Limit Short(5010,6)
            // -S2: Trader1 open Limit Short(5020,7)
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
            //-S3: Trader2 open Market Long(10)
            //-S4: Trader3 open Limit Long(5000,6)
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
            // -S5: Trader0 open Market Long(3)
            // -S6: Trader1 open Market Short(5)
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
            // -S7: Trader2 open Limit Short(5008,7)
            // -S8: Trader3 open Market Long(2)
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
            // -S9: Trader0 open Market Long(5)
            // -S10: Trader1 open Limit Long(4990,6)
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
            // -S11: Trader2 open Market Short(4)
            // -S12: Trader3 open Market Short(3)
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
         -S1: Trader0 open Limit Long(4995,7)
         -S2: Trader1 open Limit Short(5010,8)
         -S3: Trader2 open Market Long(3)
         -S4: Trader3 open Market Short(6)
         -S5: Trader0 open Limit Long(4990,8)
         -S6: Trader1 open Market Short(5)
         -S7: Trader2 open Market short(4)
         -S8: Trader3 open Limit Long(4980,4)
         -S9: Trader0 open Market Short(3)
         -S10: Trader2 open Market long(4)
         -S11: Trader1 open Market Long(1)
         -S12: Trader0 open Limit Long(4950,2)
         -S13: Trader3 open Market Short(3)

         -S14: Trader(cp0) open Limit Short(5015,6)
         -S15: Trader(cp1) open Market Long(6)
         */
        it('PS_FUTU_28', async () => {
            // *****************************
            //-S1: Trader0 open Limit Long(4995,7)
            // -S2: Trader1 open Limit Short(5010,8)
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
            //-S3: Trader2 open Market Long(3)
            //-S4: Trader3 open Market Short(6)
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
            //-S5: Trader0 open Limit Long(4990,8)
            //-S6: Trader1 open Market Short(5)
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
            // -S7: Trader2 open Market short(4)
            // -S8: Trader3 open Limit Long(4980,4)
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
            // -S9: Trader0 open Market Short(3)
            // -S10: Trader2 open Market long(4)
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


            // -S11: Trader1 open Market Long(1)
            // -S12: Trader0 open Limit Long(4950,2)
            // -S13: Trader3 open Market Short(3)

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
         - S1: Trader1 open limit LONG (4990,5)
         - S2: Trader0 open MARKET SHORT (5)
         - S3: Trader2 open limit SHORT  (5010, 1)
         - S4: Trader3 open market LONG (1)
         - S5: Trader0 open limit LONG (5005,2)
         - S6: Trader1 open reverse MARKET position SHORT( 2)

         - S5: Tradercp open Limit LONG(5000,2)
         - S6: Tradercp open MARKET SHORT(2)

         */
        it('PS_FUTU_29', async () => {
            // *****************************
            //- S1: Trader1 open limit LONG (4990,5)
            //- S2: Trader0 open MARKET SHORT (5)
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
                    side: SIDE.LONG,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                }
            );


            // *****************************
            // - S5: Trader0 open limit LONG (5005,2)
            // - S6: Trader1 open reverse MARKET position SHORT( 2)
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
                }
            );

            await changePrice({limitPrice: 5000, toHigherPrice: false})

            const expectTrader0End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 14970,
                expectedMargin: 1497,
                expectedPnl: -30,
                expectedQuantity : -3
            });

            const expectTrader1End = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 14970,
                expectedMargin: 1497,
                expectedPnl: 30,
                expectedQuantity : 3
            });
        })

    })

    describe('position with price  > currentPrice', async () => {
        /**
         * PS_FUTU_31
         -S1: Trader0 open Limit Short(4995,7)
         -S2: Trader1 open Limit Short(5010,8)
         -S3: Trader0 open Limit Short(5020,8)
         -S4: Trader2 open Limit Long(5030,19)
         -S5: Trader3 open Limit Long(5020,6)
         -S6: Trader1 open Limit Long(5000,9)
         -S7: Trader2 open Market Short(8)
         -S8: Trader1 open Limit Short(4990,7)
         -S9: Trader3 open Market Long(4)
         -S10: Trader0 open Limit Short(5010,3)
         -S11: Trader2 open Market Long(3)

         - S11: Trader(cp) open Limit long(5000,2)
         - S12: Trader(cp) open MARKET short(2)
         */
        it('PS_FUTU_31', async () => {

            // *****************************
            //-S1: Trader0 open Limit Short(4995,7)
            //-S2: Trader1 open Limit Short(5010,8)
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
            // -S3: Trader0 open Limit Short(5020,8)
            // -S4: Trader2 open Limit Long(5030,19)
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
            // -S5: Trader3 open Limit Long(5020,6)
            // -S6: Trader1 open Limit Long(5000,9)
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
            // -S7: Trader2 open Market Short(8)
            // -S8: Trader1 open Limit Short(4990,7)
            await openMarketPosition({
                    quantity: BigNumber.from('8'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
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
            // -S9: Trader3 open Market Long(4)
            // -S10: Trader0 open Limit Short(5010,3)
            // -S11: Trader2 open Market Long(3)

            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
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
                }
            );

            await changePrice({limitPrice: 5000, toHigherPrice: false})


        })

    })


    describe('Open reverse and partial self filled', async function () {
        /**
         * PS_FUTU_102
         -S1: Trader0 open Limit Long(4990,10)
         -S2: Trader1 open Limit Long(4950,5)
         -S3: Trader2 open Market Short(12)
         -S4: Trader0 open Limit LONG(4900,5)
         -S5: Trader1 open Market Short(8)
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
                expectedPnl: -900,
                expectedQuantity : 15
            });

            const expectTrader2 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 59800,
                expectedMargin: 5980,
                expectedPnl: 1000
            });

            // ERROR expected wrong quantity and ON because of self filled
            const expectTrader1 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 4900,
                expectedMargin: 490,
                expectedPnl: 0
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

            const expectTrader0 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 39450,
                expectedMargin: 3945,
                expectedPnl: -170
            });

            const expectTrader1 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 4900,
                expectedMargin: 490,
                expectedPnl: -10
            });

            const expectTrader2 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 34700,
                expectedMargin: 3470,
                expectedPnl: 330
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

            // S1: Trader0 open limit order Long (4950, 5)
            // S2: Trader1 open market order Short (5)
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

            // S3: Trader2 open limit order Long (4900,10)
            // S4: Trader1 open 2 limit order Long (4940,3), (4890,5)
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

            // S5: Trader2 open market order Short (8)
            // S6: Trader1 open market order Short (10)
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

            const expectTrader0 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 24750,
                expectedMargin: 2475,
                expectedPnl: -300
            });

            // ERROR expected wrong quantity and ON because of self filled
            const expectTrader1 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 34400,
                expectedMargin: 3440,
                expectedPnl: 170
            });

            const expectTrader2 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 9800,
                expectedMargin: 980,
                expectedPnl: -20
            });
        })

    })

    describe('Increase size and reverse twice', async function () {

        /**
         * PS_FUTU_109
         S1: Trader0 open limit long (4900,10)
         S2: Trader1 open market short (8)
         S3: Trader2 open limit long (4890,5)
         S4: Trader1 open market short (5)
         S5: Trader0 open limit short (5000,20)
         S6: Trader1 open market long (20)
         S7: Trader2 open limit long (4950,5)
         S8: Trader1 open limit long (4980,20)
         S9: Trader0 open market short (22)
         S10: Trader1 open limit short (5100,10)
         S11: Trader2 open market long (10)
         S12: Current price is 5100
         */
        it('PS_FUTU_109', async function () {

            // S1: Trader0 open limit long (4900,10)
            // S2: Trader1 open market short (8)
            let response1Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 10,
                _trader: trader0
            })) as unknown as PositionLimitOrderID
            console.log("done S1")

            await openMarketPosition({
                    quantity: BigNumber.from('8'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );
            console.log("done S2")

            // S3: Trader2 open limit long (4890,5)
            // S4: Trader1 open market short (5)
            let response1Trader2 = (await openLimitPositionAndExpect({
                limitPrice: 4890,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 5,
                _trader: trader2
            })) as unknown as PositionLimitOrderID
            console.log("done S3")

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );
            console.log("done S4")

            const expectTrader1AfterS4 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 63670,
                expectedMargin: 6367,
                expectedPnl: 100,
                expectedQuantity: -13,
            });

            // S5: Trader0 open limit short (5000,20)
            // S6: Trader1 open market long (20)
            let response2Trader0 = (await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 20,
                _trader: trader0
            })) as unknown as PositionLimitOrderID
            console.log("done S5")

            await openMarketPosition({
                    quantity: BigNumber.from('20'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );
            console.log("done S6")

            // ERROR wrong Pnl, ON and margin because of wrong entryPrice when getReduceLimitOrder
            // const expectTrader0AfterS6 = await expectMarginPnlAndOP({
            //     positionManagerAddress: positionManager.address,
            //     traderAddress: trader0.address,
            //     expectedOpenNotional: 50000,
            //     expectedMargin: 5000,
            //     expectedPnl: 0,
            //     expectedQuantity: -10,
            // });

            const expectTrader1AfterS6 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 35000,
                expectedMargin: 3500,
                expectedPnl: 0,
                expectedQuantity: 7,
            });

            // S7: Trader2 open limit long (4950,5)
            // S8: Trader1 open limit long (4980,20)
            let response2Trader2 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 5,
                _trader: trader2
            })) as unknown as PositionLimitOrderID
            console.log("done S7")

            let response1Trader1 = (await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 20,
                _trader: trader1
            })) as unknown as PositionLimitOrderID
            console.log("done S8")

            // S9: Trader0 open market short (22)
            // S10: Trader1 open limit short (5100,10)
            // S11: Trader2 open market long (10)
            await openMarketPosition({
                    quantity: BigNumber.from('22'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader0.address,
                    instanceTrader: trader0,
                    _positionManager: positionManager,
                }
            );
            console.log("done S9")

            // ERROR wrong Pnl, ON and margin because of wrong entryPrice when getReduceLimitOrder
            const expectTrader0AfterS9 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader0.address,
                expectedOpenNotional: 159500,
                expectedMargin: 15950,
                expectedPnl: 1100,
                expectedQuantity: -32,
            });

            // CORRECT
            const expectTrader1AfterS9 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 134600,
                expectedMargin: 13460,
                expectedPnl: -950,
                expectedQuantity: 27,
            });

            let response2Trader1 = (await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 10,
                _trader: trader1
            })) as unknown as PositionLimitOrderID
            console.log("done S10")

            await openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );
            console.log("done S11")

            // ERROR expected ON, margin and Pnl are decimals but underflow
            const expectTrader1AfterS11 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: 84748.148,
                expectedMargin: 8474.815,
                expectedPnl: 1951.8518,
                expectedQuantity: 17,
            });

            const expectTrader2AfterS11 = await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader2.address,
                expectedOpenNotional: 75570,
                expectedMargin: 7557,
                expectedPnl: 930,
                expectedQuantity: 15,
            });
        })
    })

    describe('Calc market twap', async function () {

        /**
         * PS_FUTU_200
         S1: Current price 5000
         S2: Price change to 5100
         S3: Price change to 5200 after 5s
         S4: Price change to 4800 after 5s
         S5: Calc twap market price with interval = 100s
         */
        it('PS_FUTU_200: Calc market twap', async function () {
            console.log("time after s0", Date.now())
            await changePrice({
                limitPrice : 5100,
                toHigherPrice : true,
            })

            await changePrice({
                limitPrice : 5200,
                toHigherPrice : true,
            })

            await changePrice({
                limitPrice : 4800,
                toHigherPrice : false,
            })

            await changePrice({
                limitPrice : 4900,
                toHigherPrice : true,
            })

            await changePrice({
                limitPrice : 4950,
                toHigherPrice : true,
            })

            await changePrice({
                limitPrice : 5000,
                toHigherPrice : true,
            })

            await changePrice({
                limitPrice : 4900,
                toHigherPrice : false,
            })

            await positionManager.getAllReserveSnapshotTest();
            console.log("price feed", (await chainlinkContract.getPrice('0x4254430000000000000000000000000000000000000000000000000000000000')).toString())

            const twapMarketPrice = await positionManager.getTwapPrice(13);
            console.log(twapMarketPrice)
            expect(twapMarketPrice.div(10000)).eq(Math.floor((4800*2+5200*2+5100*2+5000*1+4900*2+4950*2+5000*2)/13))
        })
    })

})