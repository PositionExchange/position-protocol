import {ConfigPositionManagerInput, CreatePositionManagerInput} from "./types";
import {BUSD} from "../constants";


export const BTCBUSD : ConfigPositionManagerInput = {
    initialPrice: 0,
    priceFeedKey: 'BTC',
    basisPoint: 100,
    baseBasisPoint: 10000,
    // fee: 0.02%
    tollRatio: 20000,
    maxFindingWordsIndex: 1800,
    fundingPeriod: 1000,
    quote: BUSD,
}

export const BNBBUSD : ConfigPositionManagerInput = {
    initialPrice: 0,
    priceFeedKey: 'BNB',
    basisPoint: 100,
    baseBasisPoint: 10000,
    // fee: 0.02%
    tollRatio: 20000,
    maxFindingWordsIndex: 900,
    fundingPeriod: 1000,
    quote: BUSD,
}