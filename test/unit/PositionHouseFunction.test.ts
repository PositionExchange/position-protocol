// import {ethers, waffle} from "hardhat";
// import {PositionHouseFunctionTest, PositionManager} from "../../typeChain";
// import {abi as PositionManagerAbi} from "../../artifacts/contracts/protocol/PositionManager.sol/PositionManager.json"
// import {expect} from "chai";
// import {BigNumber} from "ethers";
//
// const {deployMockContract} = waffle
//
// describe('PositionHouseFunction', function () {
//     let positionHouseFunctionTest: PositionHouseFunctionTest;
//     let positionManager;
//     let trader1
//     beforeEach(async function () {
//         const positionHouseFunction = await ethers.getContractFactory('PositionHouseFunction')
//         const libraryIns = (await positionHouseFunction.deploy())
//         const contract = await ethers.getContractFactory('PositionHouseFunctionTest', {
//             libraries: {
//                 PositionHouseFunction: libraryIns.address
//             }
//         });
//         positionHouseFunctionTest = (await contract.deploy()) as unknown as PositionHouseFunctionTest
//         [trader1] = await ethers.getSigners()
//         positionManager = await deployMockContract(trader1, PositionManagerAbi)
//     })
//
//     it('should calculate correct claim amount', async function () {
//         await positionManager.mock.getPendingOrderDetail.withArgs('4642967', 2).returns(true, false, '3000000000000000000', '2910830830002572178')
//         await positionManager.mock.getBaseBasisPoint.returns(10000)
//         await positionManager.mock.pipToPrice.withArgs('4642967').returns('464296700')
//         const result = await positionHouseFunctionTest.getClaimAmount(
//             positionManager.address,
//             trader1.address,
//             {
//                 quantity: '0',
//                 margin: '0',
//                 openNotional: '0',
//                 lastUpdatedCumulativePremiumFraction: 0,
//                 blockNumber: 0,
//                 leverage: 125,
//                 __dummy: 0
//             },
//             {
//                 quantity: '3000000000000000000',
//                 margin: '1114214453338711776581',
//                 openNotional: '139276806667338972072726',
//                 lastUpdatedCumulativePremiumFraction: '-16958214791666',
//                 blockNumber: 16633835,
//                 leverage: 125,
//                 __dummy: 1
//             },
//             [{
//                 pip: '4642967',
//                 orderId: '2',
//                 leverage: 125,
//                 isBuy: '2',
//                 entryPrice: '0',
//                 reduceLimitOrderId: '1',
//                 reduceQuantity: '3000000000000000000',
//                 blockNumber: "16634060"
//             }],
//             [{
//                 pip: '4642967',
//                 orderId: '2',
//                 leverage: 125,
//                 isBuy: '2',
//                 entryPrice: '464256022',
//                 reduceLimitOrderId: '1',
//                 reduceQuantity: '3000000000000000000',
//                 blockNumber: '16634060'
//             }],
//             '1114312080000000000000',
//             '0',
//             '0'
//         )
//         const n = Math.round(Number(ethers.utils.formatEther(result.toString())))
//         const positionMarginWithoutLimit = BigNumber.from("1114214453338711776581")
//         const closeLimitOrderMargin = BigNumber.from("1114312080000000000000")
//         // pnl = quantity * (closedPrice - entryPrice) = 3 * (46429.67 - 46425.60)
//         const pnl = BigNumber.from("3000000000000000000").mul(BigNumber.from("464296700").sub("464256022")).div(BigNumber.from("10000"))
//         // expectedClaimableAmount = positionMarginWithoutLimit + closeLimitOrderMargin + pnl
//         const expectedClaimableAmount = Math.round(Number(ethers.utils.formatEther(positionMarginWithoutLimit.add(closeLimitOrderMargin).add(pnl).toString())))
//         expect(n).eq(expectedClaimableAmount)
//         console.log(n, result.toString())
//     });
//
//
//     it('should calcyalte correct amount for case 2', async function () {
//         await positionManager.mock.getPendingOrderDetail.withArgs('350000', 1).returns(true, false, '10', '0')
//         await positionManager.mock.getBaseBasisPoint.returns(10000)
//         await positionManager.mock.pipToPrice.withArgs('350000').returns('35000000')
//         const result = await positionHouseFunctionTest.getClaimAmount(
//             positionManager.address,
//             trader1.address,
//             {
//                 quantity: '-10',
//                 margin: '3667',
//                 openNotional: '36667',
//                 lastUpdatedCumulativePremiumFraction: 0,
//                 blockNumber: 63,
//                 leverage: 10,
//                 __dummy: 0
//             },
//             {
//                 quantity: '-10',
//                 margin: '5500',
//                 openNotional: '55000',
//                 lastUpdatedCumulativePremiumFraction: '0',
//                 blockNumber: 16633835,
//                 leverage: 10,
//                 __dummy: 1
//             },
//             [],
//             [{
//                 pip: '350000',
//                 orderId: '1',
//                 leverage: 10,
//                 isBuy: '1',
//                 entryPrice: '36666666',
//                 reduceLimitOrderId: '0',
//                 reduceQuantity: '5',
//                 blockNumber: "16634060"
//             }],
//             '1750',
//             '0',
//             '0'
//         )
//         console.log("result", result.toString())
//         expect(result.toString()).eq('6083')
//     });
//
// });