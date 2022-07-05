import {MigrationContext, MigrationDefinition} from "../types";
import {ContractWrapperFactory} from "../ContractWrapperFactory";


const migrations: MigrationDefinition = {
    getTasks: (context: MigrationContext) => ({
        // 'deploy chain link price feed': async () => {
        //     /**
        //      * Currently no param
        //      */
        //     if (context.network == "qc") {
        //         await context.factory.createChainlinkPriceFeedQc({})
        //     } else {
        //         await context.factory.createChainlinkPriceFeed({})
        //     }
        // }
    })
}


export default migrations;
