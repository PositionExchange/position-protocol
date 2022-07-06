import {ethers} from "hardhat";
import {deployPositionHouse} from "../shared/deploy";
import {
    BEP20Mintable, FundingRateTest,
    InsuranceFund,
    PositionHouse,
    PositionHouseConfigurationProxy,
    PositionHouseViewer,
    PositionManager
} from "../../typeChain";
import {BigNumber, ContractFactory} from "ethers";
import PositionHouseTestingTool from "../shared/positionHouseTestingTool";
import {
    ChangePriceParams,
    ExpectMaintenanceDetail, ExpectTestCaseParams,
    LimitOrderReturns, PositionData,
    PositionLimitOrderID,
    SIDE,
    toWei
} from "../shared/utilities";
import {expect} from "chai";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

describe('Test Margin Intergration', function () {
    let positionHouse: PositionHouse;
    let positionManager: PositionManager;
    let positionManagerFactory: ContractFactory;
    let bep20Mintable: BEP20Mintable
    let insuranceFund: InsuranceFund
    let positionHouseViewer: PositionHouseViewer;
    let fundingRateTest : FundingRateTest
    let phTT: PositionHouseTestingTool
    let _;
    let trader0, trader1, trader2, trader3, trader4, tradercp1, tradercp2;

    beforeEach( async function () {
        [trader0, trader1, trader2, trader3, trader4, tradercp1, tradercp2] = await ethers.getSigners();
        [
            positionHouse,
            positionManager,
            positionManagerFactory,
            _,
            phTT,
            bep20Mintable,
            insuranceFund,
            positionHouseViewer,
            fundingRateTest
        ] = await deployPositionHouse() as any
    })


    describe('funding rate with limit order', function () {
        // currentPrice = 5000
        // S0: Call first time payFunding with underlyingPrice = 5100, twapPrice = 5000
        // S1: User1 open market Short at (5000,10)
        // S2: Increase market Short (4800,10)
        // S3: Call payFunding with underlyingPrice = 4850, twapPrice = 4800
        // S4: Close market Long (4850,15)
        // S5: Call payFunding with underlyingPrice = 4800, twapPrice = 4850
        // S6: Increase market Short (4850,10)
        // S7: Call payFunding with underlyingPrice = 4900, twapPrice = 4850
        // S8: Close 100% position by market Long (4900,15)
        it("EGE_TC_62: should calculate correct funding payment of position created by market order", async () => {
            const balanceOfTrader1BeforeTest = await bep20Mintable.balanceOf(trader1.address)
            const balanceOfTrader2BeforeTest = await bep20Mintable.balanceOf(trader2.address)

            // Step 0
            console.log("STEP 0")
            await fundingRateTest.setMockPrice(BigNumber.from("5100"), BigNumber.from("5000"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 1", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            // Step 1
            console.log("STEP 1")
            await phTT.openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader2,
                _positionManager: fundingRateTest
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = margin = entryPrice * quantity / leverage = 5000 * 10 / 10 = 5000
            const claimableFundAfterStep1 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep1.toString()).eq(toWei("5000"))

            // STEP 2
            console.log("STEP 2")
            await phTT.openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader2,
                _positionManager: fundingRateTest
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = total margin = 5000 + 4800 * 10 / 10 = 9800
            const claimableFundAfterStep2 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep2.toString()).eq(toWei("9800"))


            // Step 3
            console.log("STEP 3")
            await fundingRateTest.setMockTime(BigNumber.from("3601"))
            await fundingRateTest.setMockPrice(BigNumber.from("4850"), BigNumber.from("4800"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 2", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            // Step 4
            console.log("STEP 4")
            await phTT.openLimitPositionAndExpect({
                limitPrice: 4850,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('15')),
                _trader: trader2,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('15')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = marginAfterReverse + fundingPayment = 9800 * 1/4 - 4.20962136 = 2445.79037864
            const claimableFundAfterStep4 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep4.toString()).eq("2445790378640000000000")

            // Step 5
            console.log("STEP 5")
            await fundingRateTest.setMockTime(BigNumber.from("7202"))
            await fundingRateTest.setMockPrice(BigNumber.from("4800"), BigNumber.from("4850"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 3", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            // claimbleAmount = claimableAmount4 + fundingPayment = 2445.79037864 + 1.0651949572767516 = 2446.855573597277
            const claimableFundAfterStep5 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep5.toString()).eq("2446851919412723248328")

            // Step 6
            console.log("STEP 6")
            await phTT.openLimitPositionAndExpect({
                limitPrice: 4850,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader2,
                _positionManager: fundingRateTest
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = claimableAmount5 + newOrderMargin = 2446.855573597277 + 4850 * 10 / 10 = 7296.851919412723
            const claimableFundAfterStep6 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep6.toString()).eq("7296851919412723248328")


            // Step 7
            console.log("STEP 7")
            await fundingRateTest.setMockTime(BigNumber.from("10803"))
            await fundingRateTest.setMockPrice(BigNumber.from("4900"), BigNumber.from("4850"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 4", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            // claimbleAmount = claimableAmount6 + fundingPayment = 7296.851919412723 - 3.105077915773646 = 7293.746841496949
            const claimableFundAfterStep7 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep7.toString()).eq("7293749516882146540785")


            // Step 8
            console.log("STEP 8")
            await phTT.openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('15')),
                _trader: trader2,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('15')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );

            await positionHouse.connect(trader2).claimFund(fundingRateTest.address)

            const balanceOfTrader1AfterTest = await bep20Mintable.balanceOf(trader1.address)
            const balanceOfTrader2AfterTest = await bep20Mintable.balanceOf(trader2.address)

            const exchangedQuoteAmountOfTrader1 = balanceOfTrader1AfterTest.sub(balanceOfTrader1BeforeTest)
            const exchangedQuoteAmountOfTrader2 = balanceOfTrader2AfterTest.sub(balanceOfTrader2BeforeTest)

            console.log("exchanged quote amount trader1", exchangedQuoteAmountOfTrader1.toString())
            console.log("exchanged quote amount trader2", exchangedQuoteAmountOfTrader2.toString())
        })

        // currentPrice = 5000
        // S0: Call first time payFunding with underlyingPrice = 5100, twapPrice = 5000
        // S1: User1 open market Short at (5000, 10)
        // S1.5: Price dump to 4500
        // S2: Reverse market Long (4500, 5)
        // S3: Call payFunding with underlyingPrice = 4620, twapPrice = 4550
        // S4: Reverse market Long (4600, 2)
        // S5: Call payFunding with underlyingPrice = 4560, twapPrice = 4600
        // S5.5: Price pump to 4700
        // S6: Increase market Short (4700,10)
        // S7: Call payFunding with underlyingPrice = 4690, twapPrice = 4700
        // S8: Close 100% position by market Long (4800,13)
        it("EGE_TC_63: should calculate correct funding payment of position created by market order 2", async () => {
            const balanceOfTrader1BeforeTest = await bep20Mintable.balanceOf(trader1.address)
            const balanceOfTrader2BeforeTest = await bep20Mintable.balanceOf(trader2.address)

            // Step 0
            console.log("STEP 0")
            await fundingRateTest.setMockPrice(BigNumber.from("5100"), BigNumber.from("5000"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 1", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())
            // Step 1
            console.log("STEP 1")
            await phTT.openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader2,
                _positionManager: fundingRateTest
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = margin = entryPrice * quantity / leverage = 5000 * 10 / 10 = 5000
            const claimableFundAfterStep1 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep1.toString()).eq(toWei("5000"))

            // STEP 1.5
            await phTT.dumpPrice({
                toPrice: 4500,
                pumper: tradercp1,
                pumper2: tradercp2,
                positionManager: fundingRateTest
            })

            // STEP 2
            console.log("STEP 2")
            await phTT.openLimitPositionAndExpect({
                limitPrice: 4500,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            // close 5/10 quantity of old positition
            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('5')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = marginAfterReverse = 5000 * 1 / 2 = 2500
            const claimableFundAfterStep2 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep2.toString()).eq(toWei("2500"))

            // Step 3
            console.log("STEP 3")
            await fundingRateTest.setMockTime(BigNumber.from("3601"))
            await fundingRateTest.setMockPrice(BigNumber.from("4620"), BigNumber.from("4550"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 2", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            // claimbleAmount = margin + fundingPayment = 2500 - 1.57828275 = 2498.42171725
            const claimableFundAfterStep3 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep3.toString()).eq("2498421717250000000000")

            // Step 4
            console.log("STEP 4")
            await phTT.openLimitPositionAndExpect({
                limitPrice: 4600,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            // close 2/5 quantity of old position
            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('2')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = margin = 2500 * 3 / 5 - 1.57828275 = 1498.42171725
            const claimableFundAfterStep4 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep4.toString()).eq("1498421717250000000000")


            // Step 5
            console.log("STEP 5")
            await fundingRateTest.setMockTime(BigNumber.from("7202"))
            await fundingRateTest.setMockPrice(BigNumber.from("4560"), BigNumber.from("4600"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 3", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            // claimbleAmount = claimableAmountStep4 + fundingPayment = 1498.96938589239
            const claimableFundAfterStep5 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep5.toString()).eq("1498969385892389723250")

            // Step 5.5
            await phTT.pumpPrice({
                toPrice: 4700,
                pumper: tradercp1,
                pumper2: tradercp2,
                positionManager: fundingRateTest
            })

            // Step 6
            console.log("STEP 6")
            await phTT.openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader2,
                _positionManager: fundingRateTest,
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = claimableAmountStep5 + newOrderMargin = 1498.96938589239 + 4700 = 6198.96938589239
            const claimableFundAfterStep6 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep6.toString()).eq("6198969385892389723250")


            // Step 7
            console.log("STEP 7")
            await fundingRateTest.setMockTime(BigNumber.from("10803"))
            await fundingRateTest.setMockPrice(BigNumber.from("4690"), BigNumber.from("4700"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 4", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            // claimbleAmount = claimableAmountStep6 + fundingPayment = 6198.96938589239 + 0.5509087588054504 = 6199.520294651195
            const claimableFundAfterStep7 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep7.toString()).eq("6199520111631086481991")

            // Step 8
            console.log("STEP 8")
            await phTT.openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('13')),
                _trader: trader2,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('13')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );

            await positionHouse.connect(trader2).claimFund(fundingRateTest.address)

            const balanceOfTrader1AfterTest = await bep20Mintable.balanceOf(trader1.address)
            const balanceOfTrader2AfterTest = await bep20Mintable.balanceOf(trader2.address)

            const exchangedQuoteAmountOfTrader1 = balanceOfTrader1AfterTest.sub(balanceOfTrader1BeforeTest)
            const exchangedQuoteAmountOfTrader2 = balanceOfTrader2AfterTest.sub(balanceOfTrader2BeforeTest)

            console.log("exchanged quote amount trader1", exchangedQuoteAmountOfTrader1.toString())
            console.log("exchanged quote amount trader2", exchangedQuoteAmountOfTrader2.toString())
        })

        // currentPrice = 5000
        // S0: Call first time payFunding with underlyingPrice = 5100, twapPrice = 5000
        // S1: User1 open limit Long at (4900,10)
        // S2: Increase limit Long (4800,10)
        // S3: Call payFunding with underlyingPrice = 4850, twapPrice = 4800
        // S4: Close limit Short (4850,15)
        // S5: Call payFunding with underlyingPrice = 4830, twapPrice = 4850
        // S6: Increase market Long (5100,10)
        // S7: Call payFunding with underlyingPrice = 4950, twapPrice = 4850
        // S8: Close 100% position by limit Short (5200,15)
        it("EGE_TC_64: should calculate correct funding payment of position created by limit order", async () => {
            const balanceOfTrader1BeforeTest = await bep20Mintable.balanceOf(trader1.address)
            const balanceOfTrader2BeforeTest = await bep20Mintable.balanceOf(trader2.address)

            // Step 0
            console.log("STEP 0")
            await fundingRateTest.setMockPrice(BigNumber.from("5100"), BigNumber.from("5000"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 1", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())
            // Step 1
            console.log("STEP 1")

            await phTT.openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: fundingRateTest
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = margin = entryPrice * quantity / leverage = 4900 * 10 / 10 = 5000
            const claimableFundAfterStep1 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep1.toString()).eq(toWei("4900"))

            // STEP 2
            console.log("STEP 2")
            await phTT.openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: fundingRateTest
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = total margin = 4900 + 4800 * 10 / 10 = 9700
            const claimableFundAfterStep2 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep2.toString()).eq(toWei("9700"))

            // Step 3
            console.log("STEP 3")
            await fundingRateTest.setMockTime(BigNumber.from("3601"))
            await fundingRateTest.setMockPrice(BigNumber.from("4850"), BigNumber.from("4800"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 2", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            // claimbleAmount = margin + fundingPayment = 9700 + 4.16666604 = 9704.16666604
            const claimableFundAfterStep3 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep3.toString()).eq("9704166666040000000000")


            // Step 4
            console.log("STEP 4")
            await phTT.openLimitPositionAndExpect({
                limitPrice: 4850,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('15')),
                _trader: trader1,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('15')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = oldMargin = 9700 = 9700
            const claimableFundAfterStep4 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep4.toString()).eq("9700000000000000000000")

            // Step 5
            console.log("STEP 5")
            await fundingRateTest.setMockTime(BigNumber.from("7202"))
            await fundingRateTest.setMockPrice(BigNumber.from("4830"), BigNumber.from("4850"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 3", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            // claimbleAmount = claimableFundAfterStep4 + fundingPayment = 9700 - 1.67356719 = 9698.32643281
            const claimableFundAfterStep5 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep5.toString()).eq("9698326432810000000000")

            // Step 6
            console.log("STEP 6")
            await phTT.openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader2,
                _positionManager: fundingRateTest
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = oldPositionMargin + newOrderMargin + fundingPayment = 9700 + 5100 - 0.4183917975 = 14799.5816082025
            const claimableFundAfterStep6 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep6.toString()).eq("14799581608202500000000")

            // Step 7
            console.log("STEP 7")
            await fundingRateTest.setMockTime(BigNumber.from("10803"))
            await fundingRateTest.setMockPrice(BigNumber.from("4950"), BigNumber.from("4850"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 4", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            // claimbleAmount = claimableFundAfterStep6 + fundingPayment = 14799.5816082025 + 12.45826402163026 = 14812.03916786087
            const claimableFundAfterStep7 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep7.toString()).eq("14812039167860869740937")


            // Step 8
            console.log("STEP 8")
            await phTT.openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('15')),
                _trader: trader1,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('15')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = claimableFundAfterStep7 + pnl = 14812.03916786087 + 15*(5200 - 5016.67) = 17561.98916786087
            const claimableFundAfterStep8 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep8.toString()).eq("17562040167860869740937")

            await positionHouse.connect(trader1).claimFund(fundingRateTest.address)

            const balanceOfTrader1AfterTest = await bep20Mintable.balanceOf(trader1.address)
            const balanceOfTrader2AfterTest = await bep20Mintable.balanceOf(trader2.address)

            const exchangedQuoteAmountOfTrader1 = balanceOfTrader1AfterTest.sub(balanceOfTrader1BeforeTest)
            const exchangedQuoteAmountOfTrader2 = balanceOfTrader2AfterTest.sub(balanceOfTrader2BeforeTest)

            console.log("exchanged quote amount trader1", exchangedQuoteAmountOfTrader1.toString())
            console.log("exchanged quote amount trader2", exchangedQuoteAmountOfTrader2.toString())
        })

        // currentPrice = 5000
        // S0: Call first time payFunding with underlyingPrice = 4950, twapPrice = 5000
        // S1: User1 open limit Long at (4900,10)
        // S2: User1 open limit Short at (5000,5)
        // S3: Call payFunding with underlyingPrice = 5070, twapPrice = 5000
        // S4: User1 close limit Short at (5100,2)
        // S5: Call payFunding with underlyingPrice = 5150, twapPrice = 5100
        // S6: User1 close market Short at (4700,2)
        // S7: Call payFunding with underlyingPrice = 5020, twapPrice = 5050
        // S8: User1 close limit Short (5200,1)
        it("EGE_TC_65", async () => {
            const balanceOfTrader1BeforeTest = await bep20Mintable.balanceOf(trader1.address)
            const balanceOfTrader2BeforeTest = await bep20Mintable.balanceOf(trader2.address)

            // Step 0
            console.log("STEP 0")
            await fundingRateTest.setMockPrice(BigNumber.from("5100"), BigNumber.from("5000"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 1", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            // Step 1
            console.log("STEP 1")

            await phTT.openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: fundingRateTest
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = margin = entryPrice * quantity / leverage = 4900 * 10 / 10 = 4900
            const claimableFundAfterStep1 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep1.toString()).eq(toWei("4900"))

            // Step 2
            console.log("STEP 2")

            await phTT.openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader1,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('5')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = old margin + pnl = 4900 + (5000-4900)*5 = 5400
            const claimableFundAfterStep2 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep2.toString()).eq(toWei("5400"))

            // Step 3
            console.log("STEP 3")
            await fundingRateTest.setMockTime(BigNumber.from("3601"))
            await fundingRateTest.setMockPrice(BigNumber.from("5070"), BigNumber.from("5000"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 2", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            // claimbleAmount = claimableFundAfterStep2 + fundingPayment = 5400 + 2.81886906 = 5402.81886906
            const claimableFundAfterStep3 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep3.toString()).eq("5402818869060000000000")

            // Step 4
            console.log("STEP 4")

            await phTT.openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader1,
                _positionManager: fundingRateTest,
                skipCheckBalance: true,
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('2')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = claimalbeAmountAfterStep2 + pnl = 5400 + (5100-4900)*2 = 5800
            const claimableFundAfterStep4 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep4.toString()).eq(toWei("5800"))

            // Step 5
            console.log("STEP 5")
            await fundingRateTest.setMockTime(BigNumber.from("7202"))
            await fundingRateTest.setMockPrice(BigNumber.from("5150"), BigNumber.from("5100"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 3", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            // claimbleAmount = claimalbeAmountAfterStep4 + fundingPayment = 5800 + 1.98220043 = 5801.98220043
            const claimableFundAfterStep5 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep5.toString()).eq("5801982200430000000000")

            // Step 6
            console.log("STEP 6")

            await phTT.openLimitPositionAndExpect({
                limitPrice: 4700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader2,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('2')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = claimalbeAmountAfterStep5 + fundingPayment - claimedMargin = 5800 - 0.594660129 - 4900*2/10 = 4819.405339871
            console.log((await positionHouseViewer.getPosition(fundingRateTest.address, trader1.address)).margin.toString())
            const claimableFundAfterStep6 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep6.toString()).eq("4819405339871000000000")

            // Step 7
            console.log("STEP 7")
            await fundingRateTest.setMockTime(BigNumber.from("10803"))
            await fundingRateTest.setMockPrice(BigNumber.from("5020"), BigNumber.from("5050"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 4", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            // claimbleAmount = claimalbeAmountAfterStep6 + fundingPayment = 4819.405339871 - 0.976095288 = 4818.429244583001
            const claimableFundAfterStep7 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep7.toString()).eq("4818429392655691295504")


            // Step 8
            console.log("STEP 8")

            await phTT.openLimitPositionAndExpect({
                limitPrice: 5200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('1')),
                _trader: trader1,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('1')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = claimalbeAmountAfterStep7 + pnl = 4818.429244583001 + 300 = 5118.429244583001
            const claimableFundAfterStep8 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep8.toString()).eq("5118429392655691295504")

            await positionHouse.connect(trader1).claimFund(fundingRateTest.address)

            const balanceOfTrader1AfterTest = await bep20Mintable.balanceOf(trader1.address)
            const balanceOfTrader2AfterTest = await bep20Mintable.balanceOf(trader2.address)

            const exchangedQuoteAmountOfTrader1 = balanceOfTrader1AfterTest.sub(balanceOfTrader1BeforeTest)
            const exchangedQuoteAmountOfTrader2 = balanceOfTrader2AfterTest.sub(balanceOfTrader2BeforeTest)

            console.log("exchanged quote amount trader1", exchangedQuoteAmountOfTrader1.toString())
            console.log("exchanged quote amount trader2", exchangedQuoteAmountOfTrader2.toString())

        })

        // currentPrice = 3900
        // S0: Call first time payFunding with underlyingPrice = 3955, twapPrice = 3910
        // S1: User1 open limit Short at (4000,10)
        // S2: Call payFunding with underlyingPrice = 3987, twapPrice = 4010
        // S2.5: Price pump to 4200
        // S3: User1 open limit Long (4200,2)
        // S4: User1 open market Long (4300,3)
        // S5: Call payFunding with underlyingPrice = 4396, twapPrice = 4387
        // S6: User1 close market L (4400,5)
        it("EGE_TC_70", async () => {
            await phTT.dumpPrice({
                toPrice: 3900,
                pumper1: tradercp1,
                pumper2: tradercp2,
                positionManager: fundingRateTest
            })

            const balanceOfTrader1BeforeTest = await bep20Mintable.balanceOf(trader1.address)
            const balanceOfTrader2BeforeTest = await bep20Mintable.balanceOf(trader2.address)

            // Step 0
            console.log("STEP 0")
            await fundingRateTest.setMockPrice(BigNumber.from("3955"), BigNumber.from("3910"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 1", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            // Step 1
            console.log("STEP 1")

            await phTT.openLimitPositionAndExpect({
                limitPrice: 4000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: fundingRateTest
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = margin = entryPrice * quantity / leverage = 4000 * 10 / 10 = 4000
            const claimableFundAfterStep1 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep1.toString()).eq(toWei("4000"))

            // Step 2
            console.log("STEP 2")
            await fundingRateTest.setMockTime(BigNumber.from("3601"))
            await fundingRateTest.setMockPrice(BigNumber.from("3987"), BigNumber.from("4010"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 2", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            // claimbleAmount = claimableFundAfterStep1 + fundingPayment = 4000 + 0.961458 = 4000.961458
            const claimableFundAfterStep2 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep2.toString()).eq(toWei("4000.961458"))

            // Step 2.5
            console.log("STEP 2.5")
            await phTT.pumpPrice({
                toPrice: 4200,
                pumper: tradercp1,
                pumper2: tradercp2,
                positionManager: fundingRateTest
            })

            // Step 3
            console.log("STEP 3")
            await phTT.openLimitPositionAndExpect({
                limitPrice: 4200,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('2')),
                _trader: trader1,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('2')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = totalMargin + pnl = 4000 - 400 = 3600
            const claimableFundAfterStep3 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep3.toString()).eq(toWei("3600"))

            // Step 4
            console.log("STEP 4")
            await phTT.openLimitPositionAndExpect({
                limitPrice: 4300,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('3')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = claimableFundAfterStep3 - claimedMargin = 3600 - 4000*3/10 = 2400
            const claimableFundAfterStep4 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep4.toString()).eq(toWei("2400"))

            // Step 5
            console.log("STEP 5")
            await fundingRateTest.setMockTime(BigNumber.from("7202"))
            await fundingRateTest.setMockPrice(BigNumber.from("4396"), BigNumber.from("4387"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 3", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            // claimbleAmount = claimableFundAfterStep5 + fundingPayment = 2400 - 0.23885344 = 2399.76114656
            const claimableFundAfterStep6 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep6.toString()).eq(toWei("2399.76114656"))


            // Step 6
            console.log("STEP 6")
            await phTT.openLimitPositionAndExpect({
                limitPrice: 4350,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('5')),
                _trader: trader2,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('5')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );

            const balanceOfTrader1AfterTest = await bep20Mintable.balanceOf(trader1.address)
            const balanceOfTrader2AfterTest = await bep20Mintable.balanceOf(trader2.address)

            const exchangedQuoteAmountOfTrader1 = balanceOfTrader1AfterTest.sub(balanceOfTrader1BeforeTest)
            const exchangedQuoteAmountOfTrader2 = balanceOfTrader2AfterTest.sub(balanceOfTrader2BeforeTest)

            console.log("exchanged quote amount trader1", exchangedQuoteAmountOfTrader1.toString())
            console.log("exchanged quote amount trader2", exchangedQuoteAmountOfTrader2.toString())
        })


        // currentPrice = 3900
        // S0: Call first time payFunding with underlyingPrice = 3917, twapPrice = 3943
        // S1: User1 open limit Short at (4000,10)
        // S2: Call payFunding with underlyingPrice = 4013, twapPrice = 4026
        // S3: User1 open limit Short at (4200,8)
        // S4: User1 open market Long at (4400,15)
        // S5: Call payFunding with underlyingPrice = 4414, twapPrice = 4399
        // S6: User1 close limit Long at (4400,3)
        it("EGE_TC_71", async () => {
            await phTT.dumpPrice({
                toPrice: 4000,
                pumper: tradercp1,
                pumper2: tradercp2,
                positionManager: fundingRateTest
            })

            const balanceOfTrader1BeforeTest = await bep20Mintable.balanceOf(trader1.address)
            const balanceOfTrader2BeforeTest = await bep20Mintable.balanceOf(trader2.address)

            // Step 0
            console.log("STEP 0")
            await fundingRateTest.setMockPrice(BigNumber.from("3917"), BigNumber.from("3943"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 1", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            // Step 1
            console.log("STEP 1")

            await phTT.openLimitPositionAndExpect({
                limitPrice: 4000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: fundingRateTest
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = margin = entryPrice * quantity / leverage = 4000 * 10 / 10 = 4000
            const claimableFundAfterStep1 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep1.toString()).eq(toWei("4000"))

            // Step 2
            console.log("STEP 2")
            await fundingRateTest.setMockTime(BigNumber.from("3601"))
            await fundingRateTest.setMockPrice(BigNumber.from("4013"), BigNumber.from("4026"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 2", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            // claimbleAmount = claimableFundAfterStep1 + fundingPayment = 4000 + 0.5399116 = 4000.5399116
            const claimableFundAfterStep2 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep2.toString()).eq(toWei("4000.5399116"))

            // Step 3
            console.log("STEP 3")

            await phTT.openLimitPositionAndExpect({
                limitPrice: 4200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('8')),
                _trader: trader1,
                _positionManager: fundingRateTest
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('8')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = totalMargin = 4000 + 4200*8/10 = 7360
            const claimableFundAfterStep3 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep3.toString()).eq(toWei("7360"))


            // Step 4
            console.log("STEP 4")

            await phTT.openLimitPositionAndExpect({
                limitPrice: 4400,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from(toWei('15')),
                _trader: trader2,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('15')),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = claimableFundAfterStep3 - claimedMargin = 7360 - 7360*15/18 = 1226.666666666667
            const claimableFundAfterStep4 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep4.toString()).eq("1226666666666666666667")


            // Step 5
            console.log("STEP 5")
            await fundingRateTest.setMockTime(BigNumber.from("7202"))
            await fundingRateTest.setMockPrice(BigNumber.from("4414"), BigNumber.from("4399"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 2", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            // claimbleAmount = claimableFundAfterStep4 + fundingPayment = 1226.666666666667 - 0.17368974400000003 = 1226.492976922667
            const claimableFundAfterStep5 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep5.toString()).eq("1226492976922666666667")

            // Step 6
            console.log("STEP 6")

            await phTT.openLimitPositionAndExpect({
                limitPrice: 4400,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader1,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('3')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );

            // claimbleAmount = claimableFundAfterStep5 + pnl = 1226.492976922667 - 933.3333333333339 = 293.159643589333
            const claimableFundAfterStep6 = await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)
            expect(claimableFundAfterStep6.toString()).eq("293160876922666666667")


            await positionHouse.connect(trader1).claimFund(fundingRateTest.address)

            const balanceOfTrader1AfterTest = await bep20Mintable.balanceOf(trader1.address)
            const balanceOfTrader2AfterTest = await bep20Mintable.balanceOf(trader2.address)

            const exchangedQuoteAmountOfTrader1 = balanceOfTrader1AfterTest.sub(balanceOfTrader1BeforeTest)
            const exchangedQuoteAmountOfTrader2 = balanceOfTrader2AfterTest.sub(balanceOfTrader2BeforeTest)

            console.log("exchanged quote amount trader1", exchangedQuoteAmountOfTrader1.toString())
            console.log("exchanged quote amount trader2", exchangedQuoteAmountOfTrader2.toString())

        })

        it("should pay funding based on open margin, not included added margin", async () => {
            // Step 0
            console.log("STEP 0")
            await fundingRateTest.setMockPrice(BigNumber.from("5200"), BigNumber.from("5000"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 1", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            // Step 1
            console.log("STEP 1")

            await phTT.openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('10')),
                _trader: trader1,
                _positionManager: fundingRateTest
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('10')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );

            await positionHouse.connect(trader1).addMargin(fundingRateTest.address, toWei('10000'))

            // Step 2
            console.log("STEP 2")
            await fundingRateTest.setMockTime(BigNumber.from("3601"))
            await fundingRateTest.setMockPrice(BigNumber.from("5300"), BigNumber.from("5000"))
            await positionHouse.payFunding(fundingRateTest.address)
            console.log("LATEST CUMULATIVE PREMIUM FRACTION 2", (await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

            console.log((await positionHouseViewer.getFundingPaymentAmount(fundingRateTest.address, trader1.address)).toString())

            await phTT.openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from(toWei('3')),
                _trader: trader2,
                _positionManager: fundingRateTest,
                skipCheckBalance: true
            })

            const balanceBeforeClose = await bep20Mintable.balanceOf(trader1.address)
            await phTT.openMarketPosition({
                    quantity: BigNumber.from(toWei('3')),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );

            // await positionHouse.connect(trader1).claimFund(fundingRateTest.address)
            const balanceAfterClose = await bep20Mintable.balanceOf(trader1.address)
            console.log((await balanceAfterClose.sub(balanceBeforeClose)).toString())
            console.log((await positionHouseViewer.getPosition(fundingRateTest.address, trader1.address)).toString())
            console.log((await positionHouseViewer.getFundingPaymentAmount(fundingRateTest.address, trader1.address)).toString())
        })
    })
})