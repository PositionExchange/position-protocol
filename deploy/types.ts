import {ContractWrapperFactory} from './ContractWrapperFactory'
import {DeployDataStore} from "./DataStore";
import {HardhatRuntimeEnvironment} from "hardhat/types";

export type MigrationTask = () => Promise<void>

export interface MigrationDefinition {
    configPath?: string
    getTasks: (context: MigrationContext) => {
        [taskName: string]: MigrationTask
    }
}

export type Stage = "production" | "staging" | "test"
export type Network = "bsc_testnet" | "bsc_mainnet"

export interface MigrationContext {
    stage: Stage
    network: Network
    // layer: Layer
    // settingsDao: SettingsDao
    // systemMetadataDao: SystemMetadataDao
    // externalContract: ExternalContracts
    // deployConfig: DeployConfig
    factory: ContractWrapperFactory
    db: DeployDataStore
    hre: HardhatRuntimeEnvironment
}


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
    quote: string;
    counterParty : string
    leverage?: number
}


export interface ConfigPositionManagerInput {
    initialPrice: number;
    priceFeedKey: string;
    basisPoint: number;
    baseBasisPoint: number;
    tollRatio: number;
    maxFindingWordsIndex: number;
    fundingPeriod: number;
    quote: string;
}

export interface CreatePositionHouseInput {
    insuranceFund: string,
    positionHouseConfigurationProxy: string
    positionNotionalConfigProxy: string
    // feePool: string
}

export interface CreatePositionHouseConfigurationProxyInput {
    maintenanceMarginRatio: number,
    partialLiquidationRatio: number,
    liquidationFeeRatio: number,
    liquidationPenaltyRatio: number,
}

export interface CreatePositionHouseViewerInput {
    positionHouse: string,
    positionHouseConfigurationProxy: string
}

export interface CreatePositionStrategyOrderInput {
    positionHouse: string,
    positionHouseViewer: string
}

export interface CreateInsuranceFund {

}

export interface CreatePositionHouseFunction {

}

export interface CreateChainLinkPriceFeed {

}

export interface CreatePositionNotionalConfigProxy {

}



export interface PositionManager {
    symbol: string,
    address: string
}
