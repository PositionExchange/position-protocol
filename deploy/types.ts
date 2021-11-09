
export type MigrationTask = () => Promise<void>

export interface MigrationDefinition {
    configPath?: string
    getTasks: (context: MigrationContext) => {
        [taskName: string]: MigrationTask
    }
}

export interface MigrationContext {

    // stage: Stage
    // layer: Layer
    // settingsDao: SettingsDao
    // systemMetadataDao: SystemMetadataDao
    // externalContract: ExternalContracts
    // deployConfig: DeployConfig
    // factory: ContractWrapperFactory
}