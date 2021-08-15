// import { BigNumber } from 'ethers'
// import { ethers } from 'hardhat'
// import { expect } from "../shared/expect";
// import snapshotGasCost from "../shared/snapshotGasCost";
// import Decimal from 'decimal.js'
// import {toWei} from "../shared/utilities";

import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import {CalcTest} from "../../typeChain";
import { expect } from '../shared/expect';
import snapshotGasCost from '../shared/snapshotGasCost'
import Decimal from 'decimal.js'

describe('Calc', () => {

    let calcMath: CalcTest

    before('deploy CalcTest', async () => {
        const factory = await ethers.getContractFactory('CalcTest')
        calcMath = (await factory.deploy()) as unknown as CalcTest
    })

    describe('calculate correctly', () => {

        it('sqrt correctly', async () => {
            expect(await calcMath.sqrt('40000000000000000000000')).to.eq('4472135954')
        })

        it('new sqrt correctly', async () => {
            expect(await calcMath.sqrt_new('40000000000000000000000')).to.eq('4472135954')
        })

        it('pow correctly', async () => {
            expect(await calcMath.pow('2', '96')).to.eq('79228162514264337593543950336')
        })

        it('abs correctly', async () => {
            expect(await calcMath.abs('-1000000000')).to.eq('1000000000')
        })
    })










    // async function setup() {
    //
    //     const TestCalcTest = await ethers.getContractFactory("contracts/test/CalcTest.sol:CalcTest");
    //
    //     const contactTestCalcTest = await TestCalcTest.deploy();
    //
    //
    //     return {
    //         contactTestCalcTest,
    //
    //     }
    // }
    //
    // it('should sqrt', async  function () {
    //     const setUp = await setup();
    //
    //     const a  = await setUp.contactTestCalcTest.sqrt_new(toWei(100) );
    //     console.log(a.toString())
    //
    //     const b  = await setUp.contactTestCalcTest.sqrt_new(toWei(2));
    //     console.log(b.toString())
    //
    // });

})