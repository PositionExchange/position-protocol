import {MigrationContext, MigrationDefinition} from "../types";
import {ContractWrapperFactory} from "../ContractWrapperFactory";
import {BNBBUSD, BTCBUSD, POSIBUSD} from "../config_production";
import {BUSD, POSI} from "../../constants";

const migrations: MigrationDefinition = {


    getTasks: (context: MigrationContext) => {


        if(context.stage != 'production') return {}

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

        if (context.futureType == 'coin-m') return {
            'deploy POSIBUSD position manager production': async () => {
                const positionHouseFunctionContractAddress = await context.db.findAddressByKey('PositionHouse');
                const chainLinkPriceFeedContractAddress = await context.db.findAddressByKey('ChainLinkPriceFeed')
                await context.factory.createPositionManager({
                    quoteAsset: await context.db.findAddressByKey(POSI),
                    initialPrice: POSIBUSD.initialPrice,
                    priceFeedKey: POSIBUSD.priceFeedKey,
                    basisPoint: POSIBUSD.basisPoint,
                    baseBasisPoint: POSIBUSD.baseBasisPoint,
                    tollRatio: POSIBUSD.tollRatio,
                    maxFindingWordsIndex: POSIBUSD.maxFindingWordsIndex,
                    fundingPeriod: POSIBUSD.fundingPeriod,
                    priceFeed: chainLinkPriceFeedContractAddress,
                    quote: POSIBUSD.quote,
                    counterParty: positionHouseFunctionContractAddress,
                    leverage: 20 // TODO update max leverage
                })
            },
        }
        if (context.futureType == 'usd-m')
        return {
            'deploy BTCBUSD position manager production': async () => {

                const positionHouseFunctionContractAddress = await context.db.findAddressByKey('PositionHouse');
                const chainLinkPriceFeedContractAddress = await context.db.findAddressByKey('ChainLinkPriceFeed')
                await context.factory.createPositionManager({
                    quoteAsset: await context.db.findAddressByKey(BUSD),
                    initialPrice: BTCBUSD.initialPrice,
                    priceFeedKey: BTCBUSD.priceFeedKey,
                    basisPoint: BTCBUSD.basisPoint,
                    baseBasisPoint: BTCBUSD.baseBasisPoint,
                    tollRatio: BTCBUSD.tollRatio,
                    maxFindingWordsIndex: BTCBUSD.maxFindingWordsIndex,
                    fundingPeriod: BTCBUSD.fundingPeriod,
                    priceFeed: chainLinkPriceFeedContractAddress,
                    quote: BUSD,
                    counterParty: positionHouseFunctionContractAddress,
                    leverage: 25
                })
            },

            'deploy BNBBUSD position manager production': async () => {
                const positionHouseFunctionContractAddress = await context.db.findAddressByKey('PositionHouse');
                const chainLinkPriceFeedContractAddress = await context.db.findAddressByKey('ChainLinkPriceFeed')
                await context.factory.createPositionManager({
                    quoteAsset: await context.db.findAddressByKey(BUSD),
                    initialPrice: BNBBUSD.initialPrice,
                    priceFeedKey: BNBBUSD.priceFeedKey,
                    basisPoint: BNBBUSD.basisPoint,
                    baseBasisPoint: BNBBUSD.baseBasisPoint,
                    tollRatio: BNBBUSD.tollRatio,
                    maxFindingWordsIndex: BNBBUSD.maxFindingWordsIndex,
                    fundingPeriod: BNBBUSD.fundingPeriod,
                    priceFeed: chainLinkPriceFeedContractAddress,
                    quote: BNBBUSD.quote,
                    counterParty: positionHouseFunctionContractAddress,
                    leverage: 10
                })
            },
        }

    }
}


export default migrations;
