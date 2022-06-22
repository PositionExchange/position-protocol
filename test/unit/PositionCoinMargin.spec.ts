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
    toWeiWithString, ExpectTestCaseParams, ExpectMaintenanceDetail, toWei, multiNumberToWei, fromWei
} from "../shared/utilities";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {CHAINLINK_ABI_TESTNET} from "../../constants";
import PositionManagerTestingTool from "../shared/positionManagerTestingTool";

import PositionHouseTestingTool from "../shared/positionHouseTestingTool";
import {deployPositionHouse} from "../shared/deploy";
import {describe} from "mocha";

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
        const openMarketReturn = positionHouseTestingTool.openMarketPosition(input)
        const balanceAfterOpenMarket = await bep20Mintable.balanceOf(input.trader)
        const depositedQuoteAmount = balanceBeforeOpenMarket.sub(balanceAfterOpenMarket)
        if (input.cost != undefined) {
            await expect(depositedQuoteAmount).eq(toWei(input.cost))
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
        const openLimitReturn = positionHouseTestingTool.openLimitPositionAndExpect(input)
        const balanceAfterOpenLimit = await bep20Mintable.balanceOf(input._trader.address)
        const depositedQuoteAmount = balanceBeforeOpenLimit.sub(balanceAfterOpenLimit)
        if (input.cost != undefined) {
            await expect(depositedQuoteAmount).eq(toWei(input.cost))
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
                expectedQuantity: (5*100),
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

    })

    describe('example', async () => {
        it('example', async () => {


        })

    })

    describe('example', async () => {

    })

    it('example', async () => {

    })
})
