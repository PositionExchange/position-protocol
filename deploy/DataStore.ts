const Datastore = require('nedb-promises');


const POSITION_MANAGER = './positionManager.db';
const POSITION_HOUSE = './positionHouse.db';
const INSURANCE_FUND = './positionInsuranceFund.db';

export class DatastorePosition {

    db: typeof Datastore;

    constructor() {
        this.db = new Datastore({filename: POSITION_MANAGER, autoload: true});
    }
}