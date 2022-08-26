const Datastore = require('nedb-promises');

export class DeployDataStore {

    db: typeof Datastore;
    // TODO change file deploy db
    constructor(filename = undefined) {
        this.db = new Datastore({filename: filename || './deployData_develop_posi_devnet.db', autoload: true});
    }

    async findAddressByKey(key: string): Promise<string | null> {
        const data = await this.db.findOne({key: key})
        if(data){
            return data.address;
        }
        return null
    }

    async saveAddressByKey(key: string, address: string) {
        return this.db.update({
            key
        }, {address, key}, {upsert: true})
    }

    async getMockContract(name){
        return this.findAddressByKey(`Mock:${name}`)
    }

    async listAllContracts(){
        return this.db.find()
    }

}