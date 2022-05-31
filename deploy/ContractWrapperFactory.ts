import {
    CreatePositionManagerInput,
    PositionManager,
    CreatePositionHouseInput,
    CreateInsuranceFund,
    CreatePositionHouseFunction,
    CreateChainLinkPriceFeed,
    CreatePositionHouseConfigurationProxyInput,
    CreatePositionHouseViewerInput, CreatePositionNotionalConfigProxy
} from "./types";
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
                args.priceFeed,
                args.counterParty
            ];

            //@ts-ignore
            const instance = await upgrades.deployProxy(PositionManager, contractArgs);
            console.log("wait for deploy")
            await instance.deployed();
            const address = instance.address.toString().toLowerCase();
            console.log(`${symbol} positionManager address : ${address}`)
            await this.db.saveAddressByKey(saveKey, address);
        }
    }

    async createPositionHouse(args: CreatePositionHouseInput) {
        console.log(`into create PositionHouse`);
        const positionHouseFunctionContractAddress = await this.db.findAddressByKey(`PositionHouseFunction`);
        console.log(`positionHouseFunctionContractAddress ${positionHouseFunctionContractAddress}`);

        const positionHouseMathContractAddress = await this.db.findAddressByKey(`PositionHouseMath`);
        console.log(`positionHouseMathContractAddress ${positionHouseMathContractAddress}`);

        const PositionHouse = await this.hre.ethers.getContractFactory("PositionHouse", {
            libraries: {
                PositionHouseFunction: positionHouseFunctionContractAddress,
                PositionHouseMath: positionHouseMathContractAddress
            }
        })
        const positionHouseContractAddress = await this.db.findAddressByKey(`PositionHouse`);

        if (positionHouseContractAddress) {
            console.log('Start upgrade position house')
            const upgraded = await this.hre.upgrades.upgradeProxy(positionHouseContractAddress, PositionHouse, {unsafeAllowLinkedLibraries: true});
            console.log('Starting verify upgrade PositionHouse');
            await this.verifyImplContract(upgraded.deployTransaction);

        } else {
            const contractArgs = [
                args.insuranceFund,
                args.positionHouseConfigurationProxy,
                args.positionNotionalConfigProxy
                // args.feePool
            ];

            //@ts-ignore
            const instance = await upgrades.deployProxy(PositionHouse, contractArgs, {unsafeAllowLinkedLibraries: true});
            console.log("wait for deploy")
            await instance.deployed();

            const address = instance.address.toString().toLowerCase();
            console.log(`PositionHouse address : ${address}`)
            await this.db.saveAddressByKey('PositionHouse', address);
        }
    }

    async createPositionHouseConfigurationProxy(args: CreatePositionHouseConfigurationProxyInput) {
        console.log(`into create PositionHouseConfigurationProxy`);

        const PositionHouseConfiguration = await this.hre.ethers.getContractFactory("PositionHouseConfigurationProxy")
        const positionHouseConfigurationContractAddress = await this.db.findAddressByKey(`PositionHouseConfigurationProxy`);

        if (positionHouseConfigurationContractAddress) {
            console.log('Start upgrade position house configuration')
            const upgraded = await this.hre.upgrades.upgradeProxy(positionHouseConfigurationContractAddress, PositionHouseConfiguration, {unsafeAllowLinkedLibraries: true});
            console.log('Starting verify upgrade PositionHouseConfiguration');
            await this.verifyImplContract(upgraded.deployTransaction);

        } else {
            const contractArgs = [
                args.maintenanceMarginRatio,
                args.partialLiquidationRatio,
                args.liquidationFeeRatio,
                args.liquidationPenaltyRatio
            ];

            //@ts-ignore
            const instance = await upgrades.deployProxy(PositionHouseConfiguration, contractArgs, {unsafeAllowLinkedLibraries: true});
            console.log("wait for deploy")
            await instance.deployed();

            const address = instance.address.toString().toLowerCase();
            console.log(`PositionHouseConfiguration address : ${address}`)
            await this.db.saveAddressByKey('PositionHouseConfigurationProxy', address);
        }
    }

    async createPositionHouseViewer(args: CreatePositionHouseViewerInput) {
        console.log(`into create PositionHouseViewer`);
        const positionHouseFunctionContractAddress = await this.db.findAddressByKey(`PositionHouseFunction`);
        console.log(`positionHouseFunctionContractAddress ${positionHouseFunctionContractAddress}`);


        const PositionHouseViewer = await this.hre.ethers.getContractFactory("PositionHouseViewer", {
            libraries: {
                PositionHouseFunction: positionHouseFunctionContractAddress,
            }
        })
        const positionHouseViewerContractAddress = await this.db.findAddressByKey(`PositionHouseViewer`);

        if (positionHouseViewerContractAddress) {
            console.log('Start upgrade position house configuration')
            const upgraded = await this.hre.upgrades.upgradeProxy(positionHouseViewerContractAddress, PositionHouseViewer, {unsafeAllowLinkedLibraries: true});
            console.log('Starting verify upgrade PositionHouseConfiguration');
            await this.verifyImplContract(upgraded.deployTransaction);

        } else {
            const contractArgs = [
                args.positionHouse,
                args.positionHouseConfigurationProxy,
            ];

            //@ts-ignore
            const instance = await upgrades.deployProxy(PositionHouseViewer, contractArgs, {unsafeAllowLinkedLibraries: true});
            console.log("wait for deploy")
            await instance.deployed();

            const address = instance.address.toString().toLowerCase();
            console.log(`PositionHouseViewer address : ${address}`)
            await this.db.saveAddressByKey('PositionHouseViewer', address);
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
            const address = instance.address.toString().toLowerCase();
            console.log(`InsuranceFund address : ${address}`)
            await this.db.saveAddressByKey('InsuranceFund', address);

        }
    }

    async createPositionNotionConfigProxy(args: CreatePositionNotionalConfigProxy) {
        const PositionNotionalConfigProxy = await this.hre.ethers.getContractFactory("PositionNotionalConfigProxy");

        const deployTx = await PositionNotionalConfigProxy.deploy();
        await deployTx.deployTransaction.wait(3)
        console.log("wait for deploy position notional config proxy");
        await this.db.saveAddressByKey('PositionNotionalConfigProxy', deployTx.address.toLowerCase());
    }

    async createPositionHouseFunctionLibrary(args: CreatePositionHouseFunction) {
        const PositionHouseFunction = await this.hre.ethers.getContractFactory("PositionHouseFunction");

        const deployTx = await PositionHouseFunction.deploy();
        await deployTx.deployTransaction.wait(3)
        console.log("wait for deploy position house function fund");
        await this.db.saveAddressByKey('PositionHouseFunction', deployTx.address.toLowerCase());
    }

    async createPositionHouseMathLibrary(args: CreatePositionHouseFunction) {
        const PositionHouseMath = await this.hre.ethers.getContractFactory("PositionHouseMath");

        const deployTx = await PositionHouseMath.deploy();
        await deployTx.deployTransaction.wait(3)
        console.log("wait for deploy position house math fund");
        await this.db.saveAddressByKey('PositionHouseMath', deployTx.address.toLowerCase());
    }

    async createChainlinkPriceFeed( args: CreateChainLinkPriceFeed){
        const ChainLinkPriceFeed = await this.hre.ethers.getContractFactory("ChainLinkPriceFeed");
        const chainlinkContractAddress = await this.db.findAddressByKey(`ChainLinkPriceFeed`);
        if (chainlinkContractAddress) {
            const upgraded = await this.hre.upgrades.upgradeProxy(chainlinkContractAddress, ChainLinkPriceFeed);
            await this.verifyImplContract(upgraded.deployTransaction);
        } else {
            const contractArgs = [];
            const instance = await this.hre.upgrades.deployProxy(ChainLinkPriceFeed, contractArgs);
            console.log("wait for deploy chainlink price feed");
            await instance.deployed();
            const address = instance.address.toString().toLowerCase();
            console.log(`Chain link price feed address : ${address}`)
            await this.db.saveAddressByKey('ChainLinkPriceFeed', address);

        }
    }

    async createChainlinkPriceFeedQc( args: CreateChainLinkPriceFeed){
        const ChainLinkPriceFeed = await this.hre.ethers.getContractFactory("ChainLinkPriceFeedMock");
        const chainlinkContractAddress = await this.db.findAddressByKey(`ChainLinkPriceFeed`);
        if (chainlinkContractAddress) {
            const upgraded = await this.hre.upgrades.upgradeProxy(chainlinkContractAddress, ChainLinkPriceFeed);
            await this.verifyImplContract(upgraded.deployTransaction);
        } else {
            const contractArgs = [];
            const instance = await this.hre.upgrades.deployProxy(ChainLinkPriceFeed, contractArgs);
            console.log("wait for deploy chainlink price feed");
            await instance.deployed();
            const address = instance.address.toString().toLowerCase();
            console.log(`Chain link price feed address : ${address}`)
            await this.db.saveAddressByKey('ChainLinkPriceFeed', address);
        }

    }

}