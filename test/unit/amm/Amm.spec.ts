import {set} from "husky";

const {expect, use} = require('chai')
const {ethers, waffle, web3} = require("hardhat");
const {ContractFactory, utils, BigNumber, Signer} = require('ethers');
const {waffleChai} = require('@ethereum-waffle/chai');
const {deployMockContract, provider, solidity} = waffle
const web3Utils = require('web3-utils')

import {toWei, toWeiWithString, fromWeiWithString, fromWei} from "../../shared/utilities";
// import { default as BigNumber, default as BN } from "bn.js"


use(solidity)
const [deployer, sender2, sender3, sender4] = provider.getWallets()

const bn2String = (bn: any) => fromWei((bn).toString())

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const BUY = 1, SELL = 0
// x:  BTC
// y : USDT


describe('Test Amm', () => {

    let ammContract;
    const [account0, account1, account2] = provider.getWallets();

    async function setup() {

        const TestPositionHouse = await ethers.getContractFactory("contracts/protocol/position/PositionHouse.sol:PositionHouse");
        const TestAmm = await ethers.getContractFactory("Amm");

        const contractPositionHouse = await TestPositionHouse.deploy();
        const contractAmm = await TestAmm.deploy();

        const addressAmm = contractAmm.address;

        await contractAmm.initialize(
            // price =100000/ 100 = 1000
            //start price
            toWei(100000/100),
            // _quoteAssetReserve
            toWei(100000),
            // _baseAssetReserve
            toWei(100),
            //address quote asset
            '0x55d398326f99059ff775485246999027b3197955'
        );
        const a = await contractAmm.testTickInitialize();
        console.log("Tick initial", a.toString())


        return {
            contractAmm,
            addressAmm,
            contractPositionHouse,

        }
    }

    it('should open limit short correct and cancel with 1 account', async () => {

        const setupData = await setup();

        await setupData.contractPositionHouse.connect(account0).openLimitOrder(
            // Iamm
            setupData.addressAmm,
            // amount base
            toWei(0.95),
            //amount quote
            toWei(1010),
            //limit price
            toWei(1010/0.95),
            //side
            1,
            //
            69693,
            toWei(1)
        );
        const positions1 = await setupData.contractPositionHouse.connect(account0).queryOrder(
            setupData.addressAmm
        );

        // expect length position
        expect(((positions1 as unknown) as Array<any>).length).to.equal(1);


        const tick1 = positions1[0].tick.toString();
        const index1 = positions1[0].index.toString();

        console.log(index1)

        await setupData.contractPositionHouse.connect(account0)
            .cancelOrder(setupData.addressAmm, index1, tick1)

        const positions2 = await setupData.contractPositionHouse.connect(account0).queryOrder(
            setupData.addressAmm
        );

        // expect length position
        expect(((positions2 as unknown) as Array<any>).length).to.equal(0);


    });

    it('should open long limit  correct and cancel with 1 account', async () => {

        const setupData = await setup();

        await setupData.contractPositionHouse.connect(account0).openLimitOrder(
            // Iamm
            setupData.addressAmm,
            // amount base
            toWei(10),
            //amount quote
            toWei(990),
            //limit price
            toWei(99),
            //side
            0,
            //
            45953,
            toWei(1)
        );
        const positions1 = await setupData.contractPositionHouse.connect(account0).queryOrder(
            setupData.addressAmm
        );

        // expect length position
        expect(((positions1 as unknown) as Array<any>).length).to.equal(1);


        const tick1 = positions1[0].tick.toString();
        const index1 = positions1[0].index.toString();

        console.log(index1)

        await setupData.contractPositionHouse.connect(account0)
            .cancelOrder(setupData.addressAmm, index1, tick1)

        const positions2 = await setupData.contractPositionHouse.connect(account0).queryOrder(
            setupData.addressAmm
        );

        // expect length position
        expect(((positions2 as unknown) as Array<any>).length).to.equal(0);


    });

    it('should open limit long correct amount number with 1 account', async () => {

        const setupData = await setup();

        await setupData.contractPositionHouse.connect(account0).openLimitOrder(
            setupData.addressAmm,
            toWei(10),
            toWei(990),
            toWei(99),
            0,
            toWei(45953),
            toWei(1)
        );
        const positions1 = await setupData.contractPositionHouse.connect(account0).queryOrder(
            setupData.addressAmm
        );

        // expect length position
        expect(((positions1 as unknown) as Array<any>).length).to.equal(1);


        const tick1 = positions1[0].tick.toString();
        const index1 = positions1[0].index.toString();

        const order1 = await setupData.contractPositionHouse.connect(account0)
            .getOrder(setupData.addressAmm, tick1, index1)

        expect(fromWeiWithString(order1.leverage.toString())).to.equal("1");


        await setupData.contractPositionHouse.connect(account0).openLimitOrder(
            setupData.addressAmm,
            toWei(100),
            toWei(9900),
            toWei(990),
            1,
            toWei(68980),
            toWei(2)
        )

        const positions2 = await setupData.contractPositionHouse.connect(account0).queryOrder(
            setupData.addressAmm
        );
        expect(((positions2 as unknown) as Array<any>).length).to.equal(2);


        const tick2 = positions2[1].tick.toString();
        console.log(tick2)
        const index2 = positions2[1].index.toString();
        console.log(index2)

        const order2 = await setupData.contractPositionHouse.connect(account0)
            .getOrder(setupData.addressAmm, tick2, index2)


        expect(fromWeiWithString(order2.leverage.toString())).to.equal("2");


        // console.log(positions[0].tick.toString(), "  ", positions[0].index.toString())


        // setupData.contractAmm.
        //
        // // current price is 100 with x = 10, y = 1000
        // // Liquidity L = 100
        // const currentPrice = toWei(100);
        // //price buy limit
        // const price = toWei(96);
        // const size = toWei(1);
        // // A opens limit order at price 96
        // // openLimitOrder([side], [price], [size]) : orderID<Uint>
        //  const orderId = await ammContract.connect(account1).openLimitOrder(BUY, price, size);
        //  // expect state is set
        //  // Person B opens market sell of 0.5 BTC
        //   // 100 -> 96 = 0.206 BTC
        //  await ammContract.connect(account2).openMarketOrder(SELL, toWei(0.5))
        //  // expect price drops to 96 with x BTC
        //  // person A gets partial fill with y BTC
        //  const {remainingAmount, } = await ammContract.queryOrder(orderId);
        //  expect(remainingAmount).to.be(toWei(1-(0.5-0.206)).toString());

    });

    it('should open limit long correct with multi people', async () => {

        const setupData = await setup();

        // account 0
        await setupData.contractPositionHouse.connect(account0).openLimitOrder(
            setupData.addressAmm,
            toWei(10),
            toWei(990),
            toWei(99),
            0,
            toWei(45953),
            toWei(1)
        );
        const positions1 = await setupData.contractPositionHouse.connect(account0).queryOrder(
            setupData.addressAmm
        );

        // expect length position
        expect(((positions1 as unknown) as Array<any>).length).to.equal(1);


        const tick1 = positions1[0].tick.toString();
        const index1 = positions1[0].index.toString();

        const order1 = await setupData.contractPositionHouse.connect(account0)
            .getOrder(setupData.addressAmm, tick1, index1)

        expect(fromWeiWithString(order1.leverage.toString())).to.equal("1");


        // account1
        await setupData.contractPositionHouse.connect(account1).openLimitOrder(
            setupData.addressAmm,
            toWei(100),
            toWei(9990),
            toWei(99.9),
            1,
            toWei(46043),
            toWei(2)
        )

        const positions2 = await setupData.contractPositionHouse.connect(account1).queryOrder(
            setupData.addressAmm
        );
        expect(((positions2 as unknown) as Array<any>).length).to.equal(1);

        // console.log(positions2)


        const tick2 = positions2[0].tick.toString();
        console.log(tick2)
        const index2 = positions2[0].index.toString();
        console.log(index2)

        const order2 = await setupData.contractPositionHouse.connect(account1)
            .getOrder(setupData.addressAmm, tick2, index2)


        expect(fromWeiWithString(order2.leverage.toString())).to.equal("2");

        // account 0
        await setupData.contractPositionHouse.connect(account0).openLimitOrder(
            setupData.addressAmm,
            toWei(100),
            toWei(9950),
            toWei(99.5),
            1,
            toWei(46003),
            toWei(2)
        )

        const positions3 = await setupData.contractPositionHouse.connect(account0).queryOrder(
            setupData.addressAmm
        );
        expect(((positions3 as unknown) as Array<any>).length).to.equal(2);


        const tick3 = positions3[1].tick.toString();
        const index3 = positions3[1].index.toString();
        const order3 = await setupData.contractPositionHouse.connect(account0)
            .getOrder(setupData.addressAmm, tick3, index3)
        expect(fromWeiWithString(order3.leverage.toString())).to.equal("2");


    });
})
