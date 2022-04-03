import { task } from "hardhat/config";
import path = require("path");
import {readdir} from "fs/promises";
import {ExecOptions} from "child_process";
import {MigrationContext, Network, Stage} from "../deploy/types";
import {ContractWrapperFactory} from "../deploy/ContractWrapperFactory";
import {DeployDataStore} from "../deploy/DataStore";
import {BUSD, BUSD_ADDRESS} from "../constants";
import {TransactionResponse} from "@ethersproject/abstract-provider";
import {verifyContract} from "./utils";


task('deploy', 'deploy contracts', async (taskArgs: {stage: Stage}, hre, runSuper) => {
    const basePath = path.join(__dirname, "../deploy/migrations")
    const filenames = await readdir(basePath)
    const db = new DeployDataStore(taskArgs.stage == 'production' && './deployData_mainnet.db')
    const context: MigrationContext = {
        stage: taskArgs.stage,
        network: hre.network.name as Network,
        factory: new ContractWrapperFactory(db, hre),
        db,
        hre
    }

    if (taskArgs.stage == 'production') {
        await db.saveAddressByKey(BUSD, BUSD_ADDRESS)
    }
    for (const filename of filenames) {
        console.info(`Start migration: ${filename}`)
        const module = await import(path.join(basePath, filename))
        const tasks = module.default.getTasks(context)
        for(const key of Object.keys(tasks)){
            console.group(`-- Start run task ${key}`)
            await tasks[key]()
            console.groupEnd()
        }

    }
}).addParam('stage', 'Stage')

task('listDeployedContract', 'list all deployed contracts', async (taskArgs: {stage: Stage}) => {
    const db = new DeployDataStore( './deployData_mainnet.db')
    const data = await db.listAllContracts()
    for(const obj of data){
        console.log(obj.key, obj.address)
    }
})
async function verifyImplContract(deployTransaction: TransactionResponse, hre) {
    const {data} = deployTransaction
    const decodedData = hre.ethers.utils.defaultAbiCoder.decode(
        ['address', 'address'],
        hre.ethers.utils.hexDataSlice(data, 4)
    );
    const implContractAddress = decodedData[1]
    console.log("Upgraded to impl contract", implContractAddress)
    try {
        await verifyContract(hre, implContractAddress)
    } catch (err) {
        console.error(`-- verify contract error`, err)
    }
}
task('upgradePositionManager', '', async (taskArgs, hre) => {
    const PositionManager = await hre.ethers.getContractFactory("PositionManager")
    const PositionHouse = await hre.ethers.getContractFactory("PositionHouse", {
        libraries: {
            PositionHouseMath: '0x8fb5ca4b12fa8b945f89c57891328e7a1ca38682',
            PositionHouseFunction: '0x95dbdb5fa5883e8b2a6aa833c3e4dcded6b6d21c'
        }
    })
    // const upgraded = await hre.upgrades.upgradeProxy('0x9300cf53112b7d88896e748a8c22d946e8441a16', PositionManager);
    // console.log(`Starting verify upgrade Position Manager `)
    // await verifyImplContract(upgraded.deployTransaction)
    const upgraded2 = await hre.upgrades.upgradeProxy('0xf495d56a70585c729c822b0a6050c5ccc38d33fa', PositionHouse, {unsafeAllowLinkedLibraries: true});
    console.log(`Starting verify upgrade Position Manager `)
    await verifyImplContract(upgraded2.deployTransaction, hre)


})


export default {}