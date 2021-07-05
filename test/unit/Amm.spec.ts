import { default as BigNumber, default as BN } from "bn.js";
import {expect, use } from "chai";
import {ethers, waffle, web3} from 'hardhat';
import web3Utils from 'web3-utils';
const {provider, deployMockContract} = waffle

const BUY = 1, SELL = 0
// x:  BTC
// y : USDT

const toWei = (n: number) => web3Utils.toWei(n.toString())
const fromWei = (n: number) => web3Utils.fromWei(n.toString())

describe('Test Amm', () => {
    let ammContract;
    const [account0, account1, account2] = provider.getWallets();
    it('should open limit order success', async () => {
       // current price is 100 with x = 10, y = 1000
       // Liquidity L = 100
       const currentPrice = toWei(100);
       //price buy limit
       const price = toWei(96);
       const size = toWei(1);
       // A opens limit order at price 96
       // openLimitOrder([side], [price], [size]) : orderID<Uint>
        const orderId = await ammContract.connect(account1).openLimitOrder(BUY, price, size);
        // expect state is set
        // Person B opens market sell of 0.5 BTC
         // 100 -> 96 = 0.206 BTC
        await ammContract.connect(account2).openMarketOrder(SELL, toWei(0.5))
        // expect price drops to 96 with x BTC
        // person A gets partial fill with y BTC
        const {remainingAmount, } = await ammContract.queryOrder(orderId)
        expect(remainingAmount).to.be(toWei(1-(0.5-0.206)).toString())
   });
})
