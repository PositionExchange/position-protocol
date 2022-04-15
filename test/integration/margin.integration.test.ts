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
import {SIDE} from "../shared/utilities";
import {expect} from "chai";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

describe('Test Margin Intergration', function () {
    let positionHouse: PositionHouse;
    let positionManager: PositionManager;
    let positionManagerFactory: ContractFactory;
    let bep20Mintable: BEP20Mintable
    let insuranceFund: InsuranceFund
    let positionHouseViewer: PositionHouseViewer;
    let positionHouseConfigurationProxy: PositionHouseConfigurationProxy;
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

    describe('margin without funding rate', function () {
        async function expectManualAddedMargin(trader: SignerWithAddress, amount: number, _positionManager? : any){
            _positionManager = _positionManager || positionManager
            const addedMargin = await positionHouse.getAddedMargin(_positionManager.address, trader.address)
            expect(addedMargin.toString()).eq(amount.toString())
        }
        it("should reduce manual margin when open reverse position without PnL", async () => {
            await phTT.openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 1,
                quantity: BigNumber.from('10'),
                _trader: trader1
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader4.address,
                    instanceTrader: trader4,
                    _positionManager: positionManager,
                }
            );

            // Trader1's margin = price / leverage * quantity = 5000 / 1 * 10 = 50000, pnl = 0 cause price hasn't changed
            await phTT.expectPositionMargin(positionManager, trader1, 50000, 0)
            await positionHouse.connect(trader1).addMargin(positionManager.address, BigNumber.from("1000"))
            // Trader1's margin += 1000 = 50000 + 1000
            await phTT.expectPositionMargin(positionManager, trader1, 51000, 0)
            await expectManualAddedMargin(trader1,1000)

            await phTT.openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 1,
                quantity: BigNumber.from('10'),
                _trader: trader2
            })

            // closing 3/10 position, should get back 3/10 position's margin
            await phTT.closePosition({
                    quantity: BigNumber.from('3'),
                    trader: trader1,
                    positionManager
                }
            );
            // Trader's margin -= 3*51000/10 = 35700
            await phTT.expectPositionMargin(positionManager, trader1, 35700, 0)
            await expectManualAddedMargin(trader1,700)

            // closing 2/7 position, should get back 2/7 position's margin
            await phTT.closePosition({
                    quantity: BigNumber.from('2'),
                    trader: trader1,
                    positionManager
                }
            );
            // Trader1's margin = 35700 - (2*35700)/7 = 25500
            await phTT.expectPositionMargin(positionManager, trader1, 25500, 0)
            await expectManualAddedMargin(trader1,500)


            // now trader1 adds 2000 margin
            await positionHouse.connect(trader1).addMargin(positionManager.address, BigNumber.from("2000"))
            // Trader1's margin = 25500 + 2000 = 27500
            await phTT.expectPositionMargin(positionManager, trader1, 27500, 0)
            await expectManualAddedMargin(trader1,2500)

            // now trader1 closes 3/5 position should get 16500
            await phTT.closePosition({
                    quantity: BigNumber.from('3'),
                    trader: trader1,
                    positionManager
                }
            );
            await phTT.expectPositionMargin(positionManager, trader1, 27500 - 16500, 0) // 11000
            await expectManualAddedMargin(trader1,1000)

            await positionHouse.connect(trader1).removeMargin(positionManager.address, BigNumber.from('800'))
            await expectManualAddedMargin(trader1, 200)
            await phTT.expectPositionMargin(positionManager, trader1, 10200, 0)

            // close 1/2
            await phTT.closePosition({
                    quantity: BigNumber.from('1'),
                    trader: trader1,
                    positionManager
                }
            );
            await expectManualAddedMargin(trader1, 100)
            await phTT.expectPositionMargin(positionManager, trader1, 5100, 0)

            // close all
            await phTT.closePosition({
                    quantity: BigNumber.from('1'),
                    trader: trader1,
                    positionManager
                }
            );
            await expectManualAddedMargin(trader1, 0)
            await phTT.expectPositionMargin(positionManager, trader1, 0, 0)


        })

        it('should count margin correctly when open reverse position with PnL > 0', async function () {
            await phTT.openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 1,
                quantity: BigNumber.from('10'),
                _trader: trader1
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader4.address,
                    instanceTrader: trader4,
                    _positionManager: positionManager,
                }
            );

            await phTT.pumpPrice({
                toPrice: 5100,
                pumper: tradercp1,
                pumper2: tradercp2
            })

            // Trader1's margin = price / leverage * quantity = 5000 / 1 * 10 = 50000
            // Trader1's total pnl with full quantity = positionNotional - openNotional
            // = quantity * (currentPrice - entryPrice) = 10 * (5100 - 5000) = 1000
            await phTT.expectPositionMargin(positionManager, trader1, 50000, 1000)
            await positionHouse.connect(trader1).addMargin(positionManager.address, BigNumber.from("1000"))
            // Trader1's margin += 1000 = 50000 + 1000
            // Trader1's total pnl with full quantity = 1000
            await phTT.expectPositionMargin(positionManager, trader1, 51000, 1000)
            await expectManualAddedMargin(trader1,1000)

            await phTT.openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.LONG,
                leverage: 1,
                quantity: BigNumber.from('10'),
                _trader: trader2
            })

            // closing 3/10 position, should get back 3/10 position's margin + pnl 300
            await phTT.closePosition({
                    quantity: BigNumber.from('3'),
                    trader: trader1,
                    positionManager,
                    pnl: 300
                }
            );
            // Trader's margin -= 3*51000/10 = 35700
            // Trader1's pnl with quantity 7/10 = 7/10 * 1000 = 700
            await phTT.expectPositionMargin(positionManager, trader1, 35700, 700)
            await expectManualAddedMargin(trader1,700)

            // closing 2/7 position, should get back 2/7 position's margin + pnl = 2/7 * 700 = 200
            await phTT.closePosition({
                    quantity: BigNumber.from('2'),
                    trader: trader1,
                    positionManager,
                    pnl: 200
                }
            );
            // Trader1's margin = 35700 - (2*35700)/7 = 25500
            // Trader1's pnl with quantity 5/7 = 5/7 * 700 = 500
            await phTT.expectPositionMargin(positionManager, trader1, 25500, 500)
            await expectManualAddedMargin(trader1,500)


            // now trader1 adds 2000 margin
            await positionHouse.connect(trader1).addMargin(positionManager.address, BigNumber.from("2000"))
            // Trader1's margin = 25500 + 2000 = 27500
            // Trader1's pnl hasn't changed = 500
            await phTT.expectPositionMargin(positionManager, trader1, 27500, 500)
            await expectManualAddedMargin(trader1,2500)

            // now trader1 closes 3/5 position should get 16500 + pnl = 3/5 * 500 = 300
            await phTT.closePosition({
                    quantity: BigNumber.from('3'),
                    trader: trader1,
                    positionManager,
                    pnl: 300
                }
            );
            // Trader1's margin = 27500 - 16500 = 11000
            // Trader1's pnl = 500 - 300 = 200
            await phTT.expectPositionMargin(positionManager, trader1, 27500 - 16500, 200)
            await expectManualAddedMargin(trader1,1000)

            await positionHouse.connect(trader1).removeMargin(positionManager.address, BigNumber.from('800'))
            await expectManualAddedMargin(trader1, 200)
            // Trader1's margin = 11000 - 800 = 10200
            // Trader1's pnl hasn't changed = 200
            await phTT.expectPositionMargin(positionManager, trader1, 10200, 200)

            // close 1/2 should get margin = 10200/2 = 5100 and pnl = 200 / 2 = 100
            await phTT.closePosition({
                    quantity: BigNumber.from('1'),
                    trader: trader1,
                    positionManager,
                    pnl: 100
                }
            );
            await expectManualAddedMargin(trader1, 100)
            // Trader1's margin = 10200 - 5100 = 5100
            // Trader1's pnl = 200 - 100 = 100
            await phTT.expectPositionMargin(positionManager, trader1, 5100, 100)

            // close all should get margin = 5100 and pnl = 100
            await phTT.closePosition({
                    quantity: BigNumber.from('1'),
                    trader: trader1,
                    positionManager,
                    pnl: 100
                }
            );
            await expectManualAddedMargin(trader1, 0)
            await phTT.expectPositionMargin(positionManager, trader1, 0)
        });

        it('should count margin correctly when open reverse position with PnL < 0', async function () {
            await phTT.openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 1,
                quantity: BigNumber.from('10'),
                _trader: trader1
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader4.address,
                    instanceTrader: trader4,
                    _positionManager: positionManager,
                }
            );

            await phTT.dumpPrice({
                toPrice: 4800,
                pumper: tradercp1,
                pumper2: tradercp2,
            })

            // Trader1's margin = price / leverage * quantity = 5000 / 1 * 10 = 50000
            // Trader1's total pnl with full quantity = positionNotional - openNotional
            // = quantity * (currentPrice - entryPrice) = 10 * (4800 - 5000) = -2000
            await phTT.expectPositionMargin(positionManager, trader1, 50000, -2000)
            await positionHouse.connect(trader1).addMargin(positionManager.address, BigNumber.from("1000"))
            // Trader1's margin += 1000 = 50000 + 1000
            // Trader1's total pnl with full quantity = -2000
            await phTT.expectPositionMargin(positionManager, trader1, 51000, -2000)
            await expectManualAddedMargin(trader1,1000)

            await phTT.openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 1,
                quantity: BigNumber.from('10'),
                _trader: trader2
            })

            // closing 3/10 position, should get back 3/10 position's margin + pnl = 3/10 * -2000 = -600
            await phTT.closePosition({
                    quantity: BigNumber.from('3'),
                    trader: trader1,
                    positionManager,
                    pnl: -600
                }
            );
            // Trader's margin -= 3*51000/10 = 35700
            // Trader1's pnl with quantity 7/10 = 7/10 * -2000 = -1400
            await phTT.expectPositionMargin(positionManager, trader1, 35700, -1400)
            await expectManualAddedMargin(trader1,700)

            // closing 2/7 position, should get back 2/7 position's margin + pnl = 2/7 * -1400 = -400
            await phTT.closePosition({
                    quantity: BigNumber.from('2'),
                    trader: trader1,
                    positionManager,
                    pnl: -400
                }
            );
            // Trader1's margin = 35700 - (2*35700)/7 = 25500
            // Trader1's pnl with quantity 5/7 = 5/7 * 700 = -1000
            await phTT.expectPositionMargin(positionManager, trader1, 25500, -1000)
            await expectManualAddedMargin(trader1,500)


            // now trader1 adds 2000 margin
            await positionHouse.connect(trader1).addMargin(positionManager.address, BigNumber.from("2000"))
            // Trader1's margin = 25500 + 2000 = 27500
            // Trader1's pnl hasn't changed = -1000
            await phTT.expectPositionMargin(positionManager, trader1, 27500, -1000)
            await expectManualAddedMargin(trader1,2500)

            // now trader1 closes 3/5 position should get 16500 + pnl = 3/5 * -1000 = -600
            await phTT.closePosition({
                    quantity: BigNumber.from('3'),
                    trader: trader1,
                    positionManager,
                    pnl: -600
                }
            );
            // Trader1's margin = 27500 - 16500 = 11000
            // Trader1's pnl = -1000 - (-600) = -400
            await phTT.expectPositionMargin(positionManager, trader1, 27500 - 16500, -400)
            await expectManualAddedMargin(trader1,1000)

            await positionHouse.connect(trader1).removeMargin(positionManager.address, BigNumber.from('800'))
            await expectManualAddedMargin(trader1, 200)
            // Trader1's margin = 11000 - 800 = 10200
            // Trader1's pnl hasn't changed = -400
            await phTT.expectPositionMargin(positionManager, trader1, 10200, -400)

            // close 1/2 should get margin = 10200/2 = 5100 and pnl = -400 / 2 = -200
            await phTT.closePosition({
                    quantity: BigNumber.from('1'),
                    trader: trader1,
                    positionManager,
                    pnl: -200
                }
            );
            await expectManualAddedMargin(trader1, 100)
            // Trader1's margin = 10200 - 5100 = 5100
            // Trader1's pnl = -400 - (-200) = -200
            await phTT.expectPositionMargin(positionManager, trader1, 5100, -200)

            // close all should get margin = 5100 and pnl = -200
            await phTT.closePosition({
                    quantity: BigNumber.from('1'),
                    trader: trader1,
                    positionManager,
                    pnl: -200
                }
            );
            await expectManualAddedMargin(trader1, 0)
            await phTT.expectPositionMargin(positionManager, trader1, 0)
        });

        it("should be partial liquidated when losing almost added margin + position margin", async () => {
            await phTT.openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from('10'),
                _trader: trader1,
                _positionManager: fundingRateTest
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader4.address,
                    instanceTrader: trader4,
                    _positionManager: fundingRateTest,
                }
            );

            // Trader1's margin = price / leverage * quantity = 5000 / 1 * 10 = 50000
            // Trader1's pnl = 0 cause price hasn't changed
            await phTT.expectPositionMargin(fundingRateTest, trader1, 5000, 0)

            await positionHouse.connect(trader1).addMargin(fundingRateTest.address, BigNumber.from("1000"))
            // Trader1's margin += 1000 = 50000 + 1000
            await phTT.expectPositionMargin(fundingRateTest, trader1, 6000, 0)
            await expectManualAddedMargin(trader1,1000, fundingRateTest)

            await phTT.dumpPrice({
                toPrice: 4417,
                pumper: tradercp1,
                pumper2: tradercp2,
                positionManager: fundingRateTest
            })

            await fundingRateTest.setMockPrice(BigNumber.from("4417"), BigNumber.from("4417"))

            await phTT.openLimitPositionAndExpect({
                limitPrice: 4417,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from('2'),
                _trader: trader3,
                _positionManager: fundingRateTest
            })
            // partial liquidate trader1's position
            await positionHouse.liquidate(fundingRateTest.address, trader1.address)
            // position after liquidated loss 3% margin and 20% quantity
            // Trader1's margin = 97% * oldMargin = 97% * 6000 = 5820
            // Trader1's total pnl with partial liquidated quantity = positionNotional - openNotional
            // = 80% * oldQuantity * (currentPrice - entryPrice) = 80% * 10 * (4417 - 5000) = -4664
            await phTT.expectPositionMargin(fundingRateTest, trader1, 5820, -4664)
            // Trader1's manual added margin = 97% * oldManualMargin = 97% * 1000 = 970
            await expectManualAddedMargin(trader1,970, fundingRateTest)

            await phTT.pumpPrice({
                toPrice: 4800,
                pumper: tradercp1,
                pumper2: tradercp2,
                positionManager: fundingRateTest
            })

            await phTT.openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from('8'),
                _trader: trader2,
                _positionManager: fundingRateTest
            })

            // Trader1's new pnl = positionNotional - openNotional
            // = quantity * (currentPrice - entryPrice) = 8 * (4800 - 5000) = -1600
            // close 5/8 position, should get back 5/8 margin = 5/8 * 5820 = 3638
            // and 5/8 pnl = 5/8 * -1600 = -1000
            await phTT.closePosition({
                    quantity: BigNumber.from('5'),
                    trader: trader1,
                    positionManager: fundingRateTest,
                    pnl: -1000
                }
            );
            // Trader1's margin = 5820 - 3638 = 2182
            // Trader1's pnl = -1600 - (-1000) = -600
            await phTT.expectPositionMargin(fundingRateTest, trader1, 2182, -600)
            // Trader1's manualMargin = 3/8 * 970 = 363
            await expectManualAddedMargin(trader1, 363, fundingRateTest)

            // close all should get back margin = 3638 and pnl = -600
            await phTT.closePosition({
                    quantity: BigNumber.from('3'),
                    trader: trader1,
                    positionManager: fundingRateTest,
                    pnl: -600
                }
            );

            await phTT.expectPositionMargin(fundingRateTest, trader1, 0)
            await expectManualAddedMargin(trader1, 0, fundingRateTest)
        })

        it("should be full liquidated when losing more than added margin + position margin", async () => {
            await phTT.openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from('10'),
                _trader: trader1,
                _positionManager: fundingRateTest
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader4.address,
                    instanceTrader: trader4,
                    _positionManager: fundingRateTest,
                }
            );

            // Trader1's margin = price / leverage * quantity = 5000 / 1 * 10 = 50000
            await phTT.expectPositionMargin(fundingRateTest, trader1, 5000)

            await positionHouse.connect(trader1).addMargin(fundingRateTest.address, BigNumber.from("1000"))
            // Trader1's margin += 1000 = 50000 + 1000
            await phTT.expectPositionMargin(fundingRateTest, trader1, 6000)
            await expectManualAddedMargin(trader1,1000, fundingRateTest)

            await phTT.dumpPrice({
                toPrice: 4410,
                pumper: tradercp1,
                pumper2: tradercp2,
                positionManager: fundingRateTest
            })

            await fundingRateTest.setMockPrice(BigNumber.from("4410"), BigNumber.from("4410"))

            // full liquidate trader1's position
            await positionHouse.liquidate(fundingRateTest.address, trader1.address)

            // position is clear after fully liquidated
            await phTT.expectPositionMargin(fundingRateTest, trader1, 0)
            await expectManualAddedMargin(trader1,0, fundingRateTest)
        })

        it("should get correct amount of claimable fund when add and remove margin then close position by limit order", async () => {
            await phTT.dumpPrice({
                toPrice: 3900,
                pumper: tradercp1,
                pumper2: tradercp2,
                positionManager: fundingRateTest
            })
            console.log("step 1")
            const balanceOfTrader1BeforeTestcase = await bep20Mintable.balanceOf(trader1.address)
            // STEP 1
            await phTT.openLimitPositionAndExpect({
                limitPrice: 4000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('10'),
                _trader: trader1,
                _positionManager: fundingRateTest
            })
            console.log("step 2")
            // STEP 2
            await phTT.openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );
            console.log("step 3")
            // STEP 3
            await positionHouse.connect(trader1).addMargin(fundingRateTest.address, BigNumber.from("2000"))

            await phTT.pumpPrice({
                toPrice: 4100,
                pumper: tradercp1,
                pumper2: tradercp2,
                positionManager: fundingRateTest
            })
            console.log("step 4")
            // STEP 4
            await phTT.openLimitPositionAndExpect({
                limitPrice: 4200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('2'),
                _trader: trader2,
                _positionManager: fundingRateTest
            })
            console.log("step 5")
            // STEP 5
            await phTT.openMarketPosition({
                    quantity: BigNumber.from('2'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );
            await fundingRateTest.setMockPrice(BigNumber.from("4100"), BigNumber.from("4100"))
            await positionHouse.connect(trader1).removeMargin(fundingRateTest.address, BigNumber.from("800"))
            console.log("step 6")
            // STEP 6
            await phTT.openLimitPositionAndExpect({
                limitPrice: 4200,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('2'),
                _trader: trader1,
                _positionManager: fundingRateTest
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from('2'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );
            console.log("step 7")
            // STEP 7
            await positionHouse.connect(trader1).closeLimitPosition(fundingRateTest.address, 420000, BigNumber.from("10"))

            await phTT.openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );
            await positionHouse.connect(trader1).claimFund(fundingRateTest.address)
            const balanceOfTrader1AfterTestcase = await bep20Mintable.balanceOf(trader1.address)
            const exchangedQuoteAmount = BigNumber.from(balanceOfTrader1AfterTestcase).sub(BigNumber.from(balanceOfTrader1BeforeTestcase))
            console.log("exchangedQuoteAmount", exchangedQuoteAmount.toString())
            expect(exchangedQuoteAmount).eq("-2008")
        })

        it("should get correct amount of claimable fund when add and remove margin then close position by limit order 2", async () => {
            await phTT.dumpPrice({
                toPrice: 3900,
                pumper: tradercp1,
                pumper2: tradercp2,
                positionManager: fundingRateTest
            })

            console.log("step 1")
            const balanceOfTrader1BeforeTestcase = await bep20Mintable.balanceOf(trader1.address)
            // STEP 1
            await phTT.openLimitPositionAndExpect({
                limitPrice: 4000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('10'),
                _trader: trader1,
                _positionManager: fundingRateTest
            })
            console.log("step 2")
            // STEP 2
            await phTT.openMarketPosition({
                    quantity: BigNumber.from('10'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: fundingRateTest,
                }
            );
            console.log("step 3")
            // STEP 3
            await positionHouse.connect(trader1).addMargin(fundingRateTest.address, BigNumber.from("2000"))
            console.log("step 4")
            // STEP 4
            await phTT.dumpPrice({
                toPrice: 3900,
                pumper: tradercp1,
                pumper2: tradercp2,
                positionManager: fundingRateTest
            })

            console.log("step 5")
            // STEP 5
            await phTT.openLimitPositionAndExpect({
                limitPrice: 3900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from('5'),
                _trader: trader2,
                _positionManager: fundingRateTest
            })
            console.log("step 6")
            // STEP 6
            await phTT.openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );
            console.log("step 7")
            // STEP 7
            await fundingRateTest.setMockPrice(BigNumber.from("3900"), BigNumber.from("3900"))
            await positionHouse.connect(trader1).removeMargin(fundingRateTest.address, BigNumber.from("1000"))
            console.log("step 8")
            // STEP 8
            await phTT.pumpPrice({
                toPrice: 4000,
                pumper: tradercp1,
                pumper2: tradercp2,
                positionManager: fundingRateTest
            })
            console.log("step 9")
            // STEP 9
            await phTT.openLimitPositionAndExpect({
                limitPrice: 3900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from('3'),
                _trader: trader1,
                _positionManager: fundingRateTest
            })
            console.log("step 10")
            // STEP 10
            await phTT.openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: fundingRateTest,
                }
            );
            console.log("step 11")
            // STEP 11
            await positionHouse.connect(trader1).closeLimitPosition(fundingRateTest.address, 370000, BigNumber.from("12"))
            console.log("step 12")
            // STEP 12
            await phTT.openMarketPosition({
                    quantity: BigNumber.from('12'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader4.address,
                    instanceTrader: trader4,
                    _positionManager: fundingRateTest,
                }
            );

            await positionHouse.connect(trader1).claimFund(fundingRateTest.address)
            const balanceOfTrader1AfterTestcase = await bep20Mintable.balanceOf(trader1.address)
            const exchangedQuoteAmount = BigNumber.from(balanceOfTrader1AfterTestcase).sub(BigNumber.from(balanceOfTrader1BeforeTestcase))
            console.log("exchangedQuoteAmount", exchangedQuoteAmount.toString())
            expect(exchangedQuoteAmount).eq("3391")
        })

        it("should get correct amount of claimable fund when add and remove margin then close position by limit order 3", async () => {
            await phTT.dumpPrice({
                toPrice: 3700,
                pumper: tradercp1,
                pumper2: tradercp2,
                positionManager: fundingRateTest
            })

            console.log("step 1")
            const balanceOfTrader1BeforeTestcase = await bep20Mintable.balanceOf(trader1.address)
            // STEP 1
            await phTT.openLimitPositionAndExpect({
                limitPrice: 3700,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from('10'),
                _trader: trader4,
                _positionManager: fundingRateTest
            })


            await phTT.openLimitPositionAndExpect({
                limitPrice: 3600,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from('5'),
                _trader: trader4,
                _positionManager: fundingRateTest
            })

            // open market
            await phTT.openMarketPosition({
                    quantity: BigNumber.from('15'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );
            await phTT.debugPosition(trader1, fundingRateTest)
            // now position quantity should be -15
            // open notional = 55000
            // margin = 5500

            console.log("step 2")
            // STEP 2
            // close limit 5/15 at the price of 3500
            // should claimable (55000-3500*15)/3 = 833.3 (pnl) + 1833.33 (margin of the position) + 1750 (margin of limit order) = 4416.63
            await phTT.openLimitPositionAndExpect({
                limitPrice: 3500,
                side: SIDE.LONG,
                leverage: 10,
                quantity: BigNumber.from('5'),
                _trader: trader1,
                _positionManager: fundingRateTest
            })

            await phTT.openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader4.address,
                    instanceTrader: trader4,
                    _positionManager: fundingRateTest,
                }
            );
            await phTT.debugPosition(trader1, fundingRateTest)
            // const [positionData, positionDataWithoutLimit, limitOrders, reduceLimitOrders] = await positionHouseViewer.getClaimableAmountParams(fundingRateTest.address, trader1.address)
            // printStruct(positionData)
            // printStruct(positionDataWithoutLimit)
            // printStruct(reduceLimitOrders[0])
            // console.log(positionData.map(elm => elm.toString()), positionDataWithoutLimit, limitOrders, reduceLimitOrders)

            // after this order the trader1's position should have
            // open notional = 36667
            // margin = 3667
            // quantity = -10
            expect(await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)).eq('4416')

            console.log("step 3")
            // STEP 3
            // await positionHouse.connect(trader1).addMargin(fundingRateTest.address, BigNumber.from("2000"))

            console.log("step 4")
            // STEP 4
            await positionHouse.connect(trader1).closeLimitPosition(fundingRateTest.address, BigNumber.from("350000"), BigNumber.from("2"))

            await phTT.openMarketPosition({
                    quantity: BigNumber.from('2'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader4.address,
                    instanceTrader: trader4,
                    _positionManager: fundingRateTest,
                }
            );
            // after this order
            // trader1's claimable amount should be
            // 4416 + 1/5*3667 + 700 + 333 (pnl) = 5849
            expect(await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)).eq('6182')

            console.log("step 5")
            // STEP 5
            await phTT.openLimitPositionAndExpect({
                limitPrice: 3500,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: BigNumber.from('2'),
                _trader: trader3,
                _positionManager: fundingRateTest
            })

            // close market
            // trader1's should claim able 6182
            // TODO verify debt margin -1466 is it correct?
            await phTT.openMarketPosition({
                    quantity: BigNumber.from('2'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: fundingRateTest,
                }
            );
            console.log("step 6")
            expect(await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)).eq('4716')// TODO verify??
            // STEP 6
            await fundingRateTest.setMockPrice(BigNumber.from("3500"), BigNumber.from("3500"))
            // await positionHouse.connect(trader1).removeMargin(fundingRateTest.address, BigNumber.from("750"))

            console.log("step 7")
            // STEP 7
            await phTT.debugPosition(trader1, fundingRateTest)

            await positionHouse.connect(trader1).closeLimitPosition(fundingRateTest.address, BigNumber.from("340000"), BigNumber.from("6"))
            await phTT.openMarketPosition({
                    quantity: BigNumber.from('6'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: fundingRateTest,
                }
            );
            // after this order trader's should receive all the profit + margin
            // = 4716 + (3400*6/10 | margin) + (22001 - 20400 | pnl) = 8357
            // the claimable amount should be 8357

            expect(await positionHouseViewer.getClaimAmount(fundingRateTest.address, trader1.address)).eq('8357')

            await positionHouse.connect(trader1).claimFund(fundingRateTest.address)
            const balanceOfTrader1AfterTestcase = await bep20Mintable.balanceOf(trader1.address)
            const exchangedQuoteAmount = BigNumber.from(balanceOfTrader1AfterTestcase).sub(BigNumber.from(balanceOfTrader1BeforeTestcase))
            console.log("exchangedQuoteAmount", exchangedQuoteAmount.toString())
            expect(exchangedQuoteAmount).eq("3100")
        })
    });


    describe('margin with funding rate', function () {

    });


});


function printStruct(result){
    const keys = Object.keys(result)
    const data = {}
    for(const key of keys){
        if(isNaN(Number(key))){
            data[key] = result[key]._isBigNumber ? result[key].toString() : result[key]
        }
    }
    console.table(data)
}