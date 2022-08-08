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
    CancelLimitOrderParams
} from "../shared/utilities";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {CHAINLINK_ABI_TESTNET} from "../../constants";
import PositionManagerTestingTool from "../shared/positionManagerTestingTool";

import PositionHouseTestingTool from "../shared/positionHouseTestingTool";
import {deployPositionHouse} from "../shared/deploy";

describe("PositionCoinMargin_01", () => {
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
        await positionHouse.addMargin(input.positionManager.address, toWei(input.amount))
        const balanceAfterAddMargin = await bep20Mintable.balanceOf(input.trader.address)
        const depositedMargin = balanceBeforeAddMargin.sub(balanceAfterAddMargin)
        if (input.amount != undefined) {
            await expect(depositedMargin).eq(toWei(input.amount))
        }
    }

    async function removeMargin(input) {
        const balanceBeforeRemoveMargin = await bep20Mintable.balanceOf(input.trader.address)
        await positionHouse.addMargin(input.positionManager.address, toWei(input.amount))
        const balanceAfterRemoveMargin = await bep20Mintable.balanceOf(input.trader.address)
        const depositedMargin = balanceBeforeRemoveMargin.sub(balanceAfterRemoveMargin)
        if (input.amount != undefined) {
            await expect(depositedMargin).eq(toWei(-input.amount))
        }
    }

    describe("should expect order book", async () => {
        it('should expect order', async () => {
            await openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: positionManager,
                skipCheckBalance: true,
            })

            await openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true,
            })

            await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader1,
                _positionManager: positionManager,
                skipCheckBalance: true,
            })

            await expectOrderbook([
                {
                    pip: 510000,
                    quantity: 500
                },
                {
                    pip: 490000,
                    quantity: 500
                },
                {
                    pip: 480000,
                    quantity: 500
                }
            ])
        })
    })

})