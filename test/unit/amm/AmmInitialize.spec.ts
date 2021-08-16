import {set} from "husky";

const {expect, use} = require('chai')
const {ethers, waffle, web3} = require("hardhat");
const {ContractFactory, utils, BigNumber, Signer} = require('ethers');
const {waffleChai} = require('@ethereum-waffle/chai');
const {deployMockContract, provider, solidity} = waffle
const web3Utils = require('web3-utils')
// import { default as BigNumber, default as BN } from "bn.js"

import {PositionHouse} from "../../../typeChain";
import {Amm} from "../../../typeChain";
import {toWei, toWeiWithString, fromWeiWithString, fromWei} from "../../shared/utilities";

const [deployer, sender2, sender3, sender4] = provider.getWallets()


describe('Test Amm Initialize', () => {

    let positionHouse: PositionHouse;
    let amm: Amm;

    beforeEach('setup', async () => {
        const TestPositionHouse = await ethers.getContractFactory("contracts/protocol/position/PositionHouse.sol:PositionHouse");
        const TestAmm = await ethers.getContractFactory("Amm");

        positionHouse = (await TestPositionHouse.deploy() as unknown) as PositionHouse;
        amm = (await TestAmm.deploy() as unknown) as Amm;

    });

    it('should liquidity correct', async function () {
        await amm.initialize(
            // price =100000/ 100 = 1000
            //start price
            toWei(1000),
            // _quoteAssetReserve
            toWei(100000),
            // _baseAssetReserve
            toWei(100),
            //address quote asset
            '0x55d398326f99059ff775485246999027b3197955'
        );

        const liquidityDetail = await amm.testLiquidityInitialize();
        console.log(liquidityDetail);
    });


});
