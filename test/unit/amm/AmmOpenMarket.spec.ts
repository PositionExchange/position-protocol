import {set} from "husky";

const {expect, use} = require('chai')
const {ethers, waffle, web3} = require("hardhat");
const {ContractFactory, utils, BigNumber, Signer} = require('ethers');
const {waffleChai} = require('@ethereum-waffle/chai');
const {deployMockContract, provider, solidity} = waffle
const web3Utils = require('web3-utils')

import {toWei, toWeiWithString, fromWeiWithString, fromWei} from "../../shared/utilities";
import {Amm, PositionHouse} from "../../../typeChain";
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

    const [account0, account1, account2] = provider.getWallets();

    let positionHouse: PositionHouse;
    let amm: Amm;
    let addressAmm: string;

    beforeEach('setup', async () => {
        const TestPositionHouse = await ethers.getContractFactory("contracts/protocol/position/PositionHouse.sol:PositionHouse");
        const TestAmm = await ethers.getContractFactory("Amm");

        positionHouse = (await TestPositionHouse.deploy() as unknown) as PositionHouse;
        amm = (await TestAmm.deploy() as unknown) as Amm;
        await amm.initialize(
            // price =100000/ 100 = 1000
            //start price
            toWei(100000 / 100),
            // _quoteAssetReserve
            toWei(100000),
            // _baseAssetReserve
            toWei(100),
            //address quote asset
            '0x55d398326f99059ff775485246999027b3197955'
        );
        const a = await amm.testTickInitialize();
        console.log("Tick initial", a.toString())


        addressAmm = amm.address;

    });


    it('should open long limit correct and filled with 1 account', async () => {


        await positionHouse.connect(account0).openLimitOrder(
            // Iamm
            addressAmm,
            // amount base
            toWei(0.001),
            //amount quote
            toWei(1000),
            //limit price
            toWei(1050),
            //side
            1,
            //
            69569,
            toWei(1)
        );

        await positionHouse.connect(account0).openLimitOrder(
            // Iamm
            addressAmm,
            // amount base
            toWei(0.002),
            //amount quote
            toWei(2000),
            //limit price
            toWei(1070),
            //side
            1,
            //
            69758,
            toWei(1)
        );

        await positionHouse.connect(account1).openPosition(
            addressAmm,
            0,
            toWei(5000),
            toWei(50),
            10
        );


    });


})
