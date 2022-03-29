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
            const chainLinkPriceFeedContractAddress = await context.db.findAddressByKey('ChainLinkPriceFeed')
            await context.factory_qc.createPositionManager({
                quoteAsset: await context.db.getMockContract(`BUSD`),
                initialPrice: 6500000,
                priceFeedKey: 'BTC',
                basisPoint: 100,
                baseBasisPoint: 10000,
                tollRatio: 10000,
                maxFindingWordsIndex: 1800,
                fundingPeriod: 1000,
                priceFeed: chainLinkPriceFeedContractAddress,
                quote: 'BUSD',
                counterParty: positionHouseFunctionContractAddress
            })
        },
        // add multi pair
        'deploy ETHBUSD position manager': async () => {
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
            const chainLinkPriceFeedContractAddress = await context.db.findAddressByKey('ChainLinkPriceFeed')
            await context.factory_qc.createPositionManager({
                quoteAsset: await context.db.getMockContract(`BUSD`),
                initialPrice: 5000000,
                priceFeedKey: 'ETH',
                basisPoint: 100,
                baseBasisPoint: 10000,
                tollRatio: 10000,
                maxFindingWordsIndex: 1800,
                fundingPeriod: 1000,
                priceFeed: chainLinkPriceFeedContractAddress,
                quote: 'BUSD',
                counterParty: positionHouseFunctionContractAddress
            })
        },
        'deploy BNBBUSD position manager': async () => {
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
            const chainLinkPriceFeedContractAddress = await context.db.findAddressByKey('ChainLinkPriceFeed')
            await context.factory_qc.createPositionManager({
                quoteAsset: await context.db.getMockContract(`BUSD`),
                initialPrice: 3500000,
                priceFeedKey: 'BNB',
                basisPoint: 100,
                baseBasisPoint: 10000,
                tollRatio: 10000,
                maxFindingWordsIndex: 1800,
                fundingPeriod: 1000,
                priceFeed: chainLinkPriceFeedContractAddress,
                quote: 'BUSD',
                counterParty: positionHouseFunctionContractAddress
            })
        },
        'deploy SOLBUSD position manager': async () => {
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
            const chainLinkPriceFeedContractAddress = await context.db.findAddressByKey('ChainLinkPriceFeed')
            await context.factory_qc.createPositionManager({
                quoteAsset: await context.db.getMockContract(`BUSD`),
                initialPrice: 2000000,
                priceFeedKey: 'SOL',
                basisPoint: 100,
                baseBasisPoint: 10000,
                tollRatio: 10000,
                maxFindingWordsIndex: 1800,
                fundingPeriod: 1000,
                priceFeed: chainLinkPriceFeedContractAddress,
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
            const chainLinkPriceFeedContractAddress = await context.db.findAddressByKey('ChainLinkPriceFeed')
            await context.factory_qc.createPositionManager({
                quoteAsset: await context.db.getMockContract(`BUSD`),
                initialPrice: 4000,
                priceFeedKey: 'POSI',
                basisPoint: 1000,
                baseBasisPoint: 1000000,
                tollRatio: 10000,
                maxFindingWordsIndex: 10,
                fundingPeriod: 1000,
                priceFeed: chainLinkPriceFeedContractAddress,
                quote: 'BUSD',
                counterParty: positionHouseFunctionContractAddress
            })
        }

    })
}


export default migrations;
