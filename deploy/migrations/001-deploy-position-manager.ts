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
            const positionManager = new ContractWrapperFactory();

            await positionManager.createPositionManager({
                quoteAsset: '0xed24fc36d5ee211ea25a80239fb8c4cfd80f12ee',
                initialPrice: 5000,
                priceFeedKey: 'BTC',
                basisPoint: 100,
                baseBasisPoint: 10000,
                tollRatio: 10000,
                maxFindingWordsIndex: 1000,
                fundingPeriod: 1000,
                priceFeed: '0x5741306c21795FdCBb9b265Ea0255F499DFe515C'.toLowerCase()
            })

        }
    })
}

export default migrations;
