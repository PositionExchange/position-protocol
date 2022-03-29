import {
    CreatePositionManagerInput,
    // PositionManager,
    CreatePositionHouseInput,
    CreateInsuranceFund,
    CreatePositionHouseFunction, CreateChainLinkPriceFeed
} from "./types";
import {PositionManager, PositionHouse, ChainLinkPriceFeed, BEP20Mintable, InsuranceFund} from "../typeChain";
import {DeployDataStore} from "./DataStore";
import {verifyContract} from "../scripts/utils";
import {TransactionResponse} from "@ethersproject/abstract-provider";
import {HardhatRuntimeEnvironment} from "hardhat/types";


export class ContractWrapperFactoryQC {


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
        // let deployTx: PositionManager;
        const symbol = `${args.priceFeedKey}_${args.quote}`;
        const saveKey = `PositionManager:${symbol}`

        const positionManagerFactory = await this.hre.ethers.getContractFactory("PositionManager")
        const contractAddress = await this.db.findAddressByKey(saveKey);
        console.log("contractAddress", contractAddress)

        if (contractAddress) {
            console.log(`Starting verify Position Manager ${symbol}`)
            await verifyContract(this.hre, contractAddress)
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
                args.priceFeed,
                args.counterParty
            ];
            const deployTx = (await positionManagerFactory.deploy()) as unknown as PositionManager
            await deployTx.deployTransaction.wait(1)
            console.log("wait for deploy")
            console.log(`${symbol} positionManager address : ${deployTx.address}`)
            console.log(`Starting verify Position Manager ${symbol}`);
            // @ts-ignore
            await deployTx.initialize(...contractArgs)
            await verifyContract(this.hre, deployTx.address)


            console.log("initialized")
            await this.db.saveAddressByKey(`${deployTx.address}:verified`, 'yes')
            await this.db.saveAddressByKey(saveKey, deployTx.address);
        }
    }

    async createPositionHouse(args: CreatePositionHouseInput) {
        let positionHouse: PositionHouse;
        console.log(`into create PositionHouse`);
        const positionHouseFunctionContractAddress = await this.db.findAddressByKey(`PositionHouseFunction`);
        console.log(`positionHouseFunctionContractAddress ${positionHouseFunctionContractAddress}`);

        const positionHouseMathContractAddress = await this.db.findAddressByKey(`PositionHouseMath`);
        console.log(`positionHouseMathContractAddress ${positionHouseMathContractAddress}`);

        const positionHouseFactory = await this.hre.ethers.getContractFactory("PositionHouse", {
            libraries: {
                PositionHouseFunction: positionHouseFunctionContractAddress,
                PositionHouseMath: positionHouseMathContractAddress
            }
        })
        const positionHouseContractAddress = await this.db.findAddressByKey(`PositionHouse`);

        if (positionHouseContractAddress) {
            console.log('Starting verify PositionHouse');
            await verifyContract(this.hre, positionHouseContractAddress)
        } else {
            const contractArgs = [
                args.maintenanceMarginRatio,
                args.partialLiquidationRatio,
                args.liquidationFeeRatio,
                args.liquidationPenaltyRatio,
                args.insuranceFund,
                // args.feePool
            ];

            //@ts-ignore
            const deployTx = (await positionHouseFactory.deploy()) as unknown as PositionHouse
            await deployTx.deployTransaction.wait(1)
            console.log("wait for deploy")

            await verifyContract(this.hre, deployTx.address)
            // @ts-ignore
            await deployTx.initialize(...contractArgs)
            await this.db.saveAddressByKey(`${deployTx.address}:verified`, 'yes')
            await this.db.saveAddressByKey('PositionHouse', deployTx.address);
        }
    }

    async createInsuranceFund(args: CreateInsuranceFund) {
        let insuranceFund: InsuranceFund
        const insuranceFundFactory = await this.hre.ethers.getContractFactory("InsuranceFund");
        const insuranceFundContractAddress = await this.db.findAddressByKey(`InsuranceFund`);
        if (insuranceFundContractAddress) {
            console.log(`Starting verify Insurance Fund`)
            await verifyContract(this.hre, insuranceFundContractAddress)
        } else {
            const deployTx = (await insuranceFundFactory.deploy()) as unknown as InsuranceFund
            await deployTx.deployTransaction.wait(1)

            console.log("wait for deploy insurance fund");
            console.log(`InsuranceFund address : ${deployTx.address}`)
            console.log(`Starting verify Insurance Fund`);
            await verifyContract(this.hre, deployTx.address)
            await deployTx.initialize()
            await this.db.saveAddressByKey(`${deployTx.address}:verified`, 'yes')
            await this.db.saveAddressByKey('InsuranceFund', deployTx.address);

        }

    }

    async createPositionHouseFunctionLibrary(args: CreatePositionHouseFunction) {
        const PositionHouseFunction = await this.hre.ethers.getContractFactory("PositionHouseFunction");
        const positionHouseFunctionContractAddress = await this.db.findAddressByKey(`PositionHouseFunction`);

        if (!positionHouseFunctionContractAddress) {
            const deployTx = await PositionHouseFunction.deploy();
            await deployTx.deployTransaction.wait(1)
            console.log("wait for deploy position house function fund");
            await this.db.saveAddressByKey('PositionHouseFunction', deployTx.address.toLowerCase());
        }
    }

    async createPositionHouseMathLibrary(args: CreatePositionHouseFunction) {
        const PositionHouseMath = await this.hre.ethers.getContractFactory("PositionHouseMath");
        const positionHouseMathContractAddress = await this.db.findAddressByKey(`PositionHouseMath`);


        if (!positionHouseMathContractAddress) {
            const deployTx = await PositionHouseMath.deploy();
            await deployTx.deployTransaction.wait(1)
            console.log("wait for deploy position house math fund");
            await this.db.saveAddressByKey('PositionHouseMath', deployTx.address.toLowerCase());
        }
    }

    async createChainlinkPriceFeed( args: CreateChainLinkPriceFeed){
        const ChainLinkPriceFeed = await this.hre.ethers.getContractFactory("ChainLinkPriceFeed");
        const chainlinkContractAddress = await this.db.findAddressByKey(`ChainLinkPriceFeed`);
        if (chainlinkContractAddress) {
            await verifyContract(this.hre, chainlinkContractAddress)
        } else {
            const contractArgs = [];
            const deployTx = await ChainLinkPriceFeed.deploy();
            await deployTx.deployTransaction.wait(1)
            console.log("wait for deploy position house math fund");
            console.log(`Chain link price feed address : ${deployTx.address}`)
            await verifyContract(this.hre, deployTx.address)
            await this.db.saveAddressByKey('ChainLinkPriceFeed', deployTx.address);
        }
    }

}