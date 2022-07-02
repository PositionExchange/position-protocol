import {MigrationContext, MigrationDefinition} from "../types";

const migrations: MigrationDefinition = {
    getTasks: (context: MigrationContext) => {
        return {
            'deploy Price aggregator': async () => {
                await context.factory.createPriceAggregator();
            }
        }
    }
}

export default migrations