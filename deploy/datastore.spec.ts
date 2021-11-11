import { expect } from "chai";
import {DeployDataStore} from "./DataStore";
import * as fs from "fs";

describe('test data store', function () {
    let dataStore;
    before(() => {
        dataStore = new DeployDataStore(
            'testStore.db'
        )
    })
    after(() => {
        fs.unlinkSync('testStore.db')
    })
    it('should save by key', async function () {
        await dataStore.saveAddressByKey('test', 'hello')
    });
    it('should find key', async function () {
        const value = await dataStore.findAddressByKey('test')
        expect(value).eq('hello')
    });
    it('should find key null', async function () {
        const value = await dataStore.findAddressByKey('test2')
        expect(value).eq(null)
    });

    it('should update only', async function () {
        await dataStore.saveAddressByKey('test', 'hello')
        await dataStore.saveAddressByKey('test', 'hello2')
        expect(await dataStore.db.count({key: 'test'})).eq(1)
        expect(await dataStore.findAddressByKey('test')).eq(
            'hello2'
        )
    });

});