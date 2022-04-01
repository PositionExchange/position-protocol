import {MigrationContext, MigrationDefinition} from "../types";
import {ContractWrapperFactory} from "../ContractWrapperFactory";

const migrations: MigrationDefinition = {
    getTasks: (context: MigrationContext) => {

        if(context.stage != 'test') return {}

        return {
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
                await context.factory.createPositionManager({
                    quoteAsset: await context.db.getMockContract(`BUSD`),
                    initialPrice: 4500000,
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
            'deploy DOTBUSD position manager': async () => {
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
                await context.factory.createPositionManager({
                    quoteAsset: await context.db.getMockContract(`BUSD`),
                    initialPrice: 21000,
                    priceFeedKey: 'DOT',
                    basisPoint: 1000,
                    baseBasisPoint: 1000000,
                    tollRatio: 10000,
                    maxFindingWordsIndex: 20,
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
                await context.factory.createPositionManager({
                    quoteAsset: await context.db.getMockContract(`BUSD`),
                    initialPrice: 43000,
                    priceFeedKey: 'BNB',
                    basisPoint: 100,
                    baseBasisPoint: 10000,
                    tollRatio: 10000,
                    maxFindingWordsIndex: 900,
                    fundingPeriod: 1000,
                    priceFeed: chainLinkPriceFeedContractAddress,
                    quote: 'BUSD',
                    counterParty: positionHouseFunctionContractAddress
                })
            },
            'deploy LINKBUSD position manager': async () => {
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
                await context.factory.createPositionManager({
                    quoteAsset: await context.db.getMockContract(`BUSD`),
                    initialPrice: 17000,
                    priceFeedKey: 'LINK',
                    basisPoint: 1000,
                    baseBasisPoint: 100000,
                    tollRatio: 10000,
                    maxFindingWordsIndex: 50,
                    fundingPeriod: 1000,
                    priceFeed: chainLinkPriceFeedContractAddress,
                    quote: 'BUSD',
                    counterParty: positionHouseFunctionContractAddress
                })
            },
        }
    }
}


export default migrations;
