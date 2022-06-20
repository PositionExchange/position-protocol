import {MigrationContext, MigrationDefinition} from "../types";
import {ContractWrapperFactory} from "../ContractWrapperFactory";


const migrations: MigrationDefinition = {
    getTasks: (context: MigrationContext) => ({
        'deploy position house function': async () => {
            /**
             no param
             */
            const coinMarginAddress = await context.db.findAddressByKey('CoinMargin');
            console.log(`CoinMargin  ${coinMarginAddress}`);
            await context.factory.createCoinMarginLibrary({})

            const positionHouseMathContractAddress = await context.db.findAddressByKey('PositionMath');
            console.log(`PositionMath  ${positionHouseMathContractAddress}`);
            await context.factory.createPositionMathLibrary({})

            const positionHouseFunctionContractAddress = await context.db.findAddressByKey('PositionHouseFunction');
            console.log(`PositionHouseFunction  ${positionHouseFunctionContractAddress}`);
            await context.factory.createPositionHouseFunctionLibrary({})

        }
    })
}


export default migrations;
