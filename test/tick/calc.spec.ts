import {BigNumber} from 'ethers'
import {ethers} from 'hardhat'
// import { CalcTest } from '../../contracts/test/CalcTest.sol';
import {expect} from "../shared/expect";
import snapshotGasCost from "../shared/snapshotGasCost";
import Decimal from 'decimal.js'
import {toWei} from "../shared/utilities";

import {CalcTest} from "../../typeChain";

describe('Calc test', () => {

    let calc: CalcTest;


    beforeEach("setup", async () => {

        const TestCalcTest = await ethers.getContractFactory("contracts/test/CalcTest.sol:CalcTest");

        calc = (await TestCalcTest.deploy() as unknown) as CalcTest;


    })

    it('should sqrt', async function () {

        const c = toWei(100);
        console.log(c);

        const a = await calc.sqrt_new(toWei(100));
        console.log(a.toString())

        const b = await calc.sqrt_new(toWei(2));
        console.log(b.toString())

    });

})