import { task } from "hardhat/config";
import path = require("path");
import {readdir} from "fs/promises";
import {ExecOptions} from "child_process";
import {FutureType, MigrationContext, Network, Stage} from "../deploy/types";
import {ContractWrapperFactory} from "../deploy/ContractWrapperFactory";
import {DeployDataStore} from "../deploy/DataStore";
import {BUSD, BUSD_ADDRESS, POSI, POSI_ADDRESS} from "../constants";
import {TransactionResponse} from "@ethersproject/abstract-provider";
import {verifyContract} from "./utils";

const DATA_STORE_FILE = {
    'usd-m': './deployData_mainnet.db',
    'coin-m': './deployData_mainnet_coin_m.db',
}


task('deploy', 'deploy contracts', async (taskArgs: {stage: Stage, task: string, type: FutureType}, hre, runSuper) => {
    const basePath = path.join(__dirname, "../deploy/migrations")
    const filenames = await readdir(basePath)
    let dataStoreFileName
    if (taskArgs.stage == 'production') {
        dataStoreFileName = DATA_STORE_FILE[taskArgs.type || 'usd-m']
    }
    // TODO update db file when deploy coin-m
    const db = new DeployDataStore(dataStoreFileName)
    const context: MigrationContext = {
        stage: taskArgs.stage,
        network: hre.network.name as Network,
        factory: new ContractWrapperFactory(db, hre),
        db,
        hre,
        futureType: taskArgs.type
    }

    if (taskArgs.stage == 'production') {
        // save address posi by key
        if (taskArgs.type == 'coin-m') {
            await db.saveAddressByKey(POSI, POSI_ADDRESS)
        }
        await db.saveAddressByKey(BUSD, BUSD_ADDRESS)
    }
    for (const filename of filenames) {
        console.info(`Start migration: ${filename}`)
        const module = await import(path.join(basePath, filename))
        const tasks = module.default.getTasks(context)
        for(const key of Object.keys(tasks)){
            if(!taskArgs.task || taskArgs.task == key){
                console.group(`-- Start run task ${key}`)
                await tasks[key]()
                console.groupEnd()
            }
        }

    }
}).addParam('stage', 'Stage').addOptionalParam('task', 'Task Name').addOptionalParam('type', 'Type of Perpetual Future Contract', 'usd-m')

task('listDeployedContract', 'list all deployed contracts', async (taskArgs: {stage: Stage}) => {
    const db = new DeployDataStore( './deployData_mainnet.db')
    const data = await db.listAllContracts()
    for(const obj of data){
        console.log(obj.key, obj.address)
    }
})

export default {}