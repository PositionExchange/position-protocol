import {MigrationContext, MigrationDefinition} from "../types";

const migrations: MigrationDefinition = {
    getTasks: (context: MigrationContext) => {
        if (context.stage != "production") {
            return {
                'deploy Price aggregator': async () => {
                    await context.factory.createPriceAggregator();
                }
            }
        }
    }
}

export default migrations