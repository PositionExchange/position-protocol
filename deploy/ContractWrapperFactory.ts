
export interface CreatePositionManagerInput {
    quoteAsset: string;
    initialPrice: number;
    priceFeedKey: string;
    basisPoint: number;
    baseBasisPoint: number;
    tollRatio: number;
    maxFindingWordsIndex: number;
    fundingPeriod: number;
    priceFeed: string;
}

export class ContractWrapperFactory {
    constructor() {
    }

    createPositionManager(args: CreatePositionManagerInput){

    }

}