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
    LimitOrderReturns,
    PositionData,
    PositionLimitOrderID,
    priceToPip, SIDE,
    toWeiBN,
    toWeiWithString
} from "../shared/utilities";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

describe("PositionHouse_02", () => {
    let positionHouse: PositionHouse;
    let trader: any;
    let trader1: any;
    let trader2: any;
    let trader3: any;
    let trader4: any;
    let trader5: any;
    let positionManager: PositionManager;
    let positionManagerFactory: ContractFactory;

    beforeEach(async () => {
        [trader, trader1, trader2, trader3, trader4, trader5] = await ethers.getSigners()
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
        await positionHouse.connect(instanceTrader).openMarketPosition(
            _positionManager.address,
            side,
            quantity,
            leverage,
        )

        const positionInfo = await positionHouse.getPosition(_positionManager.address, trader) as unknown as PositionData;
        // console.log("positionInfo", positionInfo)
        const currentPrice = Number((await _positionManager.getPrice()).toString())
        const openNotional = positionInfo.openNotional.div('10000').toString()
        // expectedNotional = expectedNotional && expectedNotional.toString() || quantity.mul(price).toString()
        console.table([
            {
                openNotional: positionInfo.openNotional.toString(),
                openNotionalFormated: openNotional,
                currentPrice: currentPrice,
                quantity: positionInfo.quantity.toString()
            }
        ])
        expect(positionInfo.quantity.toString()).eq(expectedSize || quantity.toString())
        // expect(openNotional).eq(expectedNotional)
        expectedMargin && expect(positionInfo.margin.div('10000').toString()).eq(expectedMargin.toString())
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
        _trader = _trader || trader
        if (!_positionManager) throw Error("No position manager")
        if (!_trader) throw Error("No trader")
        const tx = await positionHouse.connect(_trader).openLimitOrder(_positionManager.address, side, quantity, priceToPip(Number(limitPrice)), leverage, true)
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

    const closePosition = async ({
                                     trader,
                                     instanceTrader,
                                     _positionManager = positionManager
                                 }: {
        trader: string,
        instanceTrader: any,
        _positionManager?: any
    }) => {
        const positionData1 = (await positionHouse.connect(instanceTrader).getPosition(_positionManager.address, trader)) as unknown as PositionData;
        // await positionHouse.connect(instanceTrader).closePosition(_positionManager.address, BigNumber.from(positionData1.quantity.toString()));
        await positionHouse.connect(instanceTrader).closePosition(_positionManager.address);
        const positionData = (await positionHouse.getPosition(_positionManager.address, trader)) as unknown as PositionData;
        expect(positionData.margin).eq(0);
        expect(positionData.quantity).eq(0);
    }

    describe('reduce size in order', async function () {


        /**
         *
         *
         */
        it('reduce size by reverse limit order', async function () {

            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 8
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-5')
                }
            );

            let response2 = (await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 1
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('1'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-6')
                }
            );

            await openMarketPosition({
                    quantity: BigNumber.from('1'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader4.address,
                    instanceTrader: trader,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-7')
                }
            );

            const positionNotionalAndPnLTrader0 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                positionManager.address,
                trader.address,
                1
            )

            const positionNotionalAndPnLTrader1 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                positionManager.address,
                trader1.address,
                1
            )

            const positionNotionalAndPnLTrader2 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                positionManager.address,
                trader1.address,
                1
            )

            const positionNotionalAndPnLTrader4 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                positionManager.address,
                trader1.address,
                1
            )
        })

        it('remove margin', async function () {
        })

    })

})