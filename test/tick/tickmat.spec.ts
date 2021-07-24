
import {TickMathTest} from "../typechain/Tick"
const {expect, use} = require('chai')
const {ethers, waffle, web3} = require("hardhat")


describe('TickMath', function () {

    // let tickTest: TickMa

    beforeEach('deploy TickTest', async () => {
        const tickTestFactory = await ethers.getContractFactory('TickMath')
        // tickTest = (await tickTestFactory.deploy()) as TickTest
    })

    it('should tick', function () {

        
    });


});