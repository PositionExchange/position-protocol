import {BigNumber, BigNumberish, ContractFactory, Signer, Wallet} from 'ethers'
import {ethers, waffle} from 'hardhat'
import {deployContract, loadFixture} from "ethereum-waffle";

const {solidity} = waffle

import {expect, use} from 'chai'
import InsuranceFundArtifact from '../../artifacts/contracts/protocol/InsuranceFund.sol/InsuranceFund.json'
import {PositionManager, PositionHouse, ChainLinkPriceFeed, BEP20Mintable, InsuranceFund} from "../../typeChain";
import {
    ClaimFund, LimitOrderReturns,
    MaintenanceDetail, NotionalAndUnrealizedPnlReturns, OpenLimitPositionAndExpectParams,
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

use(solidity)

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
    let trader4: any;
    let trader5: any
    let positionManager: PositionManager;
    let positionManagerFactory: ContractFactory;
    let positionManagerTestingTool: PositionManagerTestingTool
    let positionHouseTestingTool: PositionHouseTestingTool
    let bep20Mintable: BEP20Mintable
    let insuranceFund: InsuranceFund

    beforeEach(async () => {
        [trader, trader1, trader2, trader3, trader4, trader5] = await ethers.getSigners();

        // Deploy position house function contract
        const positionHouseFunction = await ethers.getContractFactory('PositionHouseFunction')
        const libraryIns = (await positionHouseFunction.deploy())
        const PositionHouseMath = await ethers.getContractFactory('PositionHouseMath')
        const positionHouseMath = await PositionHouseMath.deploy()

        // Deploy mock busd contract
        const bep20MintableFactory = await ethers.getContractFactory('BEP20Mintable')
        bep20Mintable = (await bep20MintableFactory.deploy('BUSD Mock', 'BUSD')) as unknown as BEP20Mintable

        // Deploy insurance fund contract
        const insuranceFundFactory = await ethers.getContractFactory('InsuranceFund')
        insuranceFund = (await insuranceFundFactory.deploy()) as unknown as InsuranceFund

        // Deploy position manager contract
        positionManagerFactory = await ethers.getContractFactory("PositionManager")
        positionManager = (await positionManagerFactory.deploy()) as unknown as PositionManager;

        // Deploy position house contract
        const factory = await ethers.getContractFactory("PositionHouse", {
            libraries: {
                PositionHouseFunction: libraryIns.address,
                PositionHouseMath: positionHouseMath.address
            }
        })
        positionHouse = (await factory.deploy()) as unknown as PositionHouse;
        await insuranceFund.connect(trader).initialize()
        await insuranceFund.connect(trader).setCounterParty(positionHouse.address);

        [trader, trader1, trader2, trader3, trader4, trader5].forEach(element => {
            bep20Mintable.mint(element.address, BigNumber.from('10000000000000000000000000000000'))
            bep20Mintable.connect(element).approve(insuranceFund.address, BigNumber.from('1000000000000000000000000000000000000'))
        })
        positionManagerTestingTool = new PositionManagerTestingTool(positionManager)
        positionHouseTestingTool = new PositionHouseTestingTool(positionHouse, positionManager)

        await positionManager.initialize(BigNumber.from(500000), bep20Mintable.address, ethers.utils.formatBytes32String('BTC'), BigNumber.from(100), BigNumber.from(10000), BigNumber.from(10000), BigNumber.from(3000), BigNumber.from(1000), '0x5741306c21795FdCBb9b265Ea0255F499DFe515C'.toLowerCase(), positionHouse.address);
        await positionHouse.initialize(BigNumber.from(3), BigNumber.from(80), BigNumber.from(3), BigNumber.from(20), insuranceFund.address)

        await positionHouse.updateWhitelistManager(positionManager.address, true);
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
                                          _positionManager = positionManager,
                                          expectRevertMsg
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
        _positionManager?: any,
        expectRevertMsg?: string
    }) => {
        // @ts-ignore
        console.group(`Open Market Order: ${sideObj[side.toString()]} ${quantity}`)
        trader = instanceTrader && instanceTrader.address || trader
        if (!trader) throw new Error("No trader")
        const task = positionHouse.connect(instanceTrader).openMarketPosition(
            _positionManager.address,
            side,
            quantity,
            leverage,
        )
        if (expectRevertMsg) {
            await expect(task).to.be.revertedWith(expectRevertMsg)
            return
        } else {
            const tx = await task
            console.log("GAS USED MARKET", (await tx.wait()).gasUsed.toString())
        }
        console.log(`START GET POSITION FOR EXPECTING`, trader, instanceTrader.address)

        const positionInfo = await positionHouse.getPosition(_positionManager.address, trader) as unknown as PositionData;
        // console.log("positionInfo", positionInfo)
        const currentPrice = Number((await _positionManager.getPrice()).toString())
        const openNotional = positionInfo.openNotional.toString()
        // expectedNotional = expectedNotional && expectedNotional.toString() || quantity.mul(price).toString()
        console.log(`┌─────────┬──────────────┬──────────────────────┬──────────────┬──────────┐`)
        console.log(`Position Info of ${trader}`)
        console.table([
            {
                openNotional: positionInfo.openNotional.toString(),
                openNotionalFormated: openNotional,
                margin: positionInfo.margin.toString(),
                currentPrice: currentPrice,
                quantity: positionInfo.quantity.toString()
            }
        ])
        // expect(positionInfo.quantity.toString()).eq(expectedSize || quantity.toString(), "Quantity not match")
        // expect(openNotional).eq(expectedNotional)
        // expectedMargin && expect(positionInfo.margin.toString()).eq(expectedMargin.toString())
        console.groupEnd()
    }

    async function getOrderIdByTx(tx: any) {
        const receipt = await tx.wait();
        const orderId = ((receipt?.events || [])[1]?.args || [])['orderId'] || ((receipt?.events || [])[2]?.args || [])['orderId'] ||  ((receipt?.events || [])[3]?.args || [])['orderId']
        return orderId
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
        const tx = await positionHouse.connect(_trader).openLimitOrder(_positionManager.address, side, quantity, priceToPip(Number(limitPrice)), leverage)
        console.log("GAS USED LIMIT", (await tx.wait()).gasUsed.toString())
        const receipt = await tx.wait()
        console.log("Gas used to open limit order", receipt.gasUsed.toString())
        const orderId = await getOrderIdByTx(tx)
        console.log("order id", orderId)
        const pip = priceToPip(Number(limitPrice))
        // await positionManagerTestingTool.expectPendingOrder({
        //     pip,
        //     orderId,
        //     isFilled: false,
        //     size: quantity,
        //     partialFilled: 0
        // })
        return {
            orderId: (orderId),
            pip : pip.toString(),
        } as LimitOrderReturns
        // expect(positionLimitInOrder.).eq(limitPrice);
    }

    async function cancelLimitOrder(positionManagerAddress: string, trader: SignerWithAddress, orderId : string, pip : string) {
        const listPendingOrder = await positionHouse.connect(trader).getListOrderPending(positionManagerAddress, trader.address)
        const obj = listPendingOrder.find(x => () => {
            (x.orderId.toString() == orderId && x.pip.toString() == pip)
        });
        await positionHouse.connect(trader).cancelLimitOrder(positionManagerAddress, obj.orderIdx, obj.isReduce);
    }

    async function getPositionNotionalAndUnrealizedPnl(positionManagerAddress: string, traderAddress: string) : Promise<NotionalAndUnrealizedPnlReturns> {
        const oldPosition = await positionHouse.getPosition(positionManagerAddress, traderAddress)
        return positionHouse.getPositionNotionalAndUnrealizedPnl(positionManagerAddress, traderAddress, BigNumber.from(1), oldPosition)

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
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-100')
                }
            );
            // await positionManagerTestingTool.debugPendingOrder(response1.pip, response1.orderId)
        });

        it('should open market a position with many open limit LONG', async function () {
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
            const leverage = 10

            await openLimitPositionAndExpect({
                limitPrice: 5011,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 1,
                _trader: trader
            })

            await openLimitPositionAndExpect({
                limitPrice: 5009,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 2,
                _trader: trader
            })

            await openLimitPositionAndExpect({
                limitPrice: 5012,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 3,
                _trader: trader
            })
            
            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: leverage,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('4')
                }
            );
        });


        it('should open market a position with not enough order to fill', async function () {
            const leverage = 10
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 5,
                _trader: trader1
            })


            await openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: leverage,
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader,
                    _positionManager: positionManager,
                    expectRevertMsg: 'VM Exception while processing transaction: reverted with reason string \'11\''
                }
            );
        });


        describe('get PnL', function () {
            it('should get PnL market', async function () {
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

                const positionNotionalAndPnL = await getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader1.address
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
                const positionNotionalAndPnL = await getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address
                )

                expect(positionNotionalAndPnL.unrealizedPnl).eq(10);


            });
        });


        describe('should increase current position with PnL ', async function () {
            it('should pnl > 0 and increase position short', async function () {

                await openLimitPositionAndExpect({
                    limitPrice: 5000,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 1,
                    _trader: trader1
                })

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
                await openLimitPositionAndExpect({
                    limitPrice: 4990,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 5,
                    _trader: trader1
                })

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

                const positionNotionalAndPnL = await getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address
                )

                // unrealizedPnl = openNotional - positionNotional = 29950 - totalSize * currentPrice = 29950 - 6*4990 = 10
                expect(positionNotionalAndPnL.unrealizedPnl).gte(0)
                expect(positionNotionalAndPnL.unrealizedPnl).eq(10)

                // trader1 long at price 4980, quantity 1 BTC
                await openLimitPositionAndExpect({
                    limitPrice: 4980,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 1,
                    _trader: trader1
                })

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

                const positionNotionalAndPnL1 = await getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address
                )
                // because current price is now 4980 so trader0's pnl increased to 70
                // calculated by pnl = openNotional - positionNotional = 29950 - totalSize * currentPrice = 29950 - 6 * 4980 = 70
                expect(positionNotionalAndPnL1.unrealizedPnl).gte(0)
                console.log(373);
                expect(positionNotionalAndPnL1.unrealizedPnl).eq(70)

            });

            it('should pnl < 0 and increase position short', async function () {
                await openLimitPositionAndExpect({
                    limitPrice: 5000,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 10,
                    _trader: trader1
                })

                await openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-10')


                })
                await openLimitPositionAndExpect({
                    limitPrice: 4990,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 5,
                    _trader: trader1
                })

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

                const positionNotionalAndPnL = await getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address
                )

                expect(positionNotionalAndPnL.unrealizedPnl).eq(100)

                await openLimitPositionAndExpect({
                    limitPrice: 5010,
                    side: SIDE.SHORT,
                    leverage: 10,
                    quantity: 10,
                    _trader: trader1
                })

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

                const positionNotionalAndPnL1 = await getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address
                )

                console.log("positionNotionalAndPnL1 :", positionNotionalAndPnL1.unrealizedPnl.toString())
                expect(positionNotionalAndPnL1.unrealizedPnl).lte(0)
                // expect(positionNotionalAndPnL1.unrealizedPnl).eq(-200)

            });
            it('should pnl > 0 and increase position long', async function () {
                await openLimitPositionAndExpect({
                    limitPrice: 5000,
                    side: SIDE.SHORT,
                    leverage: 10,
                    quantity: 1,
                    _trader: trader1
                })

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
                await openLimitPositionAndExpect({
                    limitPrice: 5010,
                    side: SIDE.SHORT,
                    leverage: 10,
                    quantity: 5,
                    _trader: trader1
                })

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

                const positionNotionalAndPnL = await getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address
                )

                // unrealizedPnl for long order = positionNotional - openNotional = totalSize * currentPrice - 30050 = 6*5010 - 30050 = 10
                expect(positionNotionalAndPnL.unrealizedPnl).gte(0)
                expect(positionNotionalAndPnL.unrealizedPnl).eq(10)
                // trader1 short at price 5020, quantity 10 BTC
                await openLimitPositionAndExpect({
                    limitPrice: 5020,
                    side: SIDE.SHORT,
                    leverage: 10,
                    quantity: 10,
                    _trader: trader1
                })
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

                const positionNotionalAndPnL1 = await getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address
                )
                // because current price is now 5020 so trader0's pnl increased to 70
                // calculated by pnl = positionNotional - openNotional = totalSize * currentPrice - 30050 = 6 * 5020 - 30050 = 70
                expect(positionNotionalAndPnL1.unrealizedPnl).gte(0)
                expect(positionNotionalAndPnL1.unrealizedPnl).eq(70)
            })
            it('should pnl < 0 and increase position long', async function () {
                await openLimitPositionAndExpect({
                    limitPrice: 5000,
                    side: SIDE.SHORT,
                    leverage: 10,
                    quantity: 1,
                    _trader: trader1
                })

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
                await openLimitPositionAndExpect({
                    limitPrice: 4990,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 5,
                    _trader: trader1
                })

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

                const positionNotionalAndPnL = await getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address
                )

                // unrealizedPnl for long order = positionNotional - openNotional = totalSize * currentPrice - 5000 = 1*4990 - 5000 = -10
                expect(positionNotionalAndPnL.unrealizedPnl).lte(0)
                expect(positionNotionalAndPnL.unrealizedPnl).eq(-10)
                // trader1 short at price 4990, quantity 10 BTC
                await openLimitPositionAndExpect({
                    limitPrice: 4990,
                    side: SIDE.SHORT,
                    leverage: 10,
                    quantity: 10,
                    _trader: trader1
                })
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

                const positionNotionalAndPnL1 = await getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address
                )
                // calculated by pnl = positionNotional - openNotional = totalSize * currentPrice - 54900 = 11 * 4990 - 54900 = 10
                expect(positionNotionalAndPnL1.unrealizedPnl).lte(0)
                expect(positionNotionalAndPnL1.unrealizedPnl).eq(-10)
            })
        })

        describe('close and open reverse', function () {

            it('close SHORT and open reverse LONG', async function () {
                await openLimitPositionAndExpect({
                    limitPrice: 5000,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 100,
                    _trader: trader1
                })

                await openMarketPosition({
                    quantity: BigNumber.from('100'),
                    leverage: 20,
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader,
                    price: Number('5000'),
                    expectedSize: BigNumber.from('-100')
                });

                await openLimitPositionAndExpect({
                    limitPrice: 5010,
                    side: SIDE.SHORT,
                    leverage: 10,
                    quantity: 200,
                    _trader: trader1
                })

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
                expect(positionData.openNotional.toNumber()).eq(100 * 5010);

            })

            it('close and open reverse position LONG -> reverse SHORT', async function () {
                await openLimitPositionAndExpect({
                    limitPrice: 5000,
                    side: SIDE.SHORT,
                    leverage: 10,
                    quantity: 100,
                    _trader: trader1
                })

                await openMarketPosition({
                    quantity: BigNumber.from('100'),
                    leverage: 20,
                    side: SIDE.LONG,
                    trader: trader.address,
                    instanceTrader: trader,
                    price: Number('5000'),
                });

                await openLimitPositionAndExpect({
                    limitPrice: 4990,
                    side: SIDE.LONG,
                    leverage: 10,
                    quantity: 200,
                    _trader: trader1
                })
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
                expect(positionData.openNotional.toNumber()).eq(100 * 4990);
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
            // const pendingOrder = await positionHouse.getPendingOrder(positionManager.address, pip, orderId);
            //
            // expect(pendingOrder.isFilled).eq(true)


            const positionData = await positionHouse.getPosition(positionManager.address, trader.address)
            // margin = quantity * price / leverage = 4990 * 100 / 10
            // expect(positionData.margin.toNumber()).eq(4990 * 100 / 10)
            expect(positionData.quantity.toNumber()).eq(100)
        });

        it('should open limit and self filled by market  ', async () => {

            const {pip, orderId} = await openLimitPositionAndExpect({
                _trader: trader,
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

                // const pendingOrder2 = await positionHouse.getPendingOrder(positionManager.address, response2.pip, response2.orderId);
                // console.log("partialFilled", pendingOrder2.partialFilled.toString());
                // expect(pendingOrder2.isFilled).eq(true)
                // expect(pendingOrder2.size).eq(100);


                // const pendingOrder3 = await positionHouse.getPendingOrder(positionManager.address, response3.pip, response3.orderId);
                // expect(pendingOrder3.isFilled).eq(false)
                // expect(pendingOrder3.size).eq(100);
                // expect(pendingOrder3.partialFilled).eq(60);
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
                })).to.be.revertedWith('VM Exception while processing transaction: reverted with reason string \'11\'');

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

                console.log("Before cancel limit order")
                await cancelLimitOrder(positionManager.address, trader, pip, orderId);

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

                await cancelLimitOrder(positionManager.address, trader, pip, orderId);
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
                // const pendingOrder = await positionHouse.getPendingOrder(positionManager.address, pip, orderId);
                //
                // expect(pendingOrder.isFilled).eq(true)


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
                await cancelLimitOrder(positionManager.address, trader, response.pip.toString(), response.orderId.toString());
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
                // const pendingOrder = await positionHouse.getPendingOrder(positionManager.address, pip, orderId);
                //
                // expect(pendingOrder.isFilled).eq(true)

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
                // await positionManagerTestingTool.debugPendingOrder(response1.pip, response1.orderId)
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
                await cancelLimitOrder(positionManager.address, trader, response2.pip.toString(), response2.orderId.toString());
                const positionData2 = await positionHouse.getPosition(positionManager.address, trader.address)
                // margin = quantity * price / leverage = 4990 * 100 / 10
                // NEED UPDATE can't get margin, need leverage in limit order to calculate margin
                // expect(positionData.margin.toNumber()).eq(4990 * 100 / 10)
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

                await cancelLimitOrder(positionManager.address, trader, response2.pip.toString(), response2.orderId.toString());

                // const pendingOrder1 = await positionHouse.getPendingOrder(positionManager.address, response1.pip, response1.orderId);
                // expect(pendingOrder1.isFilled).eq(false)
                // expect(pendingOrder1.size).eq(100);
                //
                //
                // const pendingOrder2 = await positionHouse.getPendingOrder(positionManager.address, response2.pip, response2.orderId);
                // expect(pendingOrder2.isFilled).eq(false)
                // expect(pendingOrder2.size).eq(0);
                //
                //
                // const pendingOrder3 = await positionHouse.getPendingOrder(positionManager.address, response3.pip, response3.orderId);
                // expect(pendingOrder3.isFilled).eq(false)
                // expect(pendingOrder3.size).eq(100);


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
                await cancelLimitOrder(positionManager.address, trader, response1.pip.toString(), response1.orderId.toString());
                console.log(`START MARKET ORDER`)

                await openMarketPosition({
                    trader: trader2,
                    instanceTrader: trader2,
                    leverage: 10,
                    quantity: BigNumber.from('100'),
                    side: SIDE.LONG,
                    // price: 5008,
                    expectedSize: BigNumber.from('100')
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

                // const pendingOrder1 = await positionHouse.getPendingOrder(positionManager.address, response1.pip, response1.orderId);
                // console.log(pendingOrder1)
                // // expect(pendingOrder1.isFilled).eq(false)
                // expect(pendingOrder1.size).eq(0);

                // IMPORTANT expect pendingOrder2 is filled should be true
                // const pendingOrder2 = await positionHouse.getPendingOrder(positionManager.address, response2.pip, response2.orderId);
                // console.log("partialFilled", pendingOrder2.partialFilled.toString());
                // // console.log(pendingOrder2.partialFilled.toString());
                // expect(pendingOrder2.isFilled).eq(true)
                // expect(pendingOrder2.size).eq(100);


                // const pendingOrder3 = await positionHouse.getPendingOrder(positionManager.address, response3.pip, response3.orderId);
                // expect(pendingOrder3.isFilled).eq(false)
                // expect(pendingOrder3.size).eq(100);
                // expect(pendingOrder3.partialFilled).eq(60);

                const positionData1 = await positionHouse.getPosition(positionManager.address, trader.address)
                const positionDataTrader2 = await positionHouse.getPosition(positionManager.address, trader2.address)
                expect(positionData1.quantity.toNumber()).eq(-100)


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
                    const positionNotionalAndPnL = await getPositionNotionalAndUnrealizedPnl(positionManager.address, trader.address);

                    expect(positionNotionalAndPnL.unrealizedPnl).eq(1000)
                    expect(positionNotionalAndPnL.positionNotional).eq(500000)

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
                    const positionNotionalAndPnL = await getPositionNotionalAndUnrealizedPnl(positionManager.address, trader.address);

                    expect(positionNotionalAndPnL.unrealizedPnl).eq(-1000)
                    expect(positionNotionalAndPnL.positionNotional).eq(502000)

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
                    const positionNotionalAndPnL = await getPositionNotionalAndUnrealizedPnl(positionManager.address, trader.address);

                    expect(positionNotionalAndPnL.unrealizedPnl).eq(1000)
                    expect(positionNotionalAndPnL.positionNotional).eq(500000)

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
                    const positionNotionalAndPnL = await getPositionNotionalAndUnrealizedPnl(positionManager.address, trader.address);

                    expect(positionNotionalAndPnL.unrealizedPnl).eq(-1000)
                    expect(positionNotionalAndPnL.positionNotional).eq(498000)

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
                    const positionNotionalAndPnL = await getPositionNotionalAndUnrealizedPnl(positionManager.address, trader.address);
                    expect(positionNotionalAndPnL.positionNotional).eq(500000)
                    expect(positionNotionalAndPnL.unrealizedPnl).eq(1000)
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
                    const positionNotionalAndPnL = await getPositionNotionalAndUnrealizedPnl(positionManager.address, trader.address);

                    expect(positionNotionalAndPnL.unrealizedPnl).eq(-1000)
                    expect(positionNotionalAndPnL.positionNotional).eq(753000);

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
                    const positionNotionalAndPnL = await getPositionNotionalAndUnrealizedPnl(positionManager.address, trader.address);

                    expect(positionNotionalAndPnL.unrealizedPnl).eq(500)
                    expect(positionNotionalAndPnL.positionNotional).eq(749250)

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
                    const positionNotionalAndPnL = await getPositionNotionalAndUnrealizedPnl(positionManager.address, trader.address);

                    expect(positionNotionalAndPnL.unrealizedPnl).eq(-1500)
                    expect(positionNotionalAndPnL.positionNotional).eq(746250)

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
                        percentQuantity: 100
                    })

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.LONG,
                        price: 5005,
                        expectedSize: BigNumber.from('50')
                    })

                    // const dataClaim = (await positionHouse.canClaimFund(positionManager.address, trader.address)) as unknown as ClaimFund;
                    // expect(dataClaim.amount).eq(49900);
                    // expect(dataClaim.realPnL).eq(1500);
                    // expect(dataClaim.canClaim).eq(true);


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
                        percentQuantity: 100
                    })

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('100'),
                        side: SIDE.SHORT,
                        price: 4995,
                        expectedSize: BigNumber.from('-50')
                    })

                    // const dataClaim = (await positionHouse.canClaimFund(positionManager.address, trader.address)) as unknown as ClaimFund;
                    // expect(dataClaim.amount).eq(50100);
                    // expect(dataClaim.realPnL).eq(1500);
                    // expect(dataClaim.canClaim).eq(true);

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
                        percentQuantity: 100
                    })

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('60'),
                        side: SIDE.LONG,
                        price: 5005,
                        expectedSize: BigNumber.from('10')
                    })

                    // const dataClaim = (await positionHouse.canClaimFund(positionManager.address, trader.address)) as unknown as ClaimFund;
                    // expect(dataClaim.amount).eq(29940);
                    // expect(dataClaim.realPnL).eq(900);
                    // expect(dataClaim.canClaim).eq(true);


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
                        percentQuantity: 100
                    })

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('80'),
                        side: SIDE.SHORT,
                        price: 4995,
                        expectedSize: BigNumber.from('-30')
                    })

                    // const dataClaim = (await positionHouse.canClaimFund(positionManager.address, trader.address)) as unknown as ClaimFund;
                    // expect(dataClaim.amount).eq(40080);
                    // expect(dataClaim.realPnL).eq(1200);
                    // expect(dataClaim.canClaim).eq(true);

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
                        percentQuantity: 100
                    })

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('80'),
                        side: SIDE.SHORT,
                        price: 5015,
                        expectedSize: BigNumber.from('70')
                    })

                    // const dataClaim = (await positionHouse.canClaimFund(positionManager.address, trader.address)) as unknown as ClaimFund;
                    // expect(dataClaim.amount).eq(40000);
                    // expect(dataClaim.realPnL).eq(-1200);
                    // expect(dataClaim.canClaim).eq(true);


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
                        percentQuantity: 100
                    })

                    await openMarketPosition({
                        instanceTrader: trader1,
                        leverage: 10,
                        quantity: BigNumber.from('80'),
                        side: SIDE.LONG,
                        price: 4995,
                        expectedSize: BigNumber.from('-70')
                    })

                    // const dataClaim = (await positionHouse.canClaimFund(positionManager.address, trader.address)) as unknown as ClaimFund;
                    // expect(dataClaim.amount).eq(40000);
                    // expect(dataClaim.realPnL).eq(-400);
                    // expect(dataClaim.canClaim).eq(true);
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
                        percentQuantity: 100
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

                    // await positionManagerTestingTool.expectPendingOrderByLimitOrderResponse(response, {
                    //     isFilled: true
                    // })

                    await positionHouseTestingTool.expectPositionData(trader1, {
                        quantity: 100
                    })

                    // open a buy limit at price 4980
                    await positionHouseTestingTool.closeLimitPosition({
                        trader,
                        price: 4980,
                        percentQuantity: 100
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

                    // await positionManagerTestingTool.expectPendingOrderByLimitOrderResponse(response1, {
                    //     isFilled: false,
                    //     size: 100,
                    //     partialFilled: 50
                    // })

                    // await positionHouseTestingTool.debugPosition(trader1)
                    // await positionHouseTestingTool.expectPositionData(trader1, {
                    //     quantity: 150
                    // })
                    // await openMarketPosition({
                    //     instanceTrader: trader1,
                    //     trader: trader1.address,
                    //     leverage: 10,
                    //     quantity: BigNumber.from('50'),
                    //     side: SIDE.SHORT,
                    //     price: 4985,
                    //     expectedSize: BigNumber.from('150')
                    // })
                    await openMarketPosition({
                        instanceTrader: trader1,
                        trader: trader1.address,
                        leverage: 10,
                        quantity: BigNumber.from('150'),
                        side: SIDE.SHORT,
                        price: 4980,
                        expectedSize: BigNumber.from('50')
                    })
                    // await positionManagerTestingTool.debugPendingOrder(response1.pip, response1.orderId)
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
                        percentQuantity: 100
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
                await positionHouseTestingTool.expectPositionData(trader, {
                    margin: 15030
                })

                await openMarketPosition({
                    instanceTrader: trader,
                    leverage: 10,
                    quantity: BigNumber.from('40'),
                    side: SIDE.LONG,
                    price: 5015,
                    expectedSize: BigNumber.from('10')
                });

                // const pendingOrder = await positionHouse.getPendingOrder(positionManager.address, response1.pip, response1.orderId);
                // expect(pendingOrder.partialFilled).eq(70);
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
                console.log("line 2736")
                await openMarketPosition({
                    instanceTrader: trader1,
                    leverage: 10,
                    quantity: BigNumber.from('100'),
                    side: SIDE.SHORT,
                    price: 5000,
                    expectedSize: BigNumber.from('0')
                });
                console.log(2569)
                // ERROR because this limit order separated into 2 order: market short 100 and limit short 100
                // so the expect in functions openLimitPositionAndExpect is error because it only get quantity from limit order
                response3 = (await openLimitPositionAndExpect({
                    limitPrice: 5000,
                    side: SIDE.SHORT,
                    leverage: 10,
                    quantity: 200,
                    _trader: trader2
                })) as unknown as PositionLimitOrderID
                console.log(2579)
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
                    trader: trader1.address,
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
                    trader: trader2.address,
                    leverage: 20,
                    quantity: BigNumber.from('100'),
                    side: SIDE.LONG,
                    price: 5242,
                    expectedSize: BigNumber.from('100')
                });


                const maintenanceDetail = (await positionHouse.getMaintenanceDetail(positionManager.address, trader.address)) as unknown as MaintenanceDetail;
                const positionDataTrader0 = (await positionHouse.getPosition(positionManager.address, trader.address)) as unknown as PositionData;
                const positionNotionalAndPnLTrader0 = await getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address
                )


                console.log('margin ', positionDataTrader0.margin.toString());
                console.log('Pnl :', positionNotionalAndPnLTrader0.unrealizedPnl.toString())
                console.log('margin maintenanceMargin: ', maintenanceDetail.maintenanceMargin.toString());
                console.log('margin balance: ', maintenanceDetail.marginBalance.toString());
                console.log('margin marginRatio: ', maintenanceDetail.marginRatio.toString());
                console.log("start liquidate");

                await openLimitPositionAndExpect({
                    limitPrice: 5242,
                    side: SIDE.SHORT,
                    leverage: 20,
                    quantity: 20,
                    _trader: trader1
                })

                await positionHouse.liquidate(positionManager.address, trader.address);

                const positionNotionalAndPnLTrader0AfterLiquidate = await getPositionNotionalAndUnrealizedPnl(
                    positionManager.address,
                    trader.address
                )
                const maintenanceDetailTrader0AfterLiquidate = (await positionHouse.getMaintenanceDetail(positionManager.address, trader.address)) as unknown as MaintenanceDetail;

                const positionDataTrader0AfterLiquidate = (await positionHouse.getPosition(positionManager.address, trader.address)) as unknown as PositionData;
                console.log("##### After liquidate")
                console.log('Pnl :', positionNotionalAndPnLTrader0AfterLiquidate.unrealizedPnl.toString())
                console.log('margin maintenanceMargin: ', maintenanceDetailTrader0AfterLiquidate.maintenanceMargin.toString());
                console.log('margin balance: ', maintenanceDetailTrader0AfterLiquidate.marginBalance.toString());
                console.log('margin marginRatio: ', maintenanceDetailTrader0AfterLiquidate.marginRatio.toString());
                console.log('quantity after liquidate ', positionDataTrader0AfterLiquidate.quantity.toString())
                console.log('margin after liquidate ', positionDataTrader0AfterLiquidate.margin.toString())
                console.log('openNotional after liquidate ', positionDataTrader0AfterLiquidate.openNotional.toString())

                expect(positionDataTrader0AfterLiquidate.quantity).eq(-80)

                expect(positionDataTrader0AfterLiquidate.margin).eq(24250)
                expect(positionDataTrader0AfterLiquidate.openNotional).eq(400000)

            })


        })
    })


    describe('adjust margin', async function () {
        it('add margin', async function () {
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 2,
                _trader: trader
            })

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
            console.log('positionData margin: ', positionData.margin.toString());
            expect(positionData.margin).eq(1000)


            await positionHouse.connect(trader1).addMargin(positionManager.address, BigNumber.from('100'))

            const positionData1 = (await positionHouse.getPosition(positionManager.address, trader1.address)) as unknown as PositionData;

            console.log('positionData after add margin margin: ', positionData1.margin.toString());

            expect(positionData1.margin).eq(1100);

        })

        it('remove margin', async function () {
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 2,
                _trader: trader
            })

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

            console.log('positionData margin: ', positionData.margin.toString());
            expect(positionData.margin).eq(1000)


            await positionHouse.connect(trader1).removeMargin(positionManager.address, BigNumber.from('0'))

            const positionData1 = (await positionHouse.getPosition(positionManager.address, trader1.address)) as unknown as PositionData;

            console.log('positionData after add margin margin: ', positionData1.margin.toString());
            expect(positionData1.margin).eq(1000);

        })

    })

    describe('liquidate position', async function () {

        it('should liquidate partial position with SHORT', async function () {
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 100,
                _trader: trader1
            })

            console.log("open market 1");
            // trader0 short at price 50, quantity 1000 TRB, openNotional = 50*1000 = 50000,
            // margin = openNotional / leverage = 500000 / 20 = 25000
            await openMarketPosition({
                quantity: BigNumber.from('100'),
                leverage: 20,
                side: SIDE.SHORT,
                trader: trader.address,
                instanceTrader: trader,
                _positionManager: positionManager,
                price: 5000,
                expectedSize: BigNumber.from('-100')
            })

            await openLimitPositionAndExpect({
                limitPrice: 5242,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 100,
                _trader: trader1
            })

            console.log("open market 2");
            // trader0 short at price 50, quantity 1000 TRB, openNotional = 50*1000 = 50000,
            // margin = openNotional / leverage = 50000 / 20 = 2500
            await openMarketPosition({
                quantity: BigNumber.from('100'),
                leverage: 20,
                side: SIDE.LONG,
                trader: trader2.address,
                instanceTrader: trader2,
                _positionManager: positionManager,
                price: 5242
            })

            const maintenanceDetail = (await positionHouse.getMaintenanceDetail(positionManager.address, trader.address)) as unknown as MaintenanceDetail;
            const positionData = (await positionHouse.getPosition(positionManager.address, trader.address)) as unknown as PositionData;
            const positionNotionalAndPnL1 = await getPositionNotionalAndUnrealizedPnl(
                positionManager.address,
                trader.address
            )


            console.log('mmargin ', positionData.margin.toString());
            console.log('Pnl :', positionNotionalAndPnL1.unrealizedPnl.toString())

            console.log('margin maintenanceMargin: ', maintenanceDetail.maintenanceMargin.toString());
            console.log('margin balance: ', maintenanceDetail.marginBalance.toString());
            console.log('margin marginRatio: ', maintenanceDetail.marginRatio.toString());
            console.log("start liquidate");

            await openLimitPositionAndExpect({
                limitPrice: 5242,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 20,
                _trader: trader1
            })

            await positionHouse.liquidate(positionManager.address, trader.address);


            const positionData1 = (await positionHouse.getPosition(positionManager.address, trader.address)) as unknown as PositionData;

            console.log('quantity after liquidate ', positionData1.quantity.toString())
            console.log('margin after liquidate ', positionData1.margin.toString())


            expect(positionData1.quantity).eq(-80)

            expect(positionData1.margin).eq(24250)

        });

        it('should liquidate partial position with LONG', async function () {
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 100,
                _trader: trader1
            })

            console.log("open market 1");
            // trader0 short at price 50, quantity 1000 TRB, openNotional = 50*1000 = 50000,
            // margin = openNotional / leverage = 500000 / 20 = 25000
            await openMarketPosition({
                quantity: BigNumber.from('100'),
                leverage: 20,
                side: SIDE.LONG,
                trader: trader.address,
                instanceTrader: trader,
                _positionManager: positionManager,
                price: 5000,
                expectedSize: BigNumber.from('100')
            })

            await openLimitPositionAndExpect({
                limitPrice: 4758,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 100,
                _trader: trader1
            })

            console.log("open market 2");
            // trader0 short at price 50, quantity 1000 TRB, openNotional = 50*1000 = 50000,
            // margin = openNotional / leverage = 50000 / 20 = 2500
            await openMarketPosition({
                quantity: BigNumber.from('100'),
                leverage: 20,
                side: SIDE.SHORT,
                trader: trader2.address,
                instanceTrader: trader2,
                _positionManager: positionManager,
                price: 4758,
                expectedSize: BigNumber.from('-100')
                // expect().eq()
            })

            const maintenanceDetail = (await positionHouse.getMaintenanceDetail(positionManager.address, trader.address)) as unknown as MaintenanceDetail;
            const positionData = (await positionHouse.getPosition(positionManager.address, trader.address)) as unknown as PositionData;
            const positionNotionalAndPnL1 = await getPositionNotionalAndUnrealizedPnl(
                positionManager.address,
                trader.address
            )


            console.log('margin ', positionData.margin.toString());
            console.log('Pnl :', positionNotionalAndPnL1.unrealizedPnl.toString())

            console.log('margin maintenanceMargin: ', maintenanceDetail.maintenanceMargin.toString());
            console.log('margin balance: ', maintenanceDetail.marginBalance.toString());
            console.log('margin marginRatio: ', maintenanceDetail.marginRatio.toString());
            console.log("start liquidate");

            await openLimitPositionAndExpect({
                limitPrice: 4758,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 20,
                _trader: trader1
            })

            await positionHouse.liquidate(positionManager.address, trader.address);


            const positionData1 = (await positionHouse.getPosition(positionManager.address, trader.address)) as unknown as PositionData;

            console.log('quantity after liquidate ', positionData1.quantity.toString())
            console.log('margin after liquidate ', positionData1.margin.toString())


            expect(positionData1.quantity).eq(80)

            expect(positionData1.margin).eq(24250)

        });

        it('should liquidate full position with SHORT', async function () {
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 100,
                _trader: trader1
            })

            console.log("open market 1");
            // trader0 short at price 50, quantity 1000 TRB, openNotional = 50*1000 = 50000,
            // margin = openNotional / leverage = 500000 / 20 = 25000
            await openMarketPosition({
                quantity: BigNumber.from('100'),
                leverage: 20,
                side: SIDE.SHORT,
                trader: trader.address,
                instanceTrader: trader,
                _positionManager: positionManager,
                price: 5000,
                expectedSize: BigNumber.from('-100')
            })

            await openLimitPositionAndExpect({
                limitPrice: 5245,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 100,
                _trader: trader1
            })

            console.log("open market 2");
            // trader0 short at price 50, quantity 1000 TRB, openNotional = 50*1000 = 50000,
            // margin = openNotional / leverage = 50000 / 20 = 2500
            await openMarketPosition({
                quantity: BigNumber.from('100'),
                leverage: 20,
                side: SIDE.LONG,
                trader: trader2.address,
                instanceTrader: trader2,
                _positionManager: positionManager,
                price: 5245
            })

            const maintenanceDetail = (await positionHouse.getMaintenanceDetail(positionManager.address, trader.address)) as unknown as MaintenanceDetail;

            const positionData = (await positionHouse.getPosition(positionManager.address, trader.address)) as unknown as PositionData;
            const positionNotionalAndPnL1 = await getPositionNotionalAndUnrealizedPnl(
                positionManager.address,
                trader.address
            )


            console.log('margin ', positionData.margin.toString());
            console.log('Pnl :', positionNotionalAndPnL1.unrealizedPnl.toString())

            console.log('margin maintenanceMargin: ', maintenanceDetail.maintenanceMargin.toString());
            console.log('margin balance: ', maintenanceDetail.marginBalance.toString());
            console.log('margin marginRatio: ', maintenanceDetail.marginRatio.toString());
            console.log("start liquidate");

            await positionHouse.liquidate(positionManager.address, trader.address);


            const positionData1 = (await positionHouse.getPosition(positionManager.address, trader.address)) as unknown as PositionData;

            console.log('quantity after liquidate ', positionData1.quantity.toString())
            console.log('margin after liquidate ', positionData1.margin.toString())


            expect(positionData1.quantity).eq(0)

            expect(positionData1.margin).eq(0)

        });


        it('should liquidate full position with LONG', async function () {
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 100,
                _trader: trader1
            })

            console.log("open market 1");
            // trader0 short at price 50, quantity 1000 TRB, openNotional = 50*1000 = 50000,
            // margin = openNotional / leverage = 500000 / 20 = 25000
            await openMarketPosition({
                quantity: BigNumber.from('100'),
                leverage: 20,
                side: SIDE.LONG,
                trader: trader.address,
                instanceTrader: trader,
                _positionManager: positionManager,
                price: 5000,
                expectedSize: BigNumber.from('100')
            })

            await openLimitPositionAndExpect({
                limitPrice: 4755,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 100,
                _trader: trader1
            })

            console.log("open market 2");
            // trader0 short at price 50, quantity 1000 TRB, openNotional = 50*1000 = 50000,
            // margin = openNotional / leverage = 50000 / 20 = 2500
            await openMarketPosition({
                quantity: BigNumber.from('100'),
                leverage: 20,
                side: SIDE.SHORT,
                trader: trader2.address,
                instanceTrader: trader2,
                _positionManager: positionManager,
                price: 4755,
                expectedSize: BigNumber.from('-100')
            })

            const maintenanceDetail = (await positionHouse.getMaintenanceDetail(positionManager.address, trader.address)) as unknown as MaintenanceDetail;

            const positionData = (await positionHouse.getPosition(positionManager.address, trader.address)) as unknown as PositionData;
            const positionNotionalAndPnL1 = await getPositionNotionalAndUnrealizedPnl(
                positionManager.address,
                trader.address
            )


            console.log('mmargin ', positionData.margin.toString());
            console.log('Pnl :', positionNotionalAndPnL1.unrealizedPnl.toString())

            console.log('margin maintenanceMargin: ', maintenanceDetail.maintenanceMargin.toString());
            console.log('margin balance: ', maintenanceDetail.marginBalance.toString());
            console.log('margin marginRatio: ', maintenanceDetail.marginRatio.toString());
            console.log("start liquidate");

            await positionHouse.liquidate(positionManager.address, trader.address);


            const positionData1 = (await positionHouse.getPosition(positionManager.address, trader.address)) as unknown as PositionData;

            console.log('quantity after liquidate ', positionData1.quantity.toString())
            console.log('margin after liquidate ', positionData1.margin.toString())


            expect(positionData1.quantity).eq(0)

            expect(positionData1.margin).eq(0)

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

            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 1,
                _trader: trader4,
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('1'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader4.address,
                    instanceTrader: trader4,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from(0),
                    price: 4900
                }
            );


            await positionHouseTestingTool.debugPosition(trader)
            await positionHouseTestingTool.expectPositionData(trader, {
                notional: 5005 * 100
            })
            await positionHouseTestingTool.closeLimitPosition({
                percentQuantity: 75,
                price: 4850,
                trader
            });
            //5005*100-75*4850

            await openMarketPosition({
                    quantity: BigNumber.from('75'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader4.address,
                    instanceTrader: trader4,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from(-75),
                    price: 4850
                }
            );

            await positionHouseTestingTool.expectPositionData(trader, {
                quantity: -25
            })

            // now price pump to 5015 and trader got liquidation
            await positionHouseTestingTool.pumpPrice({
                toPrice: 5015,
                pumper: trader5
            })

            await positionHouseTestingTool.debugPosition(trader)


            //
            // {
            //     let response1 = (await openLimitPositionAndExpect({
            //         limitPrice: 5500,
            //         side: SIDE.SHORT,
            //         leverage: 10,
            //         quantity: 1,
            //         _trader: trader4,
            //     })) as unknown as PositionLimitOrderID
            //
            //     await openMarketPosition({
            //             quantity: BigNumber.from('1'),
            //             leverage: 10,
            //             side: SIDE.LONG,
            //             trader: trader4.address,
            //             instanceTrader: trader4,
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
            // expect(positionData1.margin).eq(24250)
            //

        })

    })

})
