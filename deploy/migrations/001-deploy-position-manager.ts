import {MigrationContext, MigrationDefinition} from "../types";
import {ethers, upgrades} from 'hardhat'

const migrations: MigrationDefinition = {
    getTasks: (context: MigrationContext) => ({
        'deploy BTCBUSD position manager': async() =>
        {

        }
    })
}

export default migrations;
