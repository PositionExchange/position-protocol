import {MigrationContext, MigrationDefinition} from "../types";
import {ContractWrapperFactory} from "../ContractWrapperFactory";


const migrations: MigrationDefinition = {
    getTasks: (context: MigrationContext) => ({
        'deploy chain link price feed': async () => {
            /**
             * Currently no param
             */
            if (context.stage != 'production') {
                await context.factory.createChainlinkPriceFeedQc({})
            }

        }
    })
}


export default migrations;
