import {MigrationContext, MigrationDefinition} from "../types";
import {ContractWrapperFactory} from "../ContractWrapperFactory";


const migrations: MigrationDefinition = {
    getTasks: (context: MigrationContext) => ({
        'deploy position house configuration proxy': async () => {
            /**
             maintenanceMarginRatio: number,
             partialLiquidationRatio: number,
             liquidationFeeRatio: number,
             liquidationPenaltyRatio: number
             */
            await context.factory.createPositionHouseConfigurationProxy({
                maintenanceMarginRatio: 3,
                partialLiquidationRatio: 80,
                liquidationFeeRatio: 3,
                liquidationPenaltyRatio: 20,
            })
        },

        'deploy position notional configuration proxy': async () => {
            /**
                no param
             */
            await context.factory.createPositionNotionConfigProxy({})
        },

        'deploy position house': async () => {
            /**
             insuranceFund: string,
             positionHouseConfigurationProxy: string
             */
            const insuranceFundContactAddress = await context.db.findAddressByKey('InsuranceFund');
            const positionHouseConfigurationProxyContactAddress = await context.db.findAddressByKey('PositionHouseConfigurationProxy');
            const positionNotionalConfigProxyContractAddress = await context.db.findAddressByKey('PositionNotionalConfigProxy');
            console.log(`InsuranceFund  ${insuranceFundContactAddress}`);
            console.log(`PositionHouseConfigurationProxy  ${positionHouseConfigurationProxyContactAddress}`);
            await context.factory.createPositionHouse({
                insuranceFund: insuranceFundContactAddress,
                positionHouseConfigurationProxy: positionHouseConfigurationProxyContactAddress,
                positionNotionalConfigProxy: positionNotionalConfigProxyContractAddress
            })
        },

        'deploy position house viewer': async () => {
            /**
             positionHouse: string,
             positionHouseConfigurationProxy: string
             */
            const positionHouseContractAddress = await context.db.findAddressByKey('PositionHouse');
            const positionHouseConfigurationProxyContactAddress = await context.db.findAddressByKey('PositionHouseConfigurationProxy');
            console.log(`PositionHouse  ${positionHouseContractAddress}`);
            console.log(`PositionHouseConfigurationProxy  ${positionHouseConfigurationProxyContactAddress}`);
            await context.factory.createPositionHouseViewer({
                positionHouse: positionHouseContractAddress,
                positionHouseConfigurationProxy: positionHouseConfigurationProxyContactAddress
            })
        },

        'deploy position house strategy order': async () => {
            /**
             positionHouse: string,
             positionHouseViewer: string
             */
            const positionHouseContractAddress = await context.db.findAddressByKey('PositionHouse');
            const positionHouseViewerContactAddress = await context.db.findAddressByKey('PositionHouseViewer');
            console.log(`PositionHouse  ${positionHouseContractAddress}`);
            console.log(`PositionHouseViewer  ${positionHouseViewerContactAddress}`);
            await context.factory.createPositionStrategyOrder({
                positionHouse: positionHouseContractAddress,
                positionHouseViewer: positionHouseViewerContactAddress
            })
        }
    })
}


export default migrations;
