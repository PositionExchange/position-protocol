import {PositionBUSDBonus} from "../../typeChain";
import { ethers } from "hardhat";
import { BigNumber, Signer } from "ethers";
import {expect, use} from "chai"

describe("Position BUSD Bonus", function () {
    let creditToken: PositionBUSDBonus;
    let deployer : any;
    let trader1  : any;
    let trader2  : any;
    let minter   : any;
    let transferable : any;

    beforeEach(async function () {
        [deployer, trader1, trader2, transferable, minter] = await ethers.getSigners()
        const creditTokenFactory = await ethers.getContractFactory("PositionBUSDBonus")
        creditToken = (await creditTokenFactory.deploy("Position BUSD Bonus","PBUSD")) as unknown as PositionBUSDBonus
        await creditToken.updateTransferableAddress(transferable.getAddress(),true)
    });

    it("should deploy success", async function () {
        expect(creditToken.address).to.not.equal(ethers.constants.AddressZero)
        expect(creditToken.address).to.not.equal(undefined)
        expect(await creditToken.name()).equal("Position BUSD Bonus")
        expect(await creditToken.symbol()).equal("PBUSD")
        expect(await creditToken.owner()).equal(deployer.address)
        expect(await creditToken.isMintableAddress(deployer.address)).equal(true)
        expect(await creditToken.isTransferableAddress(transferable.address)).equal(true)
        expect(await creditToken.isMintableAddress(trader1.address)).equal(false)
        expect(await creditToken.isTransferableAddress(trader1.address)).equal(false)
    })

    it("should mint success", async function () {
        await creditToken.updateMintableAddress(minter.getAddress(),true)
        await creditToken.connect(minter).mint(trader1.getAddress(),BigNumber.from("1000"))
        expect(await creditToken.balanceOf(trader1.address)).equal(1000)
    })

    it("sender is not in whitelist, should not mint success", async function () {
        await creditToken.updateMintableAddress(minter.getAddress(),false)
        expect(creditToken.connect(minter).mint(trader1.getAddress(),BigNumber.from("1000"))).to.be.revertedWith('Only Mintable Address')

    })

    it("transfer from trader to trader,should not success", async function () {
        await creditToken.connect(deployer).mint(trader1.getAddress(),BigNumber.from("1000"))
        expect(creditToken.connect(trader1).transfer(trader2.getAddress(),BigNumber.from("1000"))).to.be.revertedWith('Only Transferable Address')
        expect(await creditToken.balanceOf(trader1.address)).equal(1000)
        expect(await creditToken.balanceOf(trader2.address)).equal(0)
    })

    it("insurance fund transfer from insurance fund to trader,should success", async function () {
        await creditToken.connect(deployer).mint(transferable.getAddress(),BigNumber.from("1000"))
        expect(await creditToken.balanceOf(transferable.address)).equal(1000)
        expect(await creditToken.balanceOf(trader1.address)).equal( 0)
        await creditToken.connect(transferable).transfer(trader1.getAddress(),BigNumber.from("400"))
        expect(await creditToken.balanceOf(transferable.address)).equal( 600)
        expect(await creditToken.balanceOf(trader1.address)).equal(400)
    })

    it("insurance fund transfer from trader to insurance fund,should success", async function () {
        await creditToken.connect(deployer).mint(trader1.getAddress(),BigNumber.from("1000"))
        expect(await creditToken.balanceOf(trader1.address)).equal(1000)
        await creditToken.connect(transferable).transferFrom(trader1.getAddress(),transferable.address,BigNumber.from("400"))
        expect(await creditToken.balanceOf(trader1.address)).equal( 600)
        expect(await creditToken.balanceOf(transferable.address)).equal(400)
    })

    it("trader transfer from insurance fund to trader,should not success", async function () {
        await creditToken.connect(deployer).mint(trader1.getAddress(),BigNumber.from("1000"))
        expect(creditToken.connect(trader1).transfer(transferable.getAddress(),BigNumber.from("1000"))).to.be.revertedWith('Only Transferable Address')
    })

    it("trader transfer from trader to insurance fund,should not success", async function () {
        await creditToken.connect(deployer).mint(trader1.getAddress(),BigNumber.from("1000"))
        expect(creditToken.connect(trader1).transferFrom(trader1.getAddress(), transferable.address,BigNumber.from("1000"))).to.be.revertedWith('Only Transferable Address')
    })
 });