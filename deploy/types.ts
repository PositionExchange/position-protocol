import {ContractWrapperFactory} from './ContractWrapperFactory'

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
    quote: string
}

export interface CreatePositionHouseInput {
    maintenanceMarginRatio: number,
    partialLiquidationRatio: number,
    liquidationFeeRatio: number,
    liquidationPenaltyRatio: number
}


export  interface CreateInsuranceFund{

}


export interface PositionManager {
    symbol: string,
    address: string
}
