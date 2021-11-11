import {MigrationContext, MigrationDefinition} from "../types";
import {ContractWrapperFactory} from "../ContractWrapperFactory";


const migrations: MigrationDefinition = {
    getTasks: (context: MigrationContext) => ({
        'deploy insurance fund of position manager': async () => {
            /**
             * Currently no param
             */

            await context.factory.createInsuranceFund({})

        }
    })
}


export default migrations;
