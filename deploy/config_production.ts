import {ConfigPositionManagerInput, CreatePositionManagerInput} from "./types";
import {BUSD} from "../constants";


export const BTCBUSD : ConfigPositionManagerInput = {
    initialPrice: 0,
    priceFeedKey: 'BTC',
    basisPoint: 0,
    baseBasisPoint: 0,
    tollRatio: 0,
    maxFindingWordsIndex: 0,
    fundingPeriod: 0,
    quote: BUSD,
}

export const BNBBUSD : ConfigPositionManagerInput = {
    initialPrice: 0,
    priceFeedKey: 'BNB',
    basisPoint: 0,
    baseBasisPoint: 0,
    tollRatio: 0,
    maxFindingWordsIndex: 0,
    fundingPeriod: 0,
    quote: BUSD,
}