import {MigrationContext, MigrationDefinition} from "../types";
import {ContractWrapperFactory} from "../ContractWrapperFactory";


const migrations = {
    getTasks: () => ({
        'deploy insurance fund of position manager': async () => {
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
