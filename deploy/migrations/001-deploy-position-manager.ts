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
            await context.factory.createPositionManager({
                quoteAsset: await context.db.getMockContract(`BUSD`),
                initialPrice: 6837500,
                priceFeedKey: 'BTC',
                basisPoint: 100,
                baseBasisPoint: 10000,
                tollRatio: 10000,
                maxFindingWordsIndex: 3000,
                fundingPeriod: 1000,
                priceFeed: '0x5741306c21795FdCBb9b265Ea0255F499DFe515C'.toLowerCase(),
                quote: 'BUSD'
            })
        },

    })
}


export default migrations;
