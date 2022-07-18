import {ConfigPositionManagerInput, CreatePositionManagerInput} from "./types";
import {BUSD} from "../constants";


export const BTCBUSD : ConfigPositionManagerInput = {
    initialPrice: 0,
    priceFeedKey: 'BTC',
    basisPoint: 100,
    baseBasisPoint: 10000,
    // fee: 0.02%
    tollRatio: 5000,
    maxFindingWordsIndex: 1200,
    fundingPeriod: 3600,
    quote: BUSD,
}

export const BNBBUSD : ConfigPositionManagerInput = {
    initialPrice: 0,
    priceFeedKey: 'BNB',
    basisPoint: 100,
    baseBasisPoint: 10000,
    // fee: 0.02%
    tollRatio: 5000,
    maxFindingWordsIndex: 40, // find in $100 range
    fundingPeriod: 3600,
    quote: BUSD,
}

export const POSIBUSD : ConfigPositionManagerInput = {
    initialPrice: 0,
    priceFeedKey: 'POSI',
    basisPoint: 100000,
    baseBasisPoint: 10000000000,
    // fee: 0.02%
    tollRatio: 5000,
    maxFindingWordsIndex: 200, // find in $0.5 range
    fundingPeriod: 3600,
    quote: BUSD
}