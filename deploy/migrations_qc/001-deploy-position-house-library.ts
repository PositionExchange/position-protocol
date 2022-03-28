import {MigrationContext, MigrationDefinition} from "../types";
import {ContractWrapperFactory} from "../ContractWrapperFactory";


const migrations: MigrationDefinition = {
    getTasks: (context: MigrationContext) => ({
        'deploy position house function': async () => {
            /**
             no param
             */
            const positionHouseFunctionContractAddress = await context.db.findAddressByKey('PositionHouseFunction');
            console.log(`PositionHouseFunction  ${positionHouseFunctionContractAddress}`);
            await context.factory_qc.createPositionHouseFunctionLibrary({})

            const positionHouseMathContractAddress = await context.db.findAddressByKey('PositionHouseMath');
            console.log(`PositionHouseMath  ${positionHouseMathContractAddress}`);
            await context.factory_qc.createPositionHouseMathLibrary({})

        }
    })
}


export default migrations;
