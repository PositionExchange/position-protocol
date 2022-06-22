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
    toWeiWithString, ExpectTestCaseParams, ExpectMaintenanceDetail, toWei, multiNumberToWei
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
                expectedOpenNotional: BigNumber.from('102040816326530612'),
                expectedMargin: BigNumber.from('10204081632653061'),
                expectedQuantity: BigNumber.from(toWei(5*100)),
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
                expectedMargin: BigNumber.from('25498824150322484'),
                expectedPnl: BigNumber.from('17891533180101435')
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
                expectedMargin: BigNumber.from('31451205102703436'),
                expectedPnl: BigNumber.from('17891533180101435')
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
})