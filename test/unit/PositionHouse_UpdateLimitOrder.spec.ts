import {BigNumber, BigNumberish, ContractFactory, Signer, Wallet} from 'ethers'
import {ethers, waffle} from 'hardhat'
// import {PositionHouse} from "../../typeChain";
import {loadFixture} from "ethereum-waffle";
// import checkObservationEquals from "../../shared/checkObservationEquals";
// import snapshotGasCost from "../../shared/snapshotGasCost";
// import {expect} from "../../shared/expect";
// import {TEST_POOL_START_TIME} from "../../shared/fixtures";
import {expect} from 'chai'
import {
    PositionManager,
    PositionHouse,
    InsuranceFund,
    BEP20Mintable,
    PositionHouseViewer,
    PositionHouseConfigurationProxy,
    FundingRateTest
} from "../../typeChain";
import {
    ClaimFund,
    LimitOrderReturns,
    PositionData,
    PositionLimitOrderID,
    ChangePriceParams,
    priceToPip, SIDE,
    toWeiBN,
    toWeiWithString, ExpectTestCaseParams, ExpectMaintenanceDetail, toWei
} from "../shared/utilities";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {CHAINLINK_ABI_TESTNET} from "../../constants";
import PositionManagerTestingTool from "../shared/positionManagerTestingTool";

import PositionHouseTestingTool from "../shared/positionHouseTestingTool";
import {deployPositionHouse} from "../shared/deploy";

describe("PositionHouse_UpdateLimitOrder", () => {
    let positionHouse: PositionHouse;
    let trader0: any;
    let trader1: any;
    let trader2: any;
    let trader3: any;
    let trader4: any;
    let trader5: any;
    let tradercp: any;
    let tradercp2: any;

    let positionManager: PositionManager;
    let positionManagerFactory: ContractFactory;
    let bep20Mintable: BEP20Mintable
    let insuranceFund: InsuranceFund
    let positionHouseViewer: PositionHouseViewer;
    let positionHouseConfigurationProxy: PositionHouseConfigurationProxy;
    let positionHouseTestingTool: PositionHouseTestingTool;
    let fundingRateTest: FundingRateTest;
    let _;
    beforeEach(async () => {
        [trader0, trader1, trader2, trader3, trader4, trader5, tradercp, tradercp2] = await ethers.getSigners();
        [
            positionHouse,
            positionManager,
            positionManagerFactory,
            _,
            positionHouseTestingTool,
            bep20Mintable,
            insuranceFund,
            positionHouseViewer,
            fundingRateTest
        ] = await deployPositionHouse() as any

    })

    const openMarketPosition = async (input) => {
        return positionHouseTestingTool.openMarketPosition(input)
    }

    interface OpenLimitPositionAndExpectParams {
        _trader?: SignerWithAddress
        limitPrice: number | string
        leverage: number,
        quantity: number | BigNumber
        side: number
        _positionManager?: PositionManager
    }

    async function getOrderIdByTx(tx) {
        const receipt = await tx.wait();
        const orderId = ((receipt?.events || [])[1]?.args || [])['orderId']
        return orderId
    }

    async function openLimitPositionAndExpect(input): Promise<LimitOrderReturns> {
        return positionHouseTestingTool.openLimitPositionAndExpect(input)
    }

    async function liquidate(_positionManagerAddress, _traderAddress) {
        await positionHouse.liquidate(_positionManagerAddress, _traderAddress)
    }

    async function getMaintenanceDetailAndExpect({
                                                     positionManagerAddress,
                                                     traderAddress,
                                                     expectedMarginRatio,
                                                     expectedMaintenanceMargin,
                                                     expectedMarginBalance
                                                 }: ExpectMaintenanceDetail) {
        const calcOptionSpot = 1;
        const maintenanceData = await positionHouseViewer.getMaintenanceDetail(positionManagerAddress, traderAddress, calcOptionSpot);
        expect(maintenanceData.marginRatio).eq(expectedMarginRatio);
        expect(maintenanceData.maintenanceMargin).eq(expectedMaintenanceMargin);
        expect(maintenanceData.marginBalance).eq(expectedMarginBalance);
    }


    async function changePrice({
                                   limitPrice,
                                   toHigherPrice,
                                   _positionManager
                               }: ChangePriceParams) {

        if (toHigherPrice) {
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: limitPrice,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 3,
                _trader: tradercp,
                _positionManager: _positionManager || positionManager,
                skipCheckBalance: true
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: tradercp2.address,
                    instanceTrader: tradercp2,
                    _positionManager: _positionManager || positionManager,
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
                _positionManager: _positionManager || positionManager,
                skipCheckBalance: true
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: tradercp2.address,
                    instanceTrader: tradercp2,
                    _positionManager: _positionManager || positionManager,
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
        const oldPosition = await positionHouse.getPosition(positionManagerAddress, traderAddress)
        const positionNotionalAndPnLTrader = await positionHouseViewer.getPositionNotionalAndUnrealizedPnl(
            positionManagerAddress,
            traderAddress,
            1,
            oldPosition
        )
        const positionTrader = (await positionHouse.getPosition(positionManagerAddress, traderAddress)) as unknown as PositionData
        console.log("expect all: quantity, openNotional, positionNotional, margin, unrealizedPnl", Number(positionTrader.quantity), Number(positionTrader.openNotional), Number(positionNotionalAndPnLTrader.positionNotional), Number(positionTrader.margin), Number(positionNotionalAndPnLTrader.unrealizedPnl))
        if (expectedQuantity != 0) {
            expect(positionTrader.quantity).eq(expectedQuantity);
        }
        if (expectedOpenNotional != undefined) expect(positionNotionalAndPnLTrader.unrealizedPnl).eq(expectedPnl)
        expect(positionTrader.openNotional).eq(expectedOpenNotional);
        expect(positionTrader.margin).eq(expectedMargin);
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

    async function cancelLimitOrder(positionManagerAddress: string, trader: SignerWithAddress, orderId : string, pip : string) {
        const listPendingOrder = await positionHouseViewer.connect(trader).getListOrderPending(positionManagerAddress, trader.address)
        const obj = listPendingOrder.find(x => () => {
            (x.orderId.toString() == orderId && x.pip.toString() == pip)
        });
        await positionHouse.connect(trader).cancelLimitOrder(positionManagerAddress, obj.orderIdx, obj.isReduce);
    }

    async function expectPositionQuantityAndMargin(positionManager, trader, expectQuantity, expectMargin){
        const {margin, quantity} = await positionHouseViewer.getPosition(positionManager.address, trader.address)
        await expect(margin.toString()).eq(expectMargin.toString())
        await expect(quantity.toString()).eq(expectQuantity.toString())
    }

    async function expectLiquidityAtPip(positionManager, expectPip, expectLiquidity) {
        const {pip, liquidity} = (await positionManager.getLiquidityInPipRange(expectPip, 1, true))[0][0]
        await expect(pip.toString()).eq(expectPip.toString())
        await expect(liquidity.toString()).eq(expectLiquidity.toString())
    }

    describe('limit long higher than current price and fulfill all limit short order', async () => {
        it('should fill all limit short order and expect position data', async () => {
            // S1: trader2 create short limit order at (5100, 5), (5200, 3), (5300, 2)
            // S2: trader1 create long limit order at (5500, 10) => has position Q = 10, margin = 5170
            // -----STEP 1-----
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('5'),
                _trader: trader2,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('3'),
                _trader: trader2,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('2'),
                _trader: trader2,
                skipCheckBalance: true
            })

            // -----STEP 2-----
            await openLimitPositionAndExpect({
                limitPrice: 5500,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from('10'),
                _trader: trader1,
                skipCheckBalance: true
            })

            await expectPositionQuantityAndMargin(positionManager, trader1, 10, 5170)
        })


        // S1: trader1 has position long (4900, 10)
        // S2: trader2 has limit orders (5100, 5), (5200, 3), (5300, 2)
        // S3: trader1 create limit order long (5500, 10) => expect Q = 20, margin = 10070
        it("trader has position long and open limit long fill all pending order", async () => {
            // -----STEP 1-----
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from('10'),
                _trader: trader1,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                }
            );

            // -----STEP 2-----
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('5'),
                _trader: trader2,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('3'),
                _trader: trader2,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('2'),
                _trader: trader2,
                skipCheckBalance: true
            })

            // -----STEP 3-----
            await openLimitPositionAndExpect({
                limitPrice: 5500,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from('10'),
                _trader: trader1,
                skipCheckBalance: true
            })
            console.log((await positionHouseViewer.getPosition(positionManager.address, trader1.address)).toString())
            await expectPositionQuantityAndMargin(positionManager, trader1, 20, 10070)
        })

        // S1: trader1 has position short (5100, 10)
        // S2: trader2 has limit orders short (5100, 5), (5200, 3), (5300, 2)
        // S3: trader1 create limit order long (5500, 10) => expect trader1 receive 3100, pnl = -2005
        it("trader has position short and open limit long fill all pending order", async () => {
            // -----STEP 1-----
            const balanceBeforeStart = await bep20Mintable.balanceOf(trader1.address)
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('10'),
                _trader: trader1,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                }
            );

            // -----STEP 2-----
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('5'),
                _trader: trader2,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('3'),
                _trader: trader2,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('2'),
                _trader: trader2,
                skipCheckBalance: true
            })

            // -----STEP 3-----
            const balanceBeforeClose = await bep20Mintable.balanceOf(trader1.address)
            await openLimitPositionAndExpect({
                limitPrice: 5500,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from('10'),
                _trader: trader1,
                skipCheckBalance: true
            })
            const balanceAfterClose = await bep20Mintable.balanceOf(trader1.address)
            // expect received
            await expect(balanceAfterClose.sub(balanceBeforeClose).toString()).eq('3100')
            // expect pnl: lose 2000 + 5 (fee)
            await expect(balanceAfterClose.sub(balanceBeforeStart).toString()).eq('-2005')
        })

        // S1: trader1 has position short (5100, 10)
        // S2: trader1 open limit long (4800, 5)
        // S3: trader2 has limit orders short (5100, 1), (5200, 2), (5300, 2)
        // S4: trader1 create limit order long (5500, 5) => expect trader1 receive 3100, pnl = -2005
        // S5: trader2 open market short (5) fill limit order of trader1 in S2
        it('trader has position short and pending order long, create new limit order long fill all pending order short', async () => {
            // -----STEP 1-----
            const balanceBeforeStart = await bep20Mintable.balanceOf(trader1.address)
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('10'),
                _trader: trader1,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                }
            );

            // -----STEP 2-----
            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from('5'),
                _trader: trader1,
                skipCheckBalance: true
            })

            // -----STEP 3-----
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('1'),
                _trader: trader2,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('2'),
                _trader: trader2,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('2'),
                _trader: trader2,
                skipCheckBalance: true
            })

            // -----STEP 4-----
            const balanceBeforeClose = await bep20Mintable.balanceOf(trader1.address)
            await openLimitPositionAndExpect({
                limitPrice: 5500,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from('5'),
                _trader: trader1,
                skipCheckBalance: true
            })
            const balanceAfterClose = await bep20Mintable.balanceOf(trader1.address)
            // expect received
            await expect(balanceAfterClose.sub(balanceBeforeClose).toString()).eq('1550')
            await expectPositionQuantityAndMargin(positionManager, trader1, -5, 2550)

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                }
            );

            const Trader1ClaimableFund= await positionHouseViewer.getClaimAmount(positionManager.address, trader1.address)
            // expect claimableAmount = margin + pnl = 2550 + (5100 - 4800)*5 = 4050
            await expect(Trader1ClaimableFund.toString()).eq('4050')
        });
    })

    describe('limit long higher than current price and got partial filled by limit short order', function () {
        // S1: trader2 has short limit orders at (5100, 5), (5200, 2), (5300, 1)
        // S2: trader1 create long limit order at (5500, 10) => has position Q = 8, margin = 4120 and pending order (5500, 2)
        it('should fill all limit short order then create new pending long order', async () => {
            // -----STEP 1-----
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('5'),
                _trader: trader2,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('2'),
                _trader: trader2,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('1'),
                _trader: trader2,
                skipCheckBalance: true
            })

            // -----STEP 2-----
            await openLimitPositionAndExpect({
                limitPrice: 5500,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from('10'),
                _trader: trader1,
                skipCheckBalance: true
            })

            await expectLiquidityAtPip(positionManager, 550000, 2)
            // expect margin = (5100 * 5 + 5200 * 2 + 5300 * 1) / 10 = 4120
            await expectPositionQuantityAndMargin(positionManager, trader1, 8, 4120)
        });

        // S1: trader2 create short limit order at (5100, 5), (5200, 2), (5600, 3)
        // S2: trader1 create long limit order at (5500, 10) => has position Q = 7, margin = 3590 and pending order (5500, 3), (5600, 3)
        it('should fill all limit short order lower than target pip and expect position data', async function () {
            // -----STEP 1-----
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('5'),
                _trader: trader2,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('2'),
                _trader: trader2,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5600,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('3'),
                _trader: trader2,
                skipCheckBalance: true
            })

            // -----STEP 2-----
            await openLimitPositionAndExpect({
                limitPrice: 5500,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from('10'),
                _trader: trader1,
                skipCheckBalance: true
            })

            await expectLiquidityAtPip(positionManager, 550000, 3)
            await expectLiquidityAtPip(positionManager, 560000, 3)
            // expect margin = (5100 * 5 + 5200 * 2) / 10 = 3590
            await expectPositionQuantityAndMargin(positionManager, trader1, 7, 3590)

        });
    });
})