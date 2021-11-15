import {CreatePositionManagerInput, PositionManager, CreatePositionHouseInput, CreateInsuranceFund} from "./types";
import {DeployDataStore} from "./DataStore";
import {verifyContract} from "../scripts/utils";
import {TransactionResponse} from "@ethersproject/abstract-provider";
import {HardhatRuntimeEnvironment} from "hardhat/types";


export class ContractWrapperFactory {

    constructor(readonly db: DeployDataStore, readonly hre: HardhatRuntimeEnvironment) {
    }

    async verifyImplContract(deployTransaction: TransactionResponse) {
        const {data} = deployTransaction
        const decodedData = this.hre.ethers.utils.defaultAbiCoder.decode(
            ['address', 'address'],
            this.hre.ethers.utils.hexDataSlice(data, 4)
        );
        const implContractAddress = decodedData[1]
        const isVerified = await this.db.findAddressByKey(`${implContractAddress}:verified`)
        if (isVerified) return console.log(`Implement contract already verified`)
        console.log("Upgraded to impl contract", implContractAddress)
        try {
            await verifyContract(this.hre, implContractAddress)
            await this.db.saveAddressByKey(`${implContractAddress}:verified`, 'yes')
        } catch (err) {
            if (err.message == 'Contract source code already verified') {
                await this.db.saveAddressByKey(`${implContractAddress}:verified`, 'yes')
            }
            console.error(`-- verify contract error`, err)
        }
    }

    async createPositionManager(args: CreatePositionManagerInput) {

        const symbol = `${args.priceFeedKey}_${args.quote}`;
        const saveKey = `PositionManager:${symbol}`

        const PositionManager = await this.hre.ethers.getContractFactory("PositionManager")
        const contractAddress = await this.db.findAddressByKey(saveKey);
        console.log("contractAddress", contractAddress)
        if (contractAddress) {
            const upgraded = await this.hre.upgrades.upgradeProxy(contractAddress, PositionManager);
            console.log(`Starting verify upgrade Position Manager ${symbol}`)
            await this.verifyImplContract(upgraded.deployTransaction)
            console.log(`Upgrade Position Manager ${symbol}`)
        } else {
            const contractArgs = [
                args.initialPrice,
                args.quoteAsset,
                this.hre.ethers.utils.formatBytes32String(args.priceFeedKey),
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
            console.log(`${symbol} positionManager address : ${address}`)
            // console.log(`Starting verify Position Manager ${symbol}`);
            // await this.verifyImplContract(instance.deployTransaction);
            await this.db.saveAddressByKey(saveKey, address);
        }
    }

    async createPositionHouse(args: CreatePositionHouseInput) {
        console.log(`into create PositionHouse`);
        const PositionHouse = await this.hre.ethers.getContractFactory("PositionHouse")
        const positionHouseContractAddress = await this.db.findAddressByKey(`PositionHouse`);

        if (positionHouseContractAddress) {
            console.log('Start upgrade position house')
            const upgraded = await this.hre.upgrades.upgradeProxy(positionHouseContractAddress, PositionHouse);
            console.log('Starting verify upgrade PositionHouse');
            await this.verifyImplContract(upgraded.deployTransaction);

        } else {
            const contractArgs = [
                args.maintenanceMarginRatio,
                args.partialLiquidationRatio,
                args.liquidationFeeRatio,
                args.liquidationPenaltyRatio,
                args.insuranceFund,
                args.feePool
            ];

            //@ts-ignore
            const instance = await upgrades.deployProxy(PositionHouse, contractArgs);
            console.log("wait for deploy")
            await instance.deployed();

            const address = instance.address.toString().toLowerCase();
            console.log(`PositionHouse address : ${address}`)
            // console.log('Starting verify PositionHouse');
            // await this.verifyImplContract(instance.deployTransaction);
            await this.db.saveAddressByKey('PositionHouse', address);
        }
    }

    async createInsuranceFund(args: CreateInsuranceFund) {
        const InsuranceFund = await this.hre.ethers.getContractFactory("InsuranceFund");
        const insuranceFundContractAddress = await this.db.findAddressByKey(`InsuranceFund`);
        if (insuranceFundContractAddress) {
            const upgraded = await this.hre.upgrades.upgradeProxy(insuranceFundContractAddress, InsuranceFund);
            await this.verifyImplContract(upgraded.deployTransaction);
        } else {
            const contractArgs = [];
            const instance = await this.hre.upgrades.deployProxy(InsuranceFund, contractArgs);
            console.log("wait for deploy insurance fund");
            await instance.deployed();
            // console.log(instance.deployTransaction)
            const address = instance.address.toString().toLowerCase();
            console.log(`InsuranceFund address : ${address}`)
            // console.log('Starting verify Insurance Fund');
            // await this.verifyImplContract(instance.deployTransaction);
            await this.db.saveAddressByKey('InsuranceFund', address);

        }

    }

}