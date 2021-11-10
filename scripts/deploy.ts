import { task } from "hardhat/config";
import path = require("path");
import {readdir} from "fs/promises";
import {ExecOptions} from "child_process";
import {Stage} from "../deploy/types";

export const TASK_MIGRATE = "migrate"


async function deploy(stage: Stage, options?: ExecOptions) {

    const basePath = path.join(__dirname, "../deploy/migrations")
    const filenames = await readdir(basePath)
    const context = {

    }
    for (const filename of filenames) {
        const migrationPath = path.join(basePath, filename)
        // const {batchIndex, layer, configPath} = await loadMigration(migrationPath)

        // if (batchIndex < nextMigration.batchIndex) {
        //     console.info(`Skip migration: ${filename}`)
        //     continue
        // }

        console.info(`Start migration: ${filename}`)
        const network = 'testnet';//settings.getNetwork(layer)
        const module = await import(path.join(basePath, filename))
        console.log(module)
        // const configPathParam = configPath ? `--config ${configPath}` : ""

    }

}

task('deploy', 'deploy contracts', async (taskArgs, hre, runSuper) => {
    deploy(taskArgs.stage)
}).addParam('stage', 'Stage', undefined, Stage)


export default {}