import {MigrationContext, MigrationDefinition} from "../types";

const migrations: MigrationDefinition = {
    getTasks: (context: MigrationContext) => {
        return {
            'deploy Position Insurance Reserve Fund': async () => {
                const instance = await context.factory.createInsuranceReserveFund();
                console.log(`Address: ${instance.address}`)
            }
        }
    }
}

export default migrations