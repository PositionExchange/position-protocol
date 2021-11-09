import fs from 'fs'
import path from 'path'
import YAML from 'yaml'
import {BigNumber, ContractFactory} from "ethers";
import {LimitOrderReturns, PositionData, priceToPip} from "../shared/utilities";
import {expect} from "chai";
import {PositionHouse, PositionManager} from "../../typeChain";
import {ethers} from "hardhat";

import {
    OrderType,
    OrderSide,
    OpenLimitPositionAndExpectParams

} from "../shared/utilities";
import PositionManagerTestingTool from "../shared/positionManagerTestingTool";
import exp from "constants";
import PositionHouseTestingTool from "../shared/positionHouseTestingTool";

interface ParseScriptParams {
    script: string;
    defaultConfig?: any
    expected?: any
}

class TraderLimitOrder {
    private traderMap = {} as any
    push(trader: string,{orderId, pip}: LimitOrderReturns){
        if(!this.traderMap[trader]){
            this.traderMap[trader] = []
        }
        this.traderMap[trader].push({orderId, pip})
    }
    remove(trader: string, index: number = 0){
        this.traderMap[trader].splice(index, 1)
    }
    get(trader: string, orderIndex: number | undefined){
        orderIndex = typeof orderIndex === 'undefined' ? this.traderMap[trader].length - 1 : orderIndex
        if(!this.traderMap[trader][orderIndex]) {
            throw new Error(`No order find by index ${orderIndex} ${trader} ${JSON.stringify(this.traderMap)}`, )
        }
        return this.traderMap[trader][orderIndex]
    }
}

describe('test position house using yaml', function () {
    let positionHouse: PositionHouse;
    let positionManager: PositionManager;
    let positionManagerFactory: ContractFactory;
    let positionManagerTestingTool: PositionManagerTestingTool
    let positionHouseTestingTool: PositionHouseTestingTool
    let traderObj = {} as any
    let traderLimitOrderMap = new TraderLimitOrder()

    beforeEach(async () => {
        const traders = await ethers.getSigners()
        for (const i in traders) {
            traderObj[`trader${i}`] = traders[i]
        }
        positionManagerFactory = await ethers.getContractFactory("PositionManager")
        // BTC-USD Perpetual, initial price is 5000
        // each pip = 0.01
        // => initial pip = 500000
        //quoteAsset    BUSD_TestNet = 0x8301f2213c0eed49a7e28ae4c3e91722919b8b47
        positionManager = (await positionManagerFactory.deploy(500000, '0x8301f2213c0eed49a7e28ae4c3e91722919b8b47')) as unknown as PositionManager;
        const factory = await ethers.getContractFactory("PositionHouse")
        positionHouse = (await factory.deploy()) as unknown as PositionHouse;
        positionManagerTestingTool = new PositionManagerTestingTool(positionManager)
        positionHouseTestingTool = new PositionHouseTestingTool(positionHouse, positionManager)
    })

    const processSignal = {
        async expect(script: string, defaultConfig: any, expectValueObj: undefined | any){
            if(/limitorder/.test(script)){
                // expect limit order
               let traderName, type, orderIndex, expectField, sig, value
                if(/limitorder ([0-9]+)/.test(script)){
                    [,traderName, type, orderIndex, expectField, sig, value] = script.split(' ')
                }else{
                    [,traderName, type, expectField, sig, value] = script.split(' ')
                }
                console.log("orderIndex", orderIndex)
                const limitOrderDetail = traderLimitOrderMap.get(traderObj[traderName].address, orderIndex && Number(orderIndex) || undefined)
                const orderDetails = await positionHouseTestingTool.getPendingOrder(limitOrderDetail)
                if(!expectValueObj){
                    if(sig == 'is') sig = 'eq'
                    if(value == 'true') value = true
                    if(value == 'false') value = false
                    //@ts-ignore
                    expect(orderDetails[expectField])[sig](value, `${script} failed`)
                }else{
                    for(let key of Object.keys(expectValueObj)){
                        // @ts-ignore
                        expect(orderDetails[key]).eq(expectValueObj[key],  `${script} ${key} to eq ${expectValueObj[key]} failed`)
                    }
                }
            }
        },
        async debug(script: string, defaultConfig: any){
            if(/limitorder/.test(script)){
                const [, traderName, type, orderIndex] = script.split(' ')
                const limitOrderDetail = traderLimitOrderMap.get(traderObj[traderName].address, orderIndex && Number(orderIndex) || undefined)
                await positionManagerTestingTool.debugPendingOrder(limitOrderDetail.pip, limitOrderDetail.orderId);
            }
        }
    }

    async function parseScript({script, defaultConfig, expected}: ParseScriptParams) {
        console.group(`Script: ${script}`)
        const [traderName, orderType, orderSide, price, quantity, leverage] = script.split(' ')
        if (!(Object.values(OrderType) as string[]).includes(orderType)) {
            throw new Error(`Invalid order type ${orderType} is not support. only: ${Object.values(OrderType).join(',')}`)
        }
        if (!(Object.values(OrderSide) as string[]).includes(orderSide)) {
            throw new Error(`Invalid order side only allows: ${Object.values(OrderSide).join(',')}`)
        }
        const traderInstance = traderObj[traderName]
        if (orderType == OrderType.Market) {
            if (orderSide !== OrderSide.Close) {
                const extraOptions = {} as any
                if (expected) {
                    extraOptions['expectedSize'] = expected.quantity
                    extraOptions['expectedMargin'] = expected.margin
                    extraOptions['expectedNotional'] = expected.notional
                }
                await positionHouseTestingTool.openMarketPosition({
                    trader: traderInstance.address,
                    instanceTrader: traderInstance,
                    leverage: leverage || defaultConfig.leverage,
                    side: orderSide == OrderSide.Long ? 0 : 1,
                    quantity: BigNumber.from((quantity || price).toString()), // if don't pass price in market quanlity is the price
                    price: Number(price),
                    ...extraOptions,
                })
            } else {
                // close market
                await positionHouseTestingTool.closeMarketPosition({trader: traderInstance})
            }
        } else if (orderType === OrderType.Limit) {
            let limitOrderRes
            if (orderSide !== OrderSide.Close) {
                limitOrderRes = await positionHouseTestingTool.openLimitPositionAndExpect({
                    leverage: leverage || defaultConfig.leverage,
                    limitPrice: price,
                    quantity: Number(quantity),
                    side: orderSide == OrderSide.Long ? 0 : 1,
                    _trader: traderInstance
                })
            } else {
                //close limit
                limitOrderRes = await positionHouseTestingTool.closeLimitPosition({
                    trader: traderInstance,
                    price,
                    percentQuantity : quantity.toString()
                })
            }
            traderLimitOrderMap.push(traderInstance.address, limitOrderRes)
        } else {
            throw new Error(`No implement for ${orderType}`)
        }
        console.groupEnd()

    }

    const file = fs.readFileSync(__dirname + '/PositionHouse.spec.yaml', 'utf8')
    const data = YAML.parse(file)
    const titles = Object.keys(data)
    for (let title of titles) {
        it(title, async () => {
            let defaultConfig = {}; // testing
            const scripts = data[title]
            for (let script of scripts) {
                if (typeof script === 'object') {
                    const [scriptStr] = Object.keys(script)
                    if (typeof script.default !== 'undefined') {
                        defaultConfig = script.default
                    } else if(/^trader/.

                    test(scriptStr)) {
                        for (let scriptStr of Object.keys(script)) {
                            await parseScript({
                                script: scriptStr,
                                defaultConfig,
                                expected: script[scriptStr]
                            })
                        }
                    }else{
                        console.log(scriptStr)
                        const [signal] = scriptStr.split(' ')
                        console.log(signal)
                        // @ts-ignore
                        await processSignal[signal](scriptStr, defaultConfig, script[scriptStr])
                    }
                }
                if (typeof script === 'string') {
                    if(/^trader/.test(script)){
                        await parseScript({
                            script,
                            defaultConfig
                        })
                    }else {
                        const [signal] = script.split(' ')
                        // @ts-ignore
                        await processSignal[signal](script, defaultConfig)
                    }

                }
            }
        })
    }
});

