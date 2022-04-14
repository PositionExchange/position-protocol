import {ethers, waffle} from "hardhat";
import {PositionHouseFunctionTest, PositionManager} from "../../typeChain";
import {abi as PositionManagerAbi} from "../../artifacts/contracts/protocol/PositionManager.sol/PositionManager.json"
import {expect} from "chai";

const {deployMockContract} = waffle

describe('PositionHouseFunction', function () {
    let positionHouseFunctionTest: PositionHouseFunctionTest;
    let positionManager;
    let trader1
    beforeEach(async function () {
        const positionHouseFunction = await ethers.getContractFactory('PositionHouseFunction')
        const libraryIns = (await positionHouseFunction.deploy())
        const contract = await ethers.getContractFactory('PositionHouseFunctionTest', {
            libraries: {
                PositionHouseFunction: libraryIns.address
            }
        });
        positionHouseFunctionTest = (await contract.deploy()) as unknown as PositionHouseFunctionTest
        [trader1] = await ethers.getSigners()
        positionManager = await deployMockContract(trader1, PositionManagerAbi)
    })

    it('should calculate correct claim amount', async function () {
        await positionManager.mock.getPendingOrderDetail.withArgs('4642967', 2).returns(true, false, '3000000000000000000', '2910830830002572178')
        await positionManager.mock.getBaseBasisPoint.returns(10000)
        await positionManager.mock.pipToPrice.withArgs('4642967').returns('464296700')
        const result = await positionHouseFunctionTest.getClaimAmount(
            positionManager.address,
            trader1.address,
            {
                quantity: '0',
                margin: '538711776581',
                openNotional: '67338972072726',
                lastUpdatedCumulativePremiumFraction: 0,
                blockNumber: 0,
                leverage: 125,
                __dummy: 0
            },
            {
                quantity: '3000000000000000000',
                margin: '1114214453338711776581',
                openNotional: '139276806667338972072726',
                lastUpdatedCumulativePremiumFraction: '-16958214791666',
                blockNumber: 16633835,
                leverage: 125,
                __dummy: 1
            },
            [{
                pip: '4642967',
                orderId: '2',
                leverage: 125,
                isBuy: '2',
                entryPrice: '0',
                reduceLimitOrderId: '1',
                reduceQuantity: '3000000000000000000',
                blockNumber: "16634060"
            }],
            [{
                pip: '4642967',
                orderId: '2',
                leverage: 125,
                isBuy: '2',
                entryPrice: '464256022',
                reduceLimitOrderId: '1',
                reduceQuantity: '3000000000000000000',
                blockNumber: '16634060'
            }],
            '1114312080000000000000',
            '0',
            '0'
        )
        const n = ethers.utils.formatEther(result.toString()).toString()
        expect(result.toString()).eq('141517536465999739703855')
        console.log(n, result.toString())
    });

});