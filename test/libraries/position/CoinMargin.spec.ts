import {expect} from 'chai';
import {ethers} from 'hardhat'
import {CoinMarginTest} from "../../../typeChain";
import {BigNumber} from "ethers";
import {BN} from "ethereumjs-util";
import {toWei} from "../../shared/utilities";

describe('CoinMarginTest', function () {
    let coinMarginTest: CoinMarginTest
    beforeEach('deploy coin margin test', async () => {
        const coinMarginLibraryFactory = await ethers.getContractFactory('CoinMargin');
        const coinMarginLibrary = await coinMarginLibraryFactory.deploy()
        const coinMarginTestFactory = await ethers.getContractFactory('CoinMarginTest', {
            libraries: {
                CoinMargin: coinMarginLibrary.address
            }
        })
        coinMarginTest = (await coinMarginTestFactory.deploy()) as CoinMarginTest
    })
    const baseBasisPoint = 10000

    describe('function test', async () => {
        it('should calculate notional correct', async () => {
            const notional = await coinMarginTest.calculateNotional(BigNumber.from(20000*baseBasisPoint), BigNumber.from(toWei(10*100)), BigNumber.from(baseBasisPoint))
            await expect(notional).eq(BigNumber.from('50000000000000000'))
        })
    })
})