import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {PositionHouse, PositionManager} from "../../typeChain";
import {ethers, waffle} from "hardhat";
import {deployPositionHouse} from "../shared/deploy";
import {use, expect} from "chai";
import {OrderSide, POSITION_SIDE, PositionData} from "../shared/utilities";
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

    });

});