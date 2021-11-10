// @ts-ignore
import {ethers, upgrades, hre} from "hardhat";
import {CreatePositionManagerInput, PositionManager, CreatePositionHouseInput, CreateInsuranceFund} from "./types";
import {DatastorePosition} from "./DataStore";

const Datastore = require('nedb-promises');

// import {Datastore} from 'nedb';


const POSITION_MANAGER = './positionManager.db';
const POSITION_HOUSE = './positionHouse.db';
const INSURANCE_FUND = './positionInsuranceFund.db';


//0x0353a27d26e4621740b47eff4dd315b5bf7afc15

export class ContractWrapperFactory {


    db = (new DatastorePosition()).db;


    constructor() {

    }

    async createPositionManager(args: CreatePositionManagerInput) {

        const key = `${args.priceFeedKey}_${args.quote}`;

        const PositionManager = await ethers.getContractFactory("PositionManager")
        let isContractExists = false;


        const dataPositionManager = (await this.db.find({symbol: `${args.quoteAsset.toLowerCase()}`}) as unknown) as PositionManager;

        const contractAddress = dataPositionManager.address;


        if (dataPositionManager !== undefined) {

            const upgraded = await upgrades.upgradeProxy(contractAddress, PositionManager);

            console.log(`Upgrade Position Manager ${key}`)

            await this.db.update({
                symbol: key
            }, {address: upgraded.address})


        } else {
            const contractArgs = [
                args.initialPrice,
                args.quoteAsset,
                ethers.utils.formatBytes32String(args.priceFeedKey),
                args.basisPoint,
                args.baseBasisPoint,
                args.tollRatio,
                args.maxFindingWordsIndex,
                args.fundingPeriod,
                args.priceFeed];

            //@ts-ignore
            const instance = await upgrades.deployProxy(PositionManager, contractArgs);
            console.log("wait for deploy")
            await instance.deployed();

            const address = instance.address.toString().toLowerCase();
            console.log(`${key} positionManager address : ${address}`)

            await this.db.insert({
                symbol: key,
                address: address
            })
        }
    }

    async createPositionHouse(args: CreatePositionHouseInput) {
        console.log(`into create PositionHouse`);
        const PositionHouse = await ethers.getContractFactory("PositionHouse")


        const positionHouse = await this.db.find({symbol: `PositionHouse}`});

        if (positionHouse !== undefined) {

            const upgraded = await upgrades.upgradeProxy(positionHouse.address, PositionHouse);

            await this.db.insert({
                symbol: `PositionHouse`,
                address: upgraded.address
            })
        } else {
            const contractArgs = [
                args.maintenanceMarginRatio,
                args.partialLiquidationRatio,
                args.liquidationFeeRatio,
                args.liquidationPenaltyRatio
            ];

            //@ts-ignore
            const instance = await upgrades.deployProxy(PositionHouse, contractArgs);
            console.log("wait for deploy")
            await instance.deployed();

            const address = instance.address.toString().toLowerCase();
            console.log(`PositionHouse address : ${address}`)

            await this.db.update({
                symbol: `PositionHouse`

            }, {address: address})

        }
    }

    async createInsuranceFund(args: CreateInsuranceFund) {


        const InsuranceFund = await ethers.getContractFactory("InsuranceFund");

        if (true) {
            // already stored in db
            // TODO upgrade contract

            // const upgraded = await upgrades.upgradeProxy('OLD ADDRESS', 'FACTORY');

        } else {
            // TODO deploy new contract

            const contractArgs = [];

            //@ts-ignore
            const instance = await upgrades.deployProxy(InsuranceFund, contractArgs);
            console.log("wait for deploy insurance fund");
            await instance.deployed();

            const address = instance.address.toString().toLowerCase();
            console.log(`InsuranceFund address : ${address}`)

            await this.db.update({
                symbol: `PositionHouse`

            }, {address: address})

        }


    }

}