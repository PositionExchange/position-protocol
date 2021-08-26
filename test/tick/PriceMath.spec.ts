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

    describe('get quote amount to target price', () => {
        it('throws invalid price', async () => {
            expect(await priceMath.getQuoteAmountToTargetPrice('0', '10000000000000000000000', '1000000')).to.be.revertedWith('Price can not be lower or equal zero')
        })

        it('throws invalid price', async () => {
            expect(await priceMath.getQuoteAmountToTargetPrice('10000000000000000000000', '0', '1000000')).to.be.revertedWith('Price can not be lower or equal zero')
        })

        it('calculated correctly from low to high price', async () => {
            expect(await priceMath.getQuoteAmountToTargetPrice('20000000000000000000', '18000000000000000000', '1000000000000000000000000')).to.eq('229495268000000000000000000000000')
        })

        it('calculated correctly from high to low price', async () => {
            expect(await priceMath.getQuoteAmountToTargetPrice('978436322384533167861', '1000000000000000000000', '10000000000000000000000000000000000000000000')).to.eq('1084059813395085700000')
        })

    })

    describe('get base amount to target price', () => {
        it('throws invalid price', async () => {
            expect(await priceMath.getBaseAmountToTargetPrice('0', '10000000000000000000000', '1000000')).to.be.revertedWith('Price can not be lower or equal zero')
        })

        it('calculated correct price', async () => {
            expect(await priceMath.getBaseAmountToTargetPrice('978436322384533167861', '1000000000000000000000', '10000000000000000000000000000000000000000000')).to.eq('12312312313232123')
        })
    })

    describe('get next price from input', () => {
        it('calculate next price from input', async () => {
            expect(await priceMath.getNextPriceFromInput('1000000000000000000000','5000000000000000000000', false, '10000000000000000000000000000000000000000000')).to.eq('1000000000000000000008')
        })
    })
})