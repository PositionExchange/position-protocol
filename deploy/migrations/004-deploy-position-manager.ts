import {MigrationContext, MigrationDefinition} from "../types";
import {ContractWrapperFactory} from "../ContractWrapperFactory";

const migrations: MigrationDefinition = {
    getTasks: (context: MigrationContext) => ({
        'deploy BTCBUSD position manager': async () => {
            /**
             quoteAsset: string;
             initialPrice: number;
             priceFeedKey: string;
             basisPoint: number;
             baseBasisPoint: number;
             tollRatio: number;
             maxFindingWordsIndex: number;
             fundingPeriod: number;
             priceFeed: string;
             */
            const positionHouseFunctionContractAddress = await context.db.findAddressByKey('PositionHouse');
            await context.factory.createPositionManager({
                quoteAsset: await context.db.getMockContract(`BUSD`),
                initialPrice: 6350000,
                priceFeedKey: 'BTC',
                basisPoint: 100,
                baseBasisPoint: 10000,
                tollRatio: 10000,
                maxFindingWordsIndex: 1800,
                fundingPeriod: 1000,
                priceFeed: '0x5741306c21795FdCBb9b265Ea0255F499DFe515C'.toLowerCase(),
                quote: 'BUSD',
                counterParty: positionHouseFunctionContractAddress
            })
        },
        'deploy POSIBUSD position manager': async () => {
            /**
             quoteAsset: string;
             initialPrice: number;
             priceFeedKey: string;
             basisPoint: number;
             baseBasisPoint: number;
             tollRatio: number;
             maxFindingWordsIndex: number;
             fundingPeriod: number;
             priceFeed: string;
             */
            const positionHouseFunctionContractAddress = await context.db.findAddressByKey('PositionHouse');
            await context.factory.createPositionManager({
                quoteAsset: await context.db.getMockContract(`BUSD`),
                initialPrice: 4000,
                priceFeedKey: 'POSI',
                basisPoint: 1000,
                baseBasisPoint: 1000000,
                tollRatio: 10000,
                maxFindingWordsIndex: 10,
                fundingPeriod: 1000,
                priceFeed: '0x5741306c21795FdCBb9b265Ea0255F499DFe515C'.toLowerCase(),
                quote: 'BUSD',
                counterParty: positionHouseFunctionContractAddress
            })
        }

    })
}


export default migrations;
