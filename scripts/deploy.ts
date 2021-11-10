import path = require("path");
import {asyncExec} from "./helper";
import {readdir} from "fs/promises";
import {ExecOptions} from "child_process";


async function deploy(stage: string, options?: ExecOptions) {

    const basePath = path.join(__dirname, "../deploy/migrations")
    const filenames = await readdir(basePath)
    for (const filename of filenames) {
        const migrationPath = path.join(basePath, filename)
        // const {batchIndex, layer, configPath} = await loadMigration(migrationPath)

        // if (batchIndex < nextMigration.batchIndex) {
        //     console.info(`Skip migration: ${filename}`)
        //     continue
        // }

        console.info(`Start migration: ${filename}`)
        const network = 'testnet';//settings.getNetwork(layer)
        // const configPathParam = configPath ? `--config ${configPath}` : ""
        const cmd = `hardhat run --network ${network} ${migrationPath}`
        console.log(cmd);
        await asyncExec(cmd, options)
    }

}

async function main() {
    await deploy('test');


}

main().then(() => process.exit(0)).catch((error) => {
    console.error(error);
    process.exit(1);
})