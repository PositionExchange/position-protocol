// @ts-ignore
import {ethers, upgrades} from "ethers";

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

    async createPositionManager(args: CreatePositionManagerInput){
        // @ts-ignore
        const PositionManager = await ethers.getContractFactory("PositionManager")
        const isContractExists = false; // TODO implement
        const contractArgs = [] //TODO implement from args
        if(isContractExists){
            // upgrade
            const contractAddress = ''
            await upgrades.upgradeProxy(contractAddress, PositionManager);
        }else{
            const instance = await upgrades.deployProxy(PositionManager, [...contractArgs]);
            await instance.deployed();
            // TODO save contract instance by quote and base asset
        }
    }

}