import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {PositionHouse, PositionManager} from "../../typeChain";
import {ethers, waffle} from "hardhat";
import {deployPositionHouse} from "../shared/deploy";
import {use, expect} from "chai";
import {OrderSide, POSITION_SIDE, PositionData, toWeiBN} from "../shared/utilities";
import {BigNumber} from "ethers";
const {solidity} = waffle
use(solidity)

function parseOrder(obj){
    return {pip: obj.pip * 10, quantity: ethers.utils.parseEther(obj.quantity.toString())}
}



describe('Market Maker', function () {
    let deployer: SignerWithAddress
    let positionManager: PositionManager
    let positionHouse: PositionHouse

    beforeEach(async () => {
        [deployer] = await ethers.getSigners();
        [positionHouse, positionManager] = await deployPositionHouse() as any
        await positionHouse.connect(deployer).setMMWhitelist(deployer.address, true)
    })

    describe('supply', function () {
        describe('should revert', function () {
            it('should revert buy when price >= market price', async  function () {
                function setUpAndTest(orders){
                    const tx = positionHouse.supply(positionManager.address, orders.map(parseOrder), 10)
                    return expect(tx).to.be.revertedWith("!B")
                }
                await setUpAndTest([
                    {pip: 500000, quantity: 100},
                    {pip: 1001, quantity: 100},
                    {pip: 1002, quantity: 100},
                    {pip: 1003, quantity: -100},
                    {pip: 1004, quantity: -100},
                    {pip: 1005, quantity: -100},
                ])
                await setUpAndTest([
                    {pip: 40000, quantity: 100},
                    {pip: 50001, quantity: 100},
                    {pip: 49000, quantity: 100},
                    {pip: 1003, quantity: -100},
                    {pip: 1004, quantity: -100},
                    {pip: 1005, quantity: -100},
                ])
                await setUpAndTest([
                    {pip: 40000, quantity: 100},
                    {pip: 20000, quantity: 100},
                    {pip: 60000, quantity: 100},
                    {pip: 1003, quantity: -100},
                    {pip: 1004, quantity: -100},
                    {pip: 1005, quantity: -100},
                ])

            });
            it('should revert sell when price <= market price', async  function () {
                function setUpAndTest(orders){
                    const tx = positionHouse.supply(positionManager.address, orders.map(parseOrder), 10)
                    return expect(tx).to.be.revertedWith("!S")
                }
                await setUpAndTest([
                    {pip: 40000, quantity: 100},
                    {pip: 20000, quantity: 100},
                    {pip: 30000, quantity: 100},
                    {pip: 50000, quantity: -100},
                    {pip: 50001, quantity: -100},
                    {pip: 50002, quantity: -100},
                ])
                await setUpAndTest([
                    {pip: 40000, quantity: 100},
                    {pip: 20000, quantity: 100},
                    {pip: 30000, quantity: 100},
                    {pip: 56000, quantity: -100},
                    {pip: 40000, quantity: -100},
                    {pip: 50002, quantity: -100},
                ])
                await setUpAndTest([
                    {pip: 40000, quantity: 100},
                    {pip: 20000, quantity: 100},
                    {pip: 30000, quantity: 100},
                    {pip: 56000, quantity: -100},
                    {pip: 50001, quantity: -100},
                    {pip: 2000, quantity: -100},
                ])

            });

        });

        describe("should success", function() {
            async function setUpAndTest(orders) {
                const tx = await positionHouse.supply(positionManager.address, orders.map(parseOrder), 10)
                expect(tx.hash).not.to.be.eq(null)
                const receipt = await tx.wait()
                console.log(receipt)
                console.log("Gas: ", receipt.gasUsed.toString())
                // expect(tx).to.be.calledOnContract(positionHouse)
            }
            it('should place orders sucessfully', async () => {
                await setUpAndTest([
                    {pip: 40000, quantity: 100},
                    {pip: 20000, quantity: 100},
                    {pip: 30000, quantity: 100},
                    {pip: 56000, quantity: -100},
                    {pip: 50001, quantity: -100},
                    {pip: 50002, quantity: -100},
                ])
            });
            it('should place orders and fill marker successfully', async function () {
                await setUpAndTest([
                    {pip: 40000, quantity: 100},
                    {pip: 20000, quantity: 100},
                    {pip: 30000, quantity: 100},
                    {pip: 56000, quantity: -100},
                    {pip: 50001, quantity: -100},
                    {pip: 50002, quantity: -100},
                ])
                const tx = await positionHouse.openMarketPosition(positionManager.address, POSITION_SIDE.LONG, 10, 10)
                const positionInfo = await positionHouse.getPosition(positionManager.address, deployer.address) as unknown as PositionData;
                expect(positionInfo.quantity.toNumber()).eq(10)
                console.log("notional",positionInfo.openNotional.toString())
            });
        })
    });

    describe('remove', function () {
        let orders = [
            {pip: 40000, quantity: 100},
            {pip: 20000, quantity: 100},
            {pip: 30000, quantity: 100},
            {pip: 56000, quantity: -100},
            {pip: 50001, quantity: -100},
            {pip: 50002, quantity: -100},
        ].map(parseOrder)
        const cancelOrderId = orders.map(obj => ({pip: obj.pip, orderId: 1}))
        async function expectHasLiquidity(pip, value: boolean = true){
            expect(await positionManager.hasLiquidity(pip)).eq(value)
        }
        beforeEach(async function () {
            await positionHouse.supply(positionManager.address, orders , 10)
            for(const order of orders){
                await expectHasLiquidity(order.pip, true)
            }
        })
        it('should remove successfully', async function () {

            // @ts-ignore
            const tx = await positionHouse.remove(positionManager.address, cancelOrderId)
            console.log("gas used",(await tx.wait()).gasUsed.toString())
            for(const order of orders){
                await expectHasLiquidity(order.pip, false)
            }
        });
        it('should not remove filled order', async function () {
            await positionHouse.openMarketPosition(positionManager.address, POSITION_SIDE.LONG, toWeiBN('100'), 10)
            const positionInfo = await positionHouse.getPosition(positionManager.address, deployer.address) as unknown as PositionData;
            await expectHasLiquidity(500010, false)
            expect(positionInfo.quantity).eq(toWeiBN('100'))
            const orderDetail = await positionManager.getPendingOrderDetail(500010, 1)
            const {isFilled} = orderDetail
            expect(isFilled).eq(true)
            // @ts-ignore
            const tx = await positionHouse.remove(positionManager.address, cancelOrderId)
            console.log("gas used",(await tx.wait()).gasUsed.toString())
            for(const order of orders){
                await expectHasLiquidity(order.pip, false)
            }
            const {liquidity: liquidityAtFilledPipAfter} = await positionManager.tickPosition(500010)
            console.log("Liquidity left", liquidityAtFilledPipAfter.toString())
            expect(liquidityAtFilledPipAfter.toString()).eq('0')
        });
        it('should not remove partially filled order amount', async function () {
            await positionHouse.openMarketPosition(positionManager.address, POSITION_SIDE.LONG, toWeiBN('10'), 10)
            const positionInfo = await positionHouse.getPosition(positionManager.address, deployer.address) as unknown as PositionData;
            await expectHasLiquidity(500010, true)
            expect(positionInfo.quantity).eq(toWeiBN('10'))
            const orderDetail = await positionManager.getPendingOrderDetail(500010, 1)
            const {isFilled, partialFilled} = orderDetail
            expect(isFilled).eq(false)
            expect(partialFilled.toString()).eq(toWeiBN('10').toString())
            // @ts-ignore
            const tx = await positionHouse.remove(positionManager.address, cancelOrderId)
            console.log("gas used", (await tx.wait()).gasUsed.toString())
            for (const order of orders) {
                await expectHasLiquidity(order.pip, false)
            }
            const {liquidity: liquidityAtFilledPipAfter} = await positionManager.tickPosition(500010)
            expect(liquidityAtFilledPipAfter.toString()).eq('0')
        });
    });

    describe("mm market fill", async ()=>{


        async function setUpAndTest(orders) {
            const tx = await positionHouse.supply(positionManager.address, orders.map(parseOrder), 10)
            expect(tx.hash).not.to.be.eq(null)
            const receipt = await tx.wait()
            console.log(receipt)
            console.log("Gas: ", receipt.gasUsed.toString())
        }

        describe("revert", async ()=>{
            // max percent is 1% from init price is 50000

            it("should revert 1", async ()=>{


                await setUpAndTest([
                    {pip: 40000, quantity: 100},
                    {pip: 20000, quantity: 100},
                    {pip: 30000, quantity: 100},
                    {pip: 56000, quantity: -100},
                    {pip: 50001, quantity: -100},
                    {pip: 50002, quantity: -100},
                ])


                const marketFills =[
                    { quantity: ethers.utils.parseEther("100"), isBuy: true},
                    { quantity:  ethers.utils.parseEther("100"), isBuy : false}
                ]
                // const tx = await
               await expect(positionHouse.marketMakerFill(positionManager.address, marketFills, 10)).to.revertedWith("!MM")

            })

            it("should revert 2", async ()=>{



                await setUpAndTest([
                    {pip: 49600, quantity: 100},
                    {pip: 50600, quantity: -100}
                ])


                const marketFills =[
                    { quantity: ethers.utils.parseEther("100"), isBuy: true},
                    { quantity:  ethers.utils.parseEther("100"), isBuy : false}
                ]
                await expect(positionHouse.marketMakerFill(positionManager.address, marketFills, 10)).to.revertedWith("!MM")

            })
            it("should revert then success after update percent to 2%", async ()=>{


                await setUpAndTest([
                    {pip: 49600, quantity: 100},
                    {pip: 50600, quantity: -100}
                ])

                const marketFills =[
                    { quantity: ethers.utils.parseEther("100"), isBuy: true},
                    { quantity:  ethers.utils.parseEther("100"), isBuy : false}
                ]
                await expect(positionHouse.marketMakerFill(positionManager.address, marketFills, 10)).to.revertedWith("!MM")

                await positionManager.updateMaxPercentMarketMarket(BigNumber.from("20"))

                await expect(positionHouse.marketMakerFill(positionManager.address, marketFills, 10)).to.not.revertedWith("!MM")

            })

        })




        it("should successfully", async ()=>{

            it("should success 1%", async ()=>{



                await setUpAndTest([
                    {pip: 49800, quantity: 100},
                    {pip: 50100, quantity: -100}
                ])

                const marketFills =[
                    { quantity: ethers.utils.parseEther("100"), isBuy: true},
                    { quantity:  ethers.utils.parseEther("100"), isBuy : false}
                ]
                await expect(positionHouse.marketMakerFill(positionManager.address, marketFills, 10)).to.not.revertedWith("!MM")


            })

            it("should still success when change maxPercent to 2%", async ()=>{


                await setUpAndTest([
                    {pip: 49200, quantity: 100},

                    {pip: 49800, quantity: 100},

                    {pip: 50100, quantity: -100},
                    {pip: 40900, quantity: -100},

                ])


                const marketFills =[
                    { quantity: ethers.utils.parseEther("100"), isBuy: true},
                    { quantity:  ethers.utils.parseEther("100"), isBuy : false}
                ]
                await expect(positionHouse.marketMakerFill(positionManager.address, marketFills, 10)).to.not.revertedWith("!MM")

                await positionManager.updateMaxPercentMarketMarket(BigNumber.from("20"))

                await expect(positionHouse.marketMakerFill(positionManager.address, marketFills, 10)).to.not.revertedWith("!MM")



            })

        })


    })

});