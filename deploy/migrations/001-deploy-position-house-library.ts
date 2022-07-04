import {MigrationContext, MigrationDefinition} from "../types";
import {ContractWrapperFactory} from "../ContractWrapperFactory";


const migrations: MigrationDefinition = {
    getTasks: (context: MigrationContext) => ({
        'deploy position house function': async () => {
            /**
             no param
             */
            if (context.futureType == 'coin-m') {
                const coinMarginAddress = await context.db.findAddressByKey('CoinMargin');
                console.log(`CoinMargin  ${coinMarginAddress}`);
                await context.factory.createCoinMarginLibrary({})
            } else {
                const usdMarginAddress = await context.db.findAddressByKey('USDMargin');
                console.log(`CoinMargin  ${usdMarginAddress}`);
                await context.factory.createUSDMarginLibrary({})
            }

            const positionHouseMathContractAddress = await context.db.findAddressByKey('PositionMath');
            console.log(`PositionMath  ${positionHouseMathContractAddress}`);
            if(!positionHouseMathContractAddress)
                await context.factory.createPositionMathLibrary({futureType: context.futureType})

            const positionHouseFunctionContractAddress = await context.db.findAddressByKey('PositionHouseFunction');
            console.log(`PositionHouseFunction  ${positionHouseFunctionContractAddress}`);
            await context.factory.createPositionHouseFunctionLibrary({})

        }
    })
}


export default migrations;
