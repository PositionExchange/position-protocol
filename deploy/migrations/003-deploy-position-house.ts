import {MigrationContext, MigrationDefinition} from "../types";
import {ContractWrapperFactory} from "../ContractWrapperFactory";


const migrations: MigrationDefinition = {
    getTasks: (context: MigrationContext) => ({
        'deploy position house': async () => {
            /**
             maintenanceMarginRatio: number,
             partialLiquidationRatio: number,
             liquidationFeeRatio: number,
             liquidationPenaltyRatio: number,
             insuranceFund: string
             */

            const insuranceFundContactAddress = await context.db.findAddressByKey('InsuranceFund');
            console.log(`InsuranceFund  ${insuranceFundContactAddress}`);
            await context.factory.createPositionHouse({
                maintenanceMarginRatio: 3,
                partialLiquidationRatio: 80,
                liquidationFeeRatio: 3,
                liquidationPenaltyRatio: 20,
                insuranceFund: insuranceFundContactAddress,
                // feePool : '0x0000000000000000000000000000000000000000'
            })

        }
    })
}


export default migrations;
