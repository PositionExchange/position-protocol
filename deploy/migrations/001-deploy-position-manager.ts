import {MigrationContext, MigrationDefinition} from "../types";

const migrations: MigrationDefinition = {
    getTasks: (context: MigrationContext) => ({
        'deploy BTCBUSD position manager': async() =>
        {

        }
    })
}

export default migrations;
