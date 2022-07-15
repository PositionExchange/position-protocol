import {MigrationContext, MigrationDefinition} from "../types";

const migrations: MigrationDefinition = {
    getTasks: (context: MigrationContext) => {
        if (context.stage != "production") {
            return {
                'deploy Position Insurance Reserve Fund': async () => {
                    await context.factory.createInsuranceReserveFund();
                }
            }
        }
    }
}

export default migrations