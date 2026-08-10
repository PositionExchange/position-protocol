import {MigrationContext, MigrationDefinition} from "../types";
import {verifyContract} from "../../scripts/utils";

const migrations: MigrationDefinition = {
    getTasks: (context: MigrationContext) => ({
        'deploy position busd bonus token': async () => {
            // TODO Update name and symbol before migration
            const name = ''
            const symbol = ''
            const creditToken = await context.hre.ethers.getContractFactory('PositionBUSDBonus')
            if(await context.db.findAddressByKey(symbol) ) return;
            const deployTx = await creditToken.deploy(name, symbol)
            await deployTx.deployTransaction.wait(3)
            await verifyContract(context.hre, deployTx.address, [name, symbol])
            await context.db.saveAddressByKey(symbol, deployTx.address)
        },
    })
}

export default migrations
