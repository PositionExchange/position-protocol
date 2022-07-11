import {MigrationDefinition} from "../types";
import {verifyContract} from "../../scripts/utils";

const migrations: MigrationDefinition = {
    getTasks: (context) => {
        // only for test stage
        if(context.stage != 'test') return {}
        async function deployMockBep20(name, symbol){
            // @ts-ignore
            const bep20Mintable = await context.hre.ethers.getContractFactory('BEP20Mintable')
            if(await context.db.findAddressByKey(`Mock:${symbol}`) ) return;
            const deployTx = await bep20Mintable.deploy(name, symbol)
            await deployTx.deployTransaction.wait(3)
            await verifyContract(context.hre, deployTx.address, [name, symbol])
            await context.db.saveAddressByKey(`Mock:${symbol}`, deployTx.address)
        }
        return {
            'deploy mock BUSDBonus': async () => {
                return deployMockBep20('BUSD Bonus', 'BUSDBonus')
            },
            'deploy mock BUSD': async () => {
                return deployMockBep20('BUSD Mock', 'BUSD')
            }
        }
    }
}

export default migrations