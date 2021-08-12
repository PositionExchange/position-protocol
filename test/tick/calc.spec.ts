import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
// import { CalcTest } from '../../contracts/test/CalcTest.sol';
import { expect } from "../shared/expect";
import snapshotGasCost from "../shared/snapshotGasCost";
import Decimal from 'decimal.js'
import {toWei} from "../shared/utilities";

describe('Calc', () => {


    async function setup() {

        const TestCalcTest = await ethers.getContractFactory("contracts/test/CalcTest.sol:CalcTest");

        const contactTestCalcTest = await TestCalcTest.deploy();


        return {
            contactTestCalcTest,

        }
    }

    it('should sqrt', async  function () {
        const setUp = await setup();

        const a  = await setUp.contactTestCalcTest.sqrt_new(toWei(100) );
        console.log(a.toString())

        const b  = await setUp.contactTestCalcTest.sqrt_new(toWei(2));
        console.log(b.toString())

    });

})