describe('test parse', () => {
    it('should log sample spec', async function () {
        const file = fs.readFileSync(__dirname + '/PositionHouse.spec.yaml', 'utf8')
        const data = YAML.parse(file)
        console.log(data)
    });
})

describe('generate run template', function () {
    it('should generate template', async function () {
        const genTemplate = (name: string) => `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="${name}" type="mocha-javascript-test-runner" nameIsGenerated="true">
    <node-interpreter>project</node-interpreter>
    <node-options />
    <mocha-package>$PROJECT_DIR$/node_modules/mocha</mocha-package>
    <working-directory>$PROJECT_DIR$</working-directory>
    <pass-parent-env>true</pass-parent-env>
    <ui>bdd</ui>
    <extra-mocha-options />
    <test-kind>TEST</test-kind>
    <test-file>$PROJECT_DIR$/test/unit/PositionHouseTestingYamlParser.ts</test-file>
    <test-names>
      <name value="test position house using yaml" />
      <name value="${name}" />
    </test-names>
    <method v="2">
      <option name="NpmBeforeRunTask" enabled="true">
        <package-json value="$PROJECT_DIR$/package.json" />
        <command value="run" />
        <scripts>
          <script value="compile" />
        </scripts>
        <node-interpreter value="project" />
        <envs />
      </option>
      <option name="NpmBeforeRunTask" enabled="true">
        <package-json value="$PROJECT_DIR$/package.json" />
        <command value="run" />
        <scripts>
          <script value="compile" />
        </scripts>
        <node-interpreter value="project" />
        <envs />
      </option>
    </method>
  </configuration>
</component>`

        const file = fs.readFileSync(__dirname + '/PositionHouse.spec.yaml', 'utf8')
        const data = YAML.parse(file)
        const titles = Object.keys(data)
        const runPath = path.join(__dirname, '../../.run')
        for (let title of titles) {
            const filePath = path.join(runPath, title + '.run.xml')
            if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, genTemplate(title))
            }
        }
    });

});

