import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import {PriceMathTest} from "../../typeChain";
import { expect } from '../shared/expect';
import snapshotGasCost from '../shared/snapshotGasCost'
import Decimal from 'decimal.js'

describe('PriceMath', () => {
    let priceMath: PriceMathTest

    before('deploy PriceMathTest', async () => {
        const factory = await ethers.getContractFactory('PriceMathTest')
        priceMath = (await factory.deploy()) as unknown as PriceMathTest
    })

    describe('get amount to target price', () => {
        it('throws invalid price', async () => {
            expect(await priceMath.getAmountToTargetPrice('0', '10000000000000000000000', '1000000')).to.be.revertedWith('Price can not be lower or equal zero')
        })

        it('throws invalid price', async () => {
            expect(await priceMath.getAmountToTargetPrice('10000000000000000000000', '0', '1000000')).to.be.revertedWith('Price can not be lower or equal zero')
        })

        it('calculated correctly from low to high price', async () => {
            expect(await priceMath.getAmountToTargetPrice('20000000000000000000', '18000000000000000000', '1000000000000000000000000')).to.eq('229495268000000000000000000000000')
        })

        it('calculated correctly from high to low price', async () => {
            expect(await priceMath.getAmountToTargetPrice('4242640687119284700', '4472135954999579600', '1000000')).to.eq('229495267880294900000000')
        })

        it('sqrt correctly', async () => {
            expect(await priceMath.sqrt('22260640000000000')).to.eq('149200000')
        })

        it('pow correctly', async () => {
            expect(await priceMath.pow('1000000000', '2')).to.eq('1000000000000000000')
        })

        it('abs correctly', async () => {
            expect(await priceMath.abs('-1000000000')).to.eq('1000000000')
        })
    })
})