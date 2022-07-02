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
    priceToPip,
    SIDE,
    toWeiBN,
    toWeiWithString,
    ExpectTestCaseParams,
    ExpectMaintenanceDetail,
    toWei,
    multiNumberToWei,
    fromWei,
    OrderData,
    CancelLimitOrderParams, ExpectClaimFund
} from "../shared/utilities";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {CHAINLINK_ABI_TESTNET} from "../../constants";
import PositionManagerTestingTool from "../shared/positionManagerTestingTool";

import PositionHouseTestingTool from "../shared/positionHouseTestingTool";
import {deployPositionHouse} from "../shared/deploy";

describe("PositionCoinMargin", () => {
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
        ] = await deployPositionHouse(true) as any
    })

    const openMarketPosition = async (input) => {
        const balanceBeforeOpenMarket = await bep20Mintable.balanceOf(input.trader)
        const openMarketReturn = await positionHouseTestingTool.openMarketPosition(input)
        const balanceAfterOpenMarket = await bep20Mintable.balanceOf(input.trader)
        const depositedQuoteAmount = balanceBeforeOpenMarket.sub(balanceAfterOpenMarket)
        if (input.cost != undefined) {
            await expectInRange(toWei(input.cost), depositedQuoteAmount, "cost market")
        }
        return openMarketReturn
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
        const balanceBeforeOpenLimit = await bep20Mintable.balanceOf(input._trader.address)
        const openLimitReturn = await positionHouseTestingTool.openLimitPositionAndExpect(input)
        const balanceAfterOpenLimit = await bep20Mintable.balanceOf(input._trader.address)
        const depositedQuoteAmount = balanceBeforeOpenLimit.sub(balanceAfterOpenLimit)
        if (input.cost != undefined) {
            await expectInRange(toWei(input.cost), depositedQuoteAmount, "cost limit")
        }
        return openLimitReturn
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
                quantity: toWei(3),
                _trader: tradercp,
                _positionManager: _positionManager || positionManager,
                skipCheckBalance: true
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('3')),
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
                quantity: toWei(3),
                _trader: tradercp,
                _positionManager: _positionManager || positionManager,
                skipCheckBalance: true
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('3')),
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
                                            expectedQuantity = undefined,
                                            expectedMaintenanceMargin = undefined,
                                            expectedMarginBalance = undefined,
                                            expectedMarginRatio = undefined
                                        }: ExpectTestCaseParams) {
        [expectedOpenNotional, expectedMargin, expectedPnl, expectedQuantity, expectedMaintenanceMargin, expectedMarginBalance] = multiNumberToWei([expectedOpenNotional, expectedMargin, expectedPnl, expectedQuantity, expectedMaintenanceMargin, expectedMarginBalance])
        const positionTrader = (await positionHouseViewer.getPosition(positionManagerAddress, traderAddress)) as unknown as PositionData
        const positionNotionalAndPnLTrader = await positionHouseViewer.getPositionNotionalAndUnrealizedPnl(
            positionManagerAddress,
            traderAddress,
            1,
            positionTrader
        )
        if (expectedQuantity != undefined) {
            await expectInRange(expectedQuantity, positionTrader.quantity, "quantity");
        }
        if (expectedPnl != undefined) {
            await expectInRange(expectedPnl, positionNotionalAndPnLTrader.unrealizedPnl, "pnl");
        }
        if (expectedOpenNotional != undefined) {
            await expectInRange(expectedOpenNotional, positionTrader.openNotional, "openNotional");
        }
        if (expectedMargin != undefined) {
            await expectInRange(expectedMargin, positionTrader.margin, "margin");
        }

        const positionMaintenanceDetail = await positionHouseViewer.getMaintenanceDetail(positionManagerAddress, traderAddress, 1)
        if (expectedMaintenanceMargin != undefined) {
            await expectInRange(expectedMaintenanceMargin, positionMaintenanceDetail.maintenanceMargin, "maintenanceMargin");
        }
        if (expectedMarginBalance != undefined) {
            await expectInRange(expectedMarginBalance, positionMaintenanceDetail.marginBalance, "marginBalance");
        }
        if (expectedMarginRatio != undefined) {
            await expect(expectedMarginRatio).eq(positionMaintenanceDetail.marginRatio);
        }
        return true;
    }

    async function expectInRange(expected, actual, message) {
        let passed
        if (expected >= 0) {
            passed = expected.lte(actual.mul(BigNumber.from('101')).div(BigNumber.from('100'))) && expected.gte(actual.mul(BigNumber.from('99')).div(BigNumber.from('100')))
        } else {
            passed = expected.gte(actual.mul(BigNumber.from('101')).div(BigNumber.from('100'))) && expected.lte(actual.mul(BigNumber.from('99')).div(BigNumber.from('100')))
        }
        expect(passed, `Wrong ${message}, actual is ${actual}, your expected is ${expected}`).eq(true)
    }

    async function expectOrderbook(orderbook: OrderData[]) {
        await positionHouseTestingTool.expectOrderbook(orderbook)
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

    async function cancelLimitOrderAndExpect(input: CancelLimitOrderParams) {
        const balanceBeforeCancelLimitOrder = await bep20Mintable.balanceOf(input.trader.address)
        await positionHouseTestingTool.cancelLimitOrder(input)
        const balanceAfterCancelLimitOrder = await bep20Mintable.balanceOf(input.trader.address)
        const refundAmount = balanceAfterCancelLimitOrder.sub(balanceBeforeCancelLimitOrder)
        if (input.refundAmount != undefined) {
            await expect(refundAmount).eq(toWei(input.refundAmount))
        }
    }

    async function addMargin(input) {
        const balanceBeforeAddMargin = await bep20Mintable.balanceOf(input.trader.address)
        await positionHouse.connect(input.trader).addMargin(input.positionManager.address, toWei(input.amount))
        const balanceAfterAddMargin = await bep20Mintable.balanceOf(input.trader.address)
        const depositedMargin = balanceBeforeAddMargin.sub(balanceAfterAddMargin)
        if (input.amount != undefined) {
            await expect(depositedMargin).eq(toWei(input.amount))
        }
    }

    async function removeMargin(input) {
        const balanceBeforeRemoveMargin = await bep20Mintable.balanceOf(input.trader.address)
        await positionHouse.connect(input.trader).removeMargin(input.positionManager.address, toWei(input.amount))
        const balanceAfterRemoveMargin = await bep20Mintable.balanceOf(input.trader.address)
        const depositedMargin = balanceBeforeRemoveMargin.sub(balanceAfterRemoveMargin)
        if (input.amount != undefined) {
            await expect(depositedMargin).eq(toWei(-input.amount))
        }
    }

    async function expectClaimFund(expectData: ExpectClaimFund) {
        const claimableAmount = await positionHouseViewer.getClaimAmount(expectData.positionManager.address, expectData.trader.address)
        console.log("expectClaimFund", toWei(expectData.claimableAmount), claimableAmount)
        await expectInRange(toWei(expectData.claimableAmount), claimableAmount, "claimFund")
    }

    describe("should open order success", async () => {
        it("should open order success", async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('5')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                }
            );

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedOpenNotional: (fromWei(102040816326530612)),
                expectedMargin: (fromWei(10204081632653061)),
                expectedQuantity: (5 * 100),
            })

            await positionHouse.connect(trader1).closeLimitPosition(positionManager.address, 510000, BigNumber.from(toWei('5')))

            await positionHouse.connect(trader3).closePosition(positionManager.address, BigNumber.from(toWei('5')))
        })
    })

    describe("should get correct position information", async () => {
        it("increase position by limit > currentPrice", async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5500,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5600,
                side: SIDE.LONG,
                leverage: 15,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedMargin: (fromWei(25498824150322484)),
                expectedPnl: (fromWei(17891533180101435))
            })

            await openLimitPositionAndExpect({
                limitPrice: 5600,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedMargin: (fromWei(31451205102703436)),
                expectedPnl: (fromWei(17891533180101435))
            })
        })

        it("should increase by limit order but filled as a market order", async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('5')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('1500'),
                expectedMargin: ('0.030008003201280511'),
                expectedPnl: ('0.005962384953981592'),
                expectedMaintenanceMargin: ('0.000900240096038415'),
                expectedMarginBalance: ('0.035970388155262103'),
                expectedMarginRatio: ('2')
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true,
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('2000'),
                expectedMargin: ('0.040212084833933572'),
                expectedPnl: ('-0.006042416966786715'),
                expectedMaintenanceMargin: ('0.001206362545018007'),
                expectedMarginBalance: ('0.034169667867146857'),
                expectedMarginRatio: ('3')
            })
        })
    })

    describe("Increase position long", async () => {
        it("TC-18", async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await changePrice({
                limitPrice: 4600,
                toHigherPrice: false
            })

            await openLimitPositionAndExpect({
                limitPrice: 4600,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4600,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('2000'),
                expectedMargin: ('0.04173913043'),
                expectedPnl: ('-0.01739130435'),
                expectedMaintenanceMargin: ('0.001252173913'),
                expectedMarginBalance: ('0.02434782609'),
                expectedMarginRatio: ('5')
            })
        })
    })

    describe('Increase position long', async () => {
        it('TC-19', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await changePrice({
                limitPrice: 4600,
                toHigherPrice: false
            })

            await openLimitPositionAndExpect({
                limitPrice: 4600,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4600,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('2000'),
                expectedMargin: ('0.04173913043'),
                expectedPnl: ('-0.01739130435'),
                expectedMaintenanceMargin: ('0.001252173913'),
                expectedMarginBalance: ('0.02434782609'),
                expectedMarginRatio: ('5')
            })

        })

    })

    describe('Increase position long', async () => {
        it('TC-20', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await changePrice({
                limitPrice: 5200,
                toHigherPrice: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.LONG,
                leverage: 15,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('900'),
                expectedMargin: ('0.01512820513'),
                expectedPnl: ('0.003846153846'),
                expectedMaintenanceMargin: ('0.0004538461538'),
                expectedMarginBalance: ('0.01897435897'),
                expectedMarginRatio: ('2')
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('11')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('2000'),
                expectedMargin: ('0.03282051282'),
                expectedPnl: ('-0.007692307692'),
                expectedMaintenanceMargin: ('0.0009846153846'),
                expectedMarginBalance: ('0.02512820513'),
                expectedMarginRatio: ('3')
            })

        })

    })

    describe('Increase position long', async () => {
        it('TC-21', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('6')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5500,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('1000'),
                expectedMargin: ('0.01945701357'),
                expectedPnl: ('0.002262443439'),
                expectedMaintenanceMargin: ('0.0005837104072'),
                expectedMarginBalance: ('0.02171945701'),
                expectedMarginRatio: ('2')
            })

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5500,
                side: SIDE.LONG,
                leverage: 15,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('2000'),
                expectedMargin: ('0.03203562993'),
                expectedPnl: ('0.005890890464'),
                expectedMaintenanceMargin: ('0.0009610688978'),
                expectedMarginBalance: ('0.03792652039'),
                expectedMarginRatio: ('2')
            })

        })

        it('TC-22', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('6')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5500,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('1000'),
                expectedMargin: ('0.01945701357'),
                expectedPnl: ('0.002262443439'),
                expectedMaintenanceMargin: ('0.0005837104072'),
                expectedMarginBalance: ('0.02171945701'),
                expectedMarginRatio: ('2')
            })

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('7')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5500,
                side: SIDE.LONG,
                leverage: 15,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('3')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('2000'),
                expectedMargin: ('0.03189840866'),
                expectedPnl: ('0.01755469835'),
                expectedMaintenanceMargin: ('0.0009569522597'),
                expectedMarginBalance: ('0.04945310701'),
                expectedMarginRatio: ('1')
            })

        })

        it('TC-23', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('6')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5500,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('1000'),
                expectedMargin: ('0.01945701357'),
                expectedPnl: ('0.002262443439'),
                expectedMaintenanceMargin: ('0.0005837104072'),
                expectedMarginBalance: ('0.02171945701'),
                expectedMarginRatio: ('2')
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('7')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.LONG,
                leverage: 15,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('2000'),
                expectedMargin: ('0.0322775264'),
                expectedPnl: ('0.002262443439'),
                expectedMaintenanceMargin: ('0.0009683257919'),
                expectedMarginBalance: ('0.03453996983'),
                expectedMarginRatio: ('2')
            })

        })

        it('TC-24', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5500,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('600'),
                expectedMargin: ('0.01161387632'),
                expectedPnl: ('0.007047854107'),
                expectedMaintenanceMargin: ('0.0003484162896'),
                expectedMarginBalance: ('0.01866173043'),
                expectedMarginRatio: ('1')
            })

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.LONG,
                leverage: 15,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('9')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('1500'),
                expectedMargin: ('0.02517591177'),
                expectedPnl: ('0.0001867906418'),
                expectedMaintenanceMargin: ('0.0007552773531'),
                expectedMarginBalance: ('0.025362702413'),
                expectedMarginRatio: ('2')
            })

        })

        it('TC-25', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5500,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('600'),
                expectedMargin: ('0.01161387632'),
                expectedPnl: ('0.007047854107'),
                expectedMaintenanceMargin: ('0.0003484162896'),
                expectedMarginBalance: ('0.01866173043'),
                expectedMarginRatio: ('1')
            })

            await openLimitPositionAndExpect({
                limitPrice: 5600,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('1000'),
                expectedMargin: ('0.01875673346'),
                expectedPnl: ('0.01212873813'),
                expectedMaintenanceMargin: ('0.0005627020039'),
                expectedMarginBalance: ('0.0308854716'),
                expectedMarginRatio: ('1')
            })

            await openLimitPositionAndExpect({
                limitPrice: 5400,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('6')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('1500'),
                expectedMargin: ('0.0277838467'),
                expectedPnl: ('0.000060689224785'),
                expectedMaintenanceMargin: ('0.000833515401'),
                expectedMarginBalance: ('0.02784453593'),
                expectedMarginRatio: ('2')
            })

        })

        it('TC-26', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5500,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5500,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await changePrice({
                limitPrice: 5000,
                toHigherPrice: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('8')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('2000'),
                expectedMargin: ('0.03888660359'),
                expectedPnl: ('-0.01113396408'),
                expectedMaintenanceMargin: ('0.001166598108'),
                expectedMarginBalance: ('0.02775263952'),
                expectedMarginRatio: ('4')
            })
        })

    })

    describe('Increase position short', async () => {
        it('TC-27', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-1000'),
                expectedMargin: ('0.02070940078'),
                expectedPnl: ('0.0056719496311'),
                expectedMaintenanceMargin: ('0.0006212820234'),
                expectedMarginBalance: ('0.02638135041'),
                expectedMarginRatio: ('2')
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('20')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-3000'),
                expectedMargin: ('0.06195089738'),
                expectedPnl: ('0.005491026198'),
                expectedMaintenanceMargin: ('0.001858526921'),
                expectedMarginBalance: ('0.06744192358'),
                expectedMarginRatio: ('2')
            })

        })

        it('TC-57', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-600'),
                expectedMargin: ('0.01232993197'),
                expectedPnl: ('0.00436025474'),
                expectedMaintenanceMargin: ('0.0003698979592'),
                expectedMarginBalance: ('0.01669018671'),
                expectedMarginRatio: ('2')
            })

            await openLimitPositionAndExpect({
                limitPrice: 4600,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-1500'),
                expectedMargin: ('0.03171013549'),
                expectedPnl: ('-0.004601354881'),
                expectedMaintenanceMargin: ('0.0009513040646'),
                expectedMarginBalance: ('0.027108780618'),
                expectedMarginRatio: ('3')
            })
        })
        it('check entry-Price', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 50,
                quantity: BigNumber.from(toWei('1')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('1')),
                    leverage: 50,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                }
            );
            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('100'),
                expectedMargin: ('0.0004081632653'),
                expectedPnl: ('0'),
            })
        })

    })

    describe('Reverse position short', async () => {
        it('TC-109', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 4600,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('5')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.025858049047589232
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-500'),
                expectedMargin: ('0.01035470039'),
                expectedPnl: ('0.005148648266'),

            })

        })

        it('TC-108', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('3')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    cost: -0.00408461789
                }
            );

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-700'),
                expectedMargin: ('0.01449658055'),
                expectedPnl: ('-0.004965805471'),
            })

        })

        it('TC-110', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 5400,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true,
                cost: 0
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('5')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.009754989466
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-500'),
                expectedMargin: ('0.01035470039'),
                expectedPnl: ('-0.01095441132'),

            })

        })

        it('TC-111', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true,
            })

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('6')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true,
                cost: -0.002961542637
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-500'),
                expectedMargin: ('0.01035470039'),
                expectedPnl: ('-0.009207381266'),

            })

        })

        it('TC-112', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true,
                cost: -0.001184617055
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-800'),
                expectedMargin: ('0.01656752063'),
                expectedPnl: ('-0.01473181003'),

            })

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.01104309187
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-500'),
                expectedMargin: ('0.01035470039'),
                expectedPnl: ('-0.009207381266'),

            })

        })

        it('TC-113', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true,
                cost: 0
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('4')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.01334349577
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-600'),
                expectedMargin: ('0.01242564047'),
                expectedPnl: ('-0.01104885752'),

            })

        })

        it('TC-114', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true,
                cost: -0.001147319124
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-500'),
                expectedMargin: ('0.01035470039'),
                expectedPnl: ('-0.009207381266'),

            })

        })

        it('TC-115', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true,
                cost: -0.0004589276497
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('3')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.01104309187
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-500'),
                expectedMargin: ('0.01035470039'),
                expectedPnl: ('-0.009207381266'),

            })

        })

        it('TC-116', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('7')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    cost: -0.01497922245
                }
            );

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-300'),
                expectedMargin: ('0.005882352941'),
                expectedPnl: ('-0.001131221719'),

            })

        })

        it('TC-117', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('3')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.02200880352
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-700'),
                expectedMargin: ('0.0137254902'),
                expectedPnl: ('0.005602240896'),

            })

        })

        it('TC-118', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('3')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.01847662142
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-700'),
                expectedMargin: ('0.0137254902'),
                expectedPnl: ('-0.002639517345'),

            })

        })

        it('TC-119', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('1')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true,
                cost: -0.005128205128
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-700'),
                expectedMargin: ('0.0137254902'),
                expectedPnl: ('-0.002639517345'),

            })

        })

        it('TC-120', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('1')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('7')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true,
                cost: -0.005128205128
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-700'),
                expectedMargin: ('0.0137254902'),
                expectedPnl: ('-0.0051794302635'),

            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.01076581576
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-300'),
                expectedMargin: ('0.005882352941'),
                expectedPnl: ('-0.002219755827'),

            })

        })

        it('TC-123', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await changePrice({
                limitPrice: 4900,
                toHigherPrice: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true,
                cost: -0.005522208884
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('1')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.01648659464
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-700'),
                expectedMargin: ('0.0137254902'),
                expectedPnl: ('0.005602240896'),

            })

        })

        it('TC-124', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('6')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    cost: -0.008515837104
                }
            );

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-400'),
                expectedMargin: ('0.008'),
                expectedPnl: ('-0.003076923077'),

            })

        })

        it('TC-125', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('5')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.02204081633
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-500'),
                expectedMargin: ('0.01'),
                expectedPnl: ('0.002040816327'),

            })

        })

        it('TC-128', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true,
                cost: -0.004823529412
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('2')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.01246153846
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-500'),
                expectedMargin: ('0.01'),
                expectedPnl: ('-0.003846153846'),

            })

        })

        it('TC-131', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await changePrice({
                limitPrice: 4800,
                toHigherPrice: false
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true,
                cost: -0.0085
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('2')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.01566666667
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-500'),
                expectedMargin: ('0.01'),
                expectedPnl: ('0.004166666667'),

            })

        })

        it('TC-133', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.02163265306
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-600'),
                expectedMargin: ('0.012'),
                expectedPnl: ('0.005'),

            })

        })

        it('TC-132', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('7')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    cost: -0.01285554222
                }
            );

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-300'),
                expectedMargin: ('0.006'),
                expectedPnl: ('-0.001176470588'),

            })

        })

        it('TC-136', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('15')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader3,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.01547169811
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-600'),
                expectedMargin: ('0.012'),
                expectedPnl: ('-0.004615384615'),

            })

        })

        it('TC-139', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('15')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('8')),
                _trader: trader3,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('8')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true,
                cost: -0.003692307692
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('5')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.01015384615
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-200'),
                expectedMargin: ('0.004'),
                expectedPnl: ('-0.001538461538'),

            })

        })

        it('TC-148', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4600,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('3')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 4500,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('8')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('8')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    cost: -0.02422551136

                }
            );

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-200'),
                expectedMargin: ('0.004265340734'),
                expectedPnl: ('0.001791037106'),

            })

        })

        it('TC-149', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4600,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('3')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 4500,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('8')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4400,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('9')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.02849085209
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-200'),
                expectedMargin: ('0.004265340734'),
                expectedPnl: ('0.002801138116'),

            })

        })

        it('TC-104', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5500,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader3,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader3,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('8')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true,
                cost: -0.006769230769
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('2')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.005670094611
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('200'),
                expectedMargin: ('0.003805841218'),
                expectedPnl: ('-0.001941587824'),

            })

        })

        it('TC-156', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    cost: -0.01557315234
                }
            );

        })

        it('TC-161', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5500,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('2')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    cost: -0.01285067873
                }
            );

        })

        it('TC-162', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.01361236802
            })

        })

        it('TC-167', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5500,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('2')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.01088989442
            })

        })

        it('TC-168', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('4')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.02324413808
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-600'),
                expectedMargin: ('0.01237244898'),
                expectedPnl: ('0.003935084672'),

            })

            await changePrice({
                limitPrice: 4500,
                toHigherPrice: false
            })

            await openLimitPositionAndExpect({
                limitPrice: 4600,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('6')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4500,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('7')),
                _trader: trader3,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.029954430894
            })

        })

        it('TC-169', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('4')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.02628285357
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-600'),
                expectedMargin: ('0.01176470588'),
                expectedPnl: ('0.01001251564'),

            })

            await changePrice({
                limitPrice: 4500,
                toHigherPrice: false
            })

            await openLimitPositionAndExpect({
                limitPrice: 4600,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('6')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4500,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('7')),
                _trader: trader3,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.03907057736
            })

        })

        it('TC-173', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('2')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('4')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.02285062961
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-600'),
                expectedMargin: ('0.01245115067'),
                expectedPnl: ('0.003148067738'),

            })

            await changePrice({
                limitPrice: 4500,
                toHigherPrice: false
            })

            await openLimitPositionAndExpect({
                limitPrice: 4600,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('6')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4500,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('7')),
                _trader: trader3,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.028773905493
            })

        })

        it('TC-174', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('4')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.02324413808
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-600'),
                expectedMargin: ('0.01237244898'),
                expectedPnl: ('0.003935084672'),

            })

            await changePrice({
                limitPrice: 4500,
                toHigherPrice: false
            })

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4600,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('6')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    cost: -0.029029361509999997
                }
            );

        })

        it('TC-175', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('4')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.02628285357
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-600'),
                expectedMargin: ('0.01176470588'),
                expectedPnl: ('0.01001251564'),

            })

            await changePrice({
                limitPrice: 4500,
                toHigherPrice: false
            })

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4600,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('6')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    cost: -0.03814550797
                }
            );

        })

        it('TC-179', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('1')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('5')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('6')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('6')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.02323509191
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-400'),
                expectedMargin: ('0.008353958605'),
                expectedPnl: ('0.001566796932'),

            })

            await changePrice({
                limitPrice: 4500,
                toHigherPrice: false
            })

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4600,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('4')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    cost: -0.02572695822
                }
            );

        })

    })

    describe('Adjust Margin', async () => {
        it('TC-179', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-1000'),
                expectedMargin: ('0.0196078431373'),
                expectedMaintenanceMargin: ('0.0005882352941'),
                expectedMarginBalance: ('0.01960784313725'),
                expectedMarginRatio: ('2') //expect code = 2
            })

            await addMargin({
                trader: trader1,
                positionManager: positionManager,
                amount: 1
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-1000'),
                expectedMargin: ('1.0196078431373'),
                expectedMaintenanceMargin: ('0.0005882352941'),
                expectedMarginBalance: ('1.02352941176471'),
                expectedMarginRatio: ('0')
            })

            await changePrice({
                limitPrice: 5000,
                toHigherPrice: false
            })

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('5')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-1500'),
                expectedMargin: ('1.0296078431373'),
                expectedMaintenanceMargin: ('0.0008882352941'),
                expectedMarginBalance: ('1.03352941176471'),
                expectedMarginRatio: ('0')
            })

            await removeMargin({
                trader: trader1,
                positionManager: positionManager,
                amount: 0.5
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-1500'),
                expectedMargin: ('0.5296078431373'),
                expectedMaintenanceMargin: ('0.0008882352941'),
                expectedMarginBalance: ('0.53352941176471'),
                expectedMarginRatio: ('0')
            })

            await changePrice({
                limitPrice: 5100,
                toHigherPrice: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('3')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('12')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('12')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader4.address,
                    instanceTrader: trader4,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.5435294117255
            })

        })

        it('TC-181', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedMargin: ('0.0196078431373'),
                expectedMaintenanceMargin: ('0.0005882352941'),
                expectedMarginBalance: ('0.01960784313725'),
                expectedMarginRatio: ('2') //todo check margin ratio create new position
            })

            await addMargin({
                trader: trader1,
                positionManager: positionManager,
                amount: 0.01
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedMargin: ('0.0296078431373'),
                expectedMaintenanceMargin: ('0.0005882352941'),
                expectedMarginBalance: ('0.02960784313725'),
                expectedMarginRatio: ('1')
            })

            await changePrice({
                limitPrice: 5200,
                toHigherPrice: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('2')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    cost: -0.00444173141
                }
            );

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedMargin: ('0.023686274513'),
                expectedMaintenanceMargin: ('0.0004705882353'),
                expectedMarginBalance: ('0.01776692564'),
                expectedMarginRatio: ('2')
            })

            await removeMargin({
                trader: trader1,
                positionManager: positionManager,
                amount: 0.006
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedMargin: ('0.017686274510000002'),
                expectedMaintenanceMargin: ('0.0004705882353'),
                expectedMarginBalance: ('0.01176692564'),
                expectedMarginRatio: ('3')
            })

            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('2')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 5300,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader4.address,
                    instanceTrader: trader4,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: 0.01276808082
            })

        })

        it('TC-184', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('8')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('8')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedMargin: ('0.01632653061'),
                expectedMaintenanceMargin: ('0.0004897959184'),
                expectedMarginBalance: ('0.01632653061'),
            })

            await addMargin({
                trader: trader1,
                positionManager: positionManager,
                amount: 0.01
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedMargin: ('0.02632653061'),
                expectedMaintenanceMargin: ('0.0004897959184'),
                expectedMarginBalance: ('0.02632653061'),
                expectedMarginRatio: ('1')
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('12')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('12')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedMargin: ('0.05132653061'),
                expectedMaintenanceMargin: ('0.001239795918'),
                expectedMarginBalance: ('0.05472789115646'),
                expectedMarginRatio: ('2')
            })

            await removeMargin({
                trader: trader1,
                positionManager: positionManager,
                amount: 0.005
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedMargin: ('0.04632653061'),
                expectedMaintenanceMargin: ('0.001239795918'),
                expectedMarginBalance: ('0.04972789115646'),
                expectedMarginRatio: ('2')
            })

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('4')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: '0.04877985237'
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedMargin: ('0.03806122448979592'),
                expectedMaintenanceMargin: ('0.0009918367347'),
                expectedMarginBalance: ('0.04787451151'),
                expectedMarginRatio: ('2')
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('16')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('16')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    cost: -0.05150094081
                }
            );

        })

        it('TC-193', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('7')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('7')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('3')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedMargin: ('0.0206686930091'),
                expectedMaintenanceMargin: ('0.0006200607903'),
                expectedMarginBalance: ('0.01458966565357'),
            })

            await addMargin({
                trader: trader1,
                positionManager: positionManager,
                amount: 0.01
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedMargin: ('0.0306686930091'),
                expectedMaintenanceMargin: ('0.0006200607903'),
                expectedMarginBalance: ('0.0245896656535'),
                expectedMarginRatio: ('2')
            })

            await openLimitPositionAndExpect({
                limitPrice: 4600,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('4')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: positionManager,
                claimableAmount: '0.02638694331'
            })

            await openLimitPositionAndExpect({
                limitPrice: 4500,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('4')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedMargin: ('0.0312901046944'),
                expectedMaintenanceMargin: ('0.0006387031408'),
                expectedMarginBalance: ('0.0219689294157'),
                expectedMarginRatio: ('2')
            })

            await removeMargin({
                trader: trader1,
                positionManager: positionManager,
                amount: 0.004
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedMargin: ('0.02729010469'),
                expectedMaintenanceMargin: ('0.0006387031408'),
                expectedMarginBalance: ('0.01796892942'),
                expectedMarginRatio: ('3')
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('5')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await expectMarginPnlAndOP({
                positionManagerAddress: positionManager.address,
                traderAddress: trader1.address,
                expectedMargin: ('0.016645052262281934'),
                expectedPnl: ('0.002283856805'),
                expectedMaintenanceMargin: ('0.0003193515704'),
                expectedMarginBalance: ('0.01892890915'),
                expectedMarginRatio: ('1')
            })

            await removeMargin({
                trader: trader1,
                positionManager: positionManager,
                amount: 0.002
            })

            await openLimitPositionAndExpect({
                limitPrice: 4600,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('5')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    cost: -0.030239629678007435
                }
            );
        })

    })

    describe('Check liquidate', async () => {
        beforeEach(async () => {
            await insuranceFund.connect(trader0).setCounterParty(fundingRateTest.address)
        })

        it('TC-208', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );

            await changePrice({
                limitPrice: 5000,
                toHigherPrice: false,
                _positionManager: fundingRateTest
            })

            await changePrice({
                limitPrice: 4500,
                toHigherPrice: false,
                _positionManager: fundingRateTest
            })

            console.log('MarginRatio')

            await expectMarginPnlAndOP({
                positionManagerAddress: fundingRateTest.address,
                traderAddress: trader1.address,
                expectedQuantity: ('1000'),
                expectedMargin: ('0.0194193061840'),
                expectedPnl: ('-0.02802916038'),
                expectedMaintenanceMargin: ('0.0005825791855'),
                expectedMarginBalance: ('-0.0086098541981'),
                expectedMarginRatio: ('100')
            })

            await fundingRateTest.setMockPrice(4500, 4500)
            await positionHouse.liquidate(fundingRateTest.address, trader1.address)
        })

    })

    describe('Check Cancel Pending Order', async () => {
        it('TC-234', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('15')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('5')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('5')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                }
            );

            await cancelLimitOrderAndExpect({
                trader: trader1,
                positionManager: positionManager,
                orderIdx: 0,
                isReduce: 0,
                refundAmount: 0.01
            })

            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('4')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('4')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    cost: -0.008993464052
                }
            );

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('11')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('11')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    cost: -0.02887983912
                }
            );
        })

        it('TC-235', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true
            })
        })
    })

    describe('liquidate', async () => {
        beforeEach(async () => {
            await insuranceFund.connect(trader0).setCounterParty(fundingRateTest.address)
        })
        it('TC-208', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );

            await changePrice({
                limitPrice: 5000,
                toHigherPrice: false,
                _positionManager: fundingRateTest
            })

            await changePrice({
                limitPrice: 4500,
                toHigherPrice: false,
                _positionManager: fundingRateTest
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: fundingRateTest.address,
                traderAddress: trader1.address,
                expectedQuantity: ('1000'),
                expectedMargin: ('0.0194193061840'),
                expectedPnl: ('-0.02802916038'),
                expectedMaintenanceMargin: ('0.0005825791855'),
                expectedMarginBalance: ('-0.0086098541981'),
                expectedMarginRatio: ('100')
            })

            await fundingRateTest.setMockPrice(4500, 4500)

            await positionHouse.liquidate(fundingRateTest.address, trader1.address)
        })

        it('TC-209', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );

            await changePrice({
                limitPrice: 5400,
                toHigherPrice: true,
                _positionManager: fundingRateTest
            })

            await changePrice({
                limitPrice: 5700,
                toHigherPrice: true,
                _positionManager: fundingRateTest
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: fundingRateTest.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-1000'),
                expectedMargin: ('0.01941930618400'),
                expectedPnl: ('-0.01875446535'),
                expectedMaintenanceMargin: ('0.0005825791855'),
                expectedMarginBalance: ('0.00066484083512'),
                expectedMarginRatio: ('87')
            })

            await fundingRateTest.setMockPrice(5700, 5700)

            await positionHouse.liquidate(fundingRateTest.address, trader1.address)

            await expectMarginPnlAndOP({
                positionManagerAddress: fundingRateTest.address,
                traderAddress: trader1.address,
                expectedQuantity: ('-800'),
                expectedMargin: ('0.01883672699848'),
                expectedPnl: ('-0.01500357228'),
                expectedMaintenanceMargin: ('0.000565101815'),
                expectedMarginBalance: ('0.003833154719'),
                expectedMarginRatio: ('14')
            })

            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('8')),
                _trader: trader1,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('8')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: fundingRateTest,
                claimableAmount: 0.02034502262
            })
        })

        it('TC-210', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('9')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );

            await changePrice({
                limitPrice: 5427,
                toHigherPrice: true,
                _positionManager: fundingRateTest
            })

            await fundingRateTest.setMockPrice(5427, 5427)

            await positionHouse.liquidate(fundingRateTest.address, trader1.address)
        })

        it('TC-211', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('9')),
                _trader: trader1,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('9')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );

            await changePrice({
                limitPrice: 4467,
                toHigherPrice: true,
                _positionManager: fundingRateTest
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: fundingRateTest.address,
                traderAddress: trader1.address,
                expectedQuantity: ('900'),
                expectedMargin: ('0.0183673469388'),
                expectedPnl: ('-0.01780403229'),
                expectedMaintenanceMargin: ('0.0005510204082'),
                expectedMarginBalance: ('0.0005633146476'),
                expectedMarginRatio: ('97')
            })

            await fundingRateTest.setMockPrice(4467, 4467)

            await positionHouse.liquidate(fundingRateTest.address, trader1.address)

            await expectMarginPnlAndOP({
                positionManagerAddress: fundingRateTest.address,
                traderAddress: trader1.address,
                expectedQuantity: ('800'),
                expectedMargin: ('0.017816326530636'),
                expectedPnl: ('-0.01582580648'),
                expectedMaintenanceMargin: ('0.000534'),
                expectedMarginBalance: ('0.0019905200495'),
                expectedMarginRatio: ('26')
            })

            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('8')),
                _trader: trader1,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await openMarketPosition({
                    quantity: BigNumber.from(toWei('8')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );

            await expectClaimFund({
                trader: trader1,
                positionManager: fundingRateTest,
                claimableAmount: 0.033502601040416166
            })
        })

        it('TC-204', async () => {
            console.log("step 1")
            await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader1,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            console.log("step 2")
            await openMarketPosition({
                    quantity: BigNumber.from(toWei('4')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );

            await expectMarginPnlAndOP({
                positionManagerAddress: fundingRateTest.address,
                traderAddress: trader1.address,
                expectedQuantity: ('400'),
                expectedMargin: ('0.0080000000000'),
                expectedPnl: ('0'),
                expectedMaintenanceMargin: ('0.000240'),
                expectedMarginBalance: ('0.0080000000000'),
                expectedMarginRatio: ('3')
            })

            await addMargin({
                trader: trader1,
                positionManager: fundingRateTest,
                amount: 0.01
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: fundingRateTest.address,
                traderAddress: trader1.address,
                expectedQuantity: ('400'),
                expectedMargin: ('0.0180000000000'),
                expectedPnl: ('0'),
                expectedMaintenanceMargin: ('0.000240'),
                expectedMarginBalance: ('0.0180000000000'),
                expectedMarginRatio: ('1')
            })

            console.log("step 3")
            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('6')),
                _trader: trader2,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            console.log("step 4")
            await openMarketPosition({
                    quantity: BigNumber.from(toWei('5')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );

            console.log("step 5")
            await changePrice({
                limitPrice: 4512,
                toHigherPrice: false,
                _positionManager: fundingRateTest
            })

            console.log("step 6")
            await changePrice({
                limitPrice: 4319,
                toHigherPrice: false,
                _positionManager: fundingRateTest
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: fundingRateTest.address,
                traderAddress: trader1.address,
                expectedQuantity: ('1000'),
                expectedMargin: ('0.0302040816327'),
                expectedPnl: ('-0.029494261245'),
                expectedMaintenanceMargin: ('0.000606'),
                expectedMarginBalance: ('0.0007098203949'),
                expectedMarginRatio: ('85')
            })

            await fundingRateTest.setMockPrice(4319, 4319)
            console.log("before liquidate")
            await positionHouse.liquidate(fundingRateTest.address, trader1.address)

            await expectMarginPnlAndOP({
                positionManagerAddress: fundingRateTest.address,
                traderAddress: trader1.address,
                expectedQuantity: ('800'),
                expectedMargin: ('0.029297959183719004'),
                expectedPnl: ('-0.02359540899'),
                expectedMaintenanceMargin: ('0.000587938775510204'),
                expectedMarginBalance: ('0.0057025501935'),
                expectedMarginRatio: ('10')
            })

            await addMargin({
                trader: trader1,
                positionManager: fundingRateTest,
                amount: 0.01
            })

            await expectMarginPnlAndOP({
                positionManagerAddress: fundingRateTest.address,
                traderAddress: trader1.address,
                expectedQuantity: ('800'),
                expectedMargin: ('0.039297959183719006'),
                expectedPnl: ('-0.02359540899'),
                expectedMaintenanceMargin: ('0.000587938775510204'),
                expectedMarginBalance: ('0.0157025501935'),
                expectedMarginRatio: ('3')
            })
        })
    })
})
