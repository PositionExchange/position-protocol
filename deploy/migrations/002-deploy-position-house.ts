import {MigrationContext, MigrationDefinition} from "../types";
import {ContractWrapperFactory} from "../ContractWrapperFactory";


const migrations: MigrationDefinition = {
    getTasks: (context: MigrationContext) => ({
        'deploy position house': async () => {
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
            const positionHouse = new ContractWrapperFactory();
            console.log('001');

            await positionHouse.createPositionHouse({
                maintenanceMarginRatio: 3,
                partialLiquidationRatio: 80,
                liquidationFeeRatio: 3,
                liquidationPenaltyRatio: 20
            })

        }
    })
}


export default migrations;
