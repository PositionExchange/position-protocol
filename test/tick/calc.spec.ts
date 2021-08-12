import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { CalcTest } from '../../typeChain';
import { expect } from "../shared/expect";
import snapshotGasCost from "../shared/snapshotGasCost";
import Decimal from 'decimal.js'

// const { expect, use } = require('chai');
// const { ethers, waffle, web3 } = require("hardhat");
// const { ContractFactory, utils, BigNumber, Signer } = require('ethers');
// const { waffleChai } = require('@ethereum-waffle/chai');
// const { deployMockContract, provider, solidity } = waffle
// const web3Utils = require('web3-utils')
//
// use(solidity)
// const [deployer, sender2, sender3, sender]

describe('Test Calc', () => {
    let calc : CalcTest;

    // const [account0, account1, account2] = provider.getWallets();

    before('deploy CalcTest', async () => {
        const factory = await ethers.getContractFactory('CalcTest')
        // calc = (await factory.deploy()) as unknown as CalcTest
    })

    describe('')

})