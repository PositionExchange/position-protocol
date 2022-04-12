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

            // Trader1's margin = price * leverage * quantity = 5000 * 1 * 10 = 50000
            await phTT.expectPositionMargin(positionManager, trader1, 50000)
            await positionHouse.connect(trader1).addMargin(positionManager.address, BigNumber.from("1000"))
            // Trader1's margin += 1000 = 50000 + 1000
            await phTT.expectPositionMargin(positionManager, trader1, 51000)
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
            await phTT.expectPositionMargin(positionManager, trader1, 35700)
            await expectManualAddedMargin(trader1,700)

            // closing 2/7 position, should get back 2/7 position's margin
            await phTT.closePosition({
                    quantity: BigNumber.from('2'),
                    trader: trader1,
                    positionManager
                }
            );
            // Trader1's margin = 35700 - (2*35700)/7 = 25500
            await phTT.expectPositionMargin(positionManager, trader1, 25500)
            await expectManualAddedMargin(trader1,500)


            // now trader1 adds 2000 margin
            await positionHouse.connect(trader1).addMargin(positionManager.address, BigNumber.from("2000"))
            // Trader1's margin = 25500 + 2000 = 27500
            await phTT.expectPositionMargin(positionManager, trader1, 27500)
            await expectManualAddedMargin(trader1,2500)

            // now trader1 closes 3/5 position should get 16500
            await phTT.closePosition({
                    quantity: BigNumber.from('3'),
                    trader: trader1,
                    positionManager
                }
            );
            await phTT.expectPositionMargin(positionManager, trader1, 27500 - 16500) // 11000
            await expectManualAddedMargin(trader1,1000)

            await positionHouse.connect(trader1).removeMargin(positionManager.address, BigNumber.from('800'))
            await expectManualAddedMargin(trader1, 200)
            await phTT.expectPositionMargin(positionManager, trader1, 10200)

            // close 1/2
            await phTT.closePosition({
                    quantity: BigNumber.from('1'),
                    trader: trader1,
                    positionManager
                }
            );
            await expectManualAddedMargin(trader1, 100)
            await phTT.expectPositionMargin(positionManager, trader1, 5100)

            // close all
            await phTT.closePosition({
                    quantity: BigNumber.from('1'),
                    trader: trader1,
                    positionManager
                }
            );
            await expectManualAddedMargin(trader1, 0)
            await phTT.expectPositionMargin(positionManager, trader1, 0)


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

            // Trader1's margin = price * leverage * quantity = 5000 * 1 * 10 = 50000
            await phTT.expectPositionMargin(positionManager, trader1, 50000)
            await positionHouse.connect(trader1).addMargin(positionManager.address, BigNumber.from("1000"))
            // Trader1's margin += 1000 = 50000 + 1000
            await phTT.expectPositionMargin(positionManager, trader1, 51000)
            await expectManualAddedMargin(trader1,1000)

            await phTT.openLimitPositionAndExpect({
                limitPrice: 5100,
                side: SIDE.LONG,
                leverage: 1,
                quantity: BigNumber.from('10'),
                _trader: trader2
            })

            // closing 3/10 position, should get back 3/10 position's margin
            await phTT.closePosition({
                    quantity: BigNumber.from('3'),
                    trader: trader1,
                    positionManager,
                    pnl: 300
                }
            );
            // Trader's margin -= 3*51000/10 = 35700
            await phTT.expectPositionMargin(positionManager, trader1, 35700)
            await expectManualAddedMargin(trader1,700)

            // closing 2/7 position, should get back 2/7 position's margin
            await phTT.closePosition({
                    quantity: BigNumber.from('2'),
                    trader: trader1,
                    positionManager,
                    pnl: 200
                }
            );
            // Trader1's margin = 35700 - (2*35700)/7 = 25500
            await phTT.expectPositionMargin(positionManager, trader1, 25500)
            await expectManualAddedMargin(trader1,500)


            // now trader1 adds 2000 margin
            await positionHouse.connect(trader1).addMargin(positionManager.address, BigNumber.from("2000"))
            // Trader1's margin = 25500 + 2000 = 27500
            await phTT.expectPositionMargin(positionManager, trader1, 27500)
            await expectManualAddedMargin(trader1,2500)

            // now trader1 closes 3/5 position should get 16500
            await phTT.closePosition({
                    quantity: BigNumber.from('3'),
                    trader: trader1,
                    positionManager,
                    pnl: 300
                }
            );
            await phTT.expectPositionMargin(positionManager, trader1, 27500 - 16500) // 11000
            await expectManualAddedMargin(trader1,1000)

            await positionHouse.connect(trader1).removeMargin(positionManager.address, BigNumber.from('800'))
            await expectManualAddedMargin(trader1, 200)
            await phTT.expectPositionMargin(positionManager, trader1, 10200)

            // close 1/2
            await phTT.closePosition({
                    quantity: BigNumber.from('1'),
                    trader: trader1,
                    positionManager,
                    pnl: 100
                }
            );
            await expectManualAddedMargin(trader1, 100)
            await phTT.expectPositionMargin(positionManager, trader1, 5100)

            // close all
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

            // Trader1's margin = price * leverage * quantity = 5000 * 1 * 10 = 50000
            await phTT.expectPositionMargin(positionManager, trader1, 50000)
            await positionHouse.connect(trader1).addMargin(positionManager.address, BigNumber.from("1000"))
            // Trader1's margin += 1000 = 50000 + 1000
            await phTT.expectPositionMargin(positionManager, trader1, 51000)
            await expectManualAddedMargin(trader1,1000)

            await phTT.openLimitPositionAndExpect({
                limitPrice: 4800,
                side: SIDE.LONG,
                leverage: 1,
                quantity: BigNumber.from('10'),
                _trader: trader2
            })

            // closing 3/10 position, should get back 3/10 position's margin
            await phTT.closePosition({
                    quantity: BigNumber.from('3'),
                    trader: trader1,
                    positionManager,
                    pnl: -600
                }
            );
            // Trader's margin -= 3*51000/10 = 35700
            await phTT.expectPositionMargin(positionManager, trader1, 35700)
            await expectManualAddedMargin(trader1,700)

            // closing 2/7 position, should get back 2/7 position's margin
            await phTT.closePosition({
                    quantity: BigNumber.from('2'),
                    trader: trader1,
                    positionManager,
                    pnl: -400
                }
            );
            // Trader1's margin = 35700 - (2*35700)/7 = 25500
            await phTT.expectPositionMargin(positionManager, trader1, 25500)
            await expectManualAddedMargin(trader1,500)


            // now trader1 adds 2000 margin
            await positionHouse.connect(trader1).addMargin(positionManager.address, BigNumber.from("2000"))
            // Trader1's margin = 25500 + 2000 = 27500
            await phTT.expectPositionMargin(positionManager, trader1, 27500)
            await expectManualAddedMargin(trader1,2500)

            // now trader1 closes 3/5 position should get 16500
            await phTT.closePosition({
                    quantity: BigNumber.from('3'),
                    trader: trader1,
                    positionManager,
                    pnl: -600
                }
            );
            await phTT.expectPositionMargin(positionManager, trader1, 27500 - 16500) // 11000
            await expectManualAddedMargin(trader1,1000)

            await positionHouse.connect(trader1).removeMargin(positionManager.address, BigNumber.from('800'))
            await expectManualAddedMargin(trader1, 200)
            await phTT.expectPositionMargin(positionManager, trader1, 10200)

            // close 1/2
            await phTT.closePosition({
                    quantity: BigNumber.from('1'),
                    trader: trader1,
                    positionManager,
                    pnl: -200
                }
            );
            await expectManualAddedMargin(trader1, 100)
            await phTT.expectPositionMargin(positionManager, trader1, 5100)

            // close all
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

        it("should be partial liquidated when losing more than added margin", async () => {
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

            // Trader1's margin = price * leverage * quantity = 5000 * 1 * 10 = 50000
            await phTT.expectPositionMargin(fundingRateTest, trader1, 5000)

            await positionHouse.connect(trader1).addMargin(fundingRateTest.address, BigNumber.from("1000"))
            // Trader1's margin += 1000 = 50000 + 1000
            await phTT.expectPositionMargin(fundingRateTest, trader1, 6000)
            await expectManualAddedMargin(trader1,1000, fundingRateTest)

            await phTT.dumpPrice({
                toPrice: 4417,
                pumper: tradercp1,
                pumper2: tradercp2,
                positionManager: fundingRateTest
            })

            await fundingRateTest.setMockPrice(BigNumber.from("44170000"), BigNumber.from("44170000"))

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

            // position after liquidated loss 3%
            await phTT.expectPositionMargin(fundingRateTest, trader1, 5820)
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

            // close 5/8 position
            await phTT.closePosition({
                    quantity: BigNumber.from('5'),
                    trader: trader1,
                    positionManager: fundingRateTest,
                    pnl: -1000
                }
            );

            await phTT.expectPositionMargin(fundingRateTest, trader1, 2182)
            await expectManualAddedMargin(trader1, 363, fundingRateTest)

            // close all
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
        // test liquidate with manual margin

    });


    describe('margin with funding rate', function () {

    });


});