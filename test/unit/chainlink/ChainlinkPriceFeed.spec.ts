const {expect, use} = require('chai')
const {ethers, waffle, web3, deployments} = require("hardhat")
const {ContractFactory, utils, BigNumber, Signer} = require('ethers');
const {waffleChai} = require('@ethereum-waffle/chai');
const {deployMockContract, provider, solidity} = waffle
const web3Utils = require('web3-utils')
// const {expectRevert} = require("@openzeppelin/test-helpers")

// import { default as BigNumber, default as BN } from "bn.js"

import {ChainLinkPriceFeed, MockAggregator} from "../../../typeChain";
import {Amm} from "../../../typeChain";
import {toWei, toWeiWithString, fromWeiWithString, fromWei, stringToBytes32, fromBytes32} from "../../shared/utilities";

const [deployer, sender2, sender3, sender4] = provider.getWallets()


describe("ChainlinkPriceFeed Spec", () => {
    const CHAINLINK_DECIMAL = 8;
    let priceFeed: ChainLinkPriceFeed;
    const EMPTY_ADDRESS = "0x0000000000000000000000000000000000000000";

    let eth = '0x143db3CEEfbdfe5631aDD3E50f7614B6ba708BA7';
    const btc = '0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf';
    const link = '0xca236E327F629f9Fc2c30A4E95775EbF0B89fac8';
    let mock: MockAggregator;


    beforeEach("before chain link", async () => {

        const initPrice = "2000000000000000000"


        const chainLink = await ethers.getContractFactory("ChainLinkPriceFeed");
        const chainLinkMock = await ethers.getContractFactory("MockAggregator");

        mock =( ((await chainLinkMock.deploy()) as unknown) as MockAggregator);
        console.log(mock.address)
        // eth = chainLinkMock1.address;


        priceFeed = ((await chainLink.connect(deployer).deploy()) as unknown) as ChainLinkPriceFeed;

    });
    it("getAggregator with existed aggregator key", async () => {
        console.log(stringToBytes32("ETH"))
        console.log(mock.address)
        await priceFeed.connect(deployer).addAggregator(stringToBytes32("ETH"), mock.address)
        expect(fromBytes32(await priceFeed.connect(sender2).priceFeedKeys(0))).eq("ETH")
        expect(await priceFeed.getAggregator(stringToBytes32("ETH"))).eq(mock.address)


        // let a = await priceFeed.connect(sender2).getPrice(stringToBytes32("ETH"));
        // console.log("here test", a);
        // expect(fromBytes32(await priceFeed.connect(sender2).priceFeedKeys(0))).eq("ETH")
        // expect(await priceFeed.getAggregator(stringToBytes32("ETH"))).eq(eth)
        // expect(await priceFeed.priceFeedDecimalMap(stringToBytes32("ETH"))).eq(8)
    })

    it("getAggregator with non-existed aggregator key", async () => {
        await priceFeed.addAggregator(stringToBytes32("ETH"), eth)
        expect(await priceFeed.getAggregator(stringToBytes32("BTC"))).eq(EMPTY_ADDRESS)
    })

    it("add multi aggregators", async () => {
        await priceFeed.addAggregator(stringToBytes32("ETH"), eth)
        await priceFeed.addAggregator(stringToBytes32("BTC"), btc)
        await priceFeed.addAggregator(stringToBytes32("LINK"), link)
        expect(fromBytes32(await priceFeed.priceFeedKeys(0))).eq("ETH")
        expect(await priceFeed.getAggregator(stringToBytes32("ETH"))).eq(eth)
        expect(fromBytes32(await priceFeed.priceFeedKeys(2))).eq("LINK")
        expect(await priceFeed.getAggregator(stringToBytes32("LINK"))).eq(link)
    })

    // describe("addAggregator", () => {
    //
    //
    //     // it("force error, addAggregator with zero address", async () => {
    //     //     await expectRevert(priceFeed.addAggregator(stringToBytes32("ETH"), EMPTY_ADDRESS), "empty address")
    //     // });
    // })

})
