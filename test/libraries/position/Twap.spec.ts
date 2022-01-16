// import {BigNumber, BigNumberish, Wallet} from 'ethers'
// import {ethers, waffle} from 'hardhat'
// import {TwapTest} from "../../../typeChain";
// import {loadFixture} from "ethereum-waffle";
// import checkObservationEquals from "../../shared/checkObservationEquals";
// import snapshotGasCost from "../../shared/snapshotGasCost";
// import {expect} from "../../shared/expect";
// import {TEST_POOL_START_TIME} from "../../shared/fixtures";
//
//
// describe("Twap", () => {
//
//
//     // it('should ')
//
//     const twapFixture = async () => {
//         const twapTestFactory = await ethers.getContractFactory('TwapTest')
//         return (await twapTestFactory.deploy()) as TwapTest
//     }
//
//     const initializedTwapFixture = async () => {
//         const twap = await twapFixture()
//         await twap.initialize({
//             time: 0,
//             pip: 0
//         })
//         return twap
//     }
//
//
//     describe('#initialize', () => {
//         let twap: TwapTest
//         beforeEach('deploy test twap', async () => {
//             twap = await loadFixture(twapFixture)
//         })
//         it('index is 0', async () => {
//             await twap.initialize({pip: 1, time: 1})
//
//             const twaIndex = await twap.index();
//             console.log('twapIndex: ', twaIndex)
//             expect(twaIndex).to.eq(0)
//         })
//         it('cardinality is 1', async () => {
//             await twap.initialize({pip: 1, time: 1})
//
//             expect(await twap.cardinality()).to.eq(1)
//         })
//         it('cardinality next is 1', async () => {
//             await twap.initialize({pip: 1, time: 1})
//             expect(await twap.cardinalityNext()).to.eq(1)
//         })
//         it('sets first slot timestamp only', async () => {
//             await twap.initialize({pip: 1, time: 1})
//             let observations = await twap.observations(0);
//
//             console.log('observations: ', observations)
//             checkObservationEquals(observations, {
//                 initialized: true,
//                 blockTimestamp: 1,
//                 pipCumulative: 0
//             })
//             it('gas', async () => {
//                 await snapshotGasCost(twap.initialize({pip: 1, time: 1}))
//             })
//         })
//
//     })
//
//
//     describe('#grow', () => {
//         let twap: TwapTest
//         beforeEach('deploy initialized test twap', async () => {
//             twap = await loadFixture(initializedTwapFixture)
//         })
//
//         it('increases the cardinality next for the first call', async () => {
//             await twap.grow(5)
//             expect(await twap.index()).to.eq(0)
//             expect(await twap.cardinality()).to.eq(1)
//             expect(await twap.cardinalityNext()).to.eq(5)
//         })
//
//         it('does not touch the first slot', async () => {
//             await twap.grow(5)
//             checkObservationEquals(await twap.observations(0), {
//                 pipCumulative: 0,
//                 blockTimestamp: 0,
//                 initialized: true,
//             })
//         })
//
//         it('is no op if twap is already gte that size', async () => {
//             await twap.grow(5)
//             await twap.grow(3)
//             expect(await twap.index()).to.eq(0)
//             expect(await twap.cardinality()).to.eq(1)
//             expect(await twap.cardinalityNext()).to.eq(5)
//         })
//
//         it('adds data to all the slots', async () => {
//             await twap.grow(5)
//             for (let i = 1; i < 5; i++) {
//                 checkObservationEquals(await twap.observations(i), {
//                     pipCumulative: 0,
//                     blockTimestamp: 1,
//                     initialized: false,
//                 })
//             }
//         })
//
//         it('grow after wrap', async () => {
//             await twap.grow(2)
//             await twap.update({advanceTimeBy: 2, pip: 1}) // index is now 1
//
//             console.log("index #1: ", (await twap.index()));
//             await twap.update({advanceTimeBy: 2, pip: 1}) // index is now 0 again
//             console.log("index #2: ", (await twap.index()));
//
//             expect(await twap.index()).to.eq(0)
//             await twap.grow(3)
//             expect(await twap.index()).to.eq(0)
//             expect(await twap.cardinality()).to.eq(2)
//             expect(await twap.cardinalityNext()).to.eq(3)
//         })
//
//         // it('gas for growing by 1 slot when index == cardinality - 1', async () => {
//         //     await snapshotGasCost(twap.grow(2))
//         // })
//         //
//         // it('gas for growing by 10 slots when index == cardinality - 1', async () => {
//         //     await snapshotGasCost(twap.grow(11))
//         // })
//         //
//         // it('gas for growing by 1 slot when index != cardinality - 1', async () => {
//         //     await twap.grow(2)
//         //     await snapshotGasCost(twap.grow(3))
//         // })
//         //
//         // it('gas for growing by 10 slots when index != cardinality - 1', async () => {
//         //     await twap.grow(2)
//         //     await snapshotGasCost(twap.grow(12))
//         // })
//     })
//
//
//     describe('#write', () => {
//         let twap: TwapTest
//
//         beforeEach('deploy initialized test twap', async () => {
//             twap = await loadFixture(initializedTwapFixture)
//         })
//
//         it('single element array gets overwritten', async () => {
//             await twap.update({advanceTimeBy: 1, pip: 2})
//             expect(await twap.index()).to.eq(0)
//             checkObservationEquals(await twap.observations(0), {
//                 initialized: true,
//                 pipCumulative: 0,
//                 blockTimestamp: 1,
//             })
//             await twap.update({advanceTimeBy: 5, pip: 1})
//             expect(await twap.index()).to.eq(0)
//             checkObservationEquals(await twap.observations(0), {
//                 initialized: true,
//                 pipCumulative: 10,
//                 blockTimestamp: 6,
//             })
//             await twap.update({advanceTimeBy: 3, pip: 2})
//             expect(await twap.index()).to.eq(0)
//
//             let observations = await twap.observations(0);
//             console.log('observations: ', observations, observations.pipCumulative.toString());
//             checkObservationEquals(observations, {
//                 initialized: true,
//                 pipCumulative: 13,
//                 blockTimestamp: 9,
//             })
//         })
//
//         it('does nothing if time has not changed', async () => {
//             await twap.grow(2)
//             await twap.update({advanceTimeBy: 1, pip: 3})
//             expect(await twap.index()).to.eq(1)
//             await twap.update({advanceTimeBy: 0, pip: 5})
//             expect(await twap.index()).to.eq(1)
//         })
//
//         // it('writes an index if time has changed', async () => {
//         //     await twap.grow(3)
//         //     await twap.update({advanceTimeBy: 6, pip: 3})
//         //     expect(await twap.index()).to.eq(1)
//         //     await twap.update({advanceTimeBy: 4, pip: -5})
//         //
//         //     expect(await twap.index()).to.eq(2)
//         //     checkObservationEquals(await twap.observations(1), {
//         //         pipCumulative: 0,
//         //         initialized: true,
//         //         blockTimestamp: 6,
//         //     })
//         // })
//
//         it('grows cardinality when writing past', async () => {
//             await twap.grow(2)
//             await twap.grow(4)
//             expect(await twap.cardinality()).to.eq(1)
//             await twap.update({advanceTimeBy: 3, pip: 5})
//             expect(await twap.cardinality()).to.eq(4)
//             await twap.update({advanceTimeBy: 4, pip: 6})
//             expect(await twap.cardinality()).to.eq(4)
//             expect(await twap.index()).to.eq(2)
//             checkObservationEquals(await twap.observations(2), {
//                 pipCumulative: 20,
//                 initialized: true,
//                 blockTimestamp: 7,
//             })
//         })
//
//         it('wraps around', async () => {
//             await twap.grow(3)
//             await twap.update({advanceTimeBy: 3, pip: 1})
//             await twap.update({advanceTimeBy: 4, pip: 2})
//             await twap.update({advanceTimeBy: 5, pip: 3})
//
//             expect(await twap.index()).to.eq(0)
//
//             checkObservationEquals(await twap.observations(0), {
//                 pipCumulative: 14,
//                 initialized: true,
//                 blockTimestamp: 12,
//             })
//         })
//         //
//         // it('accumulates liquidity', async () => {
//         //     await twap.grow(4)
//         //
//         //     await twap.update({advanceTimeBy: 3, pip: 3})
//         //     await twap.update({advanceTimeBy: 4, pip: -7})
//         //     await twap.update({advanceTimeBy: 5, pip: -2})
//         //
//         //     expect(await twap.index()).to.eq(3)
//         //
//         //     checkObservationEquals(await twap.observations(1), {
//         //         initialized: true,
//         //         pipCumulative: 0,
//         //         blockTimestamp: 3,
//         //     })
//         //     checkObservationEquals(await twap.observations(2), {
//         //         initialized: true,
//         //         pipCumulative: 12,
//         //         blockTimestamp: 7,
//         //     })
//         //     checkObservationEquals(await twap.observations(3), {
//         //         initialized: true,
//         //         pipCumulative: -23,
//         //         blockTimestamp: 12,
//         //     })
//         //     checkObservationEquals(await twap.observations(4), {
//         //         initialized: false,
//         //         pipCumulative: 0,
//         //         blockTimestamp: 0,
//         //     })
//         // })
//     })
//
//     describe('#observe', () => {
//         describe('before initialization', async () => {
//             let twap: TwapTest
//             beforeEach('deploy test twap', async () => {
//                 twap = await loadFixture(twapFixture)
//             })
//
//             const observeSingle = async (secondsAgo: number) => {
//                 const pipCumulatives = await twap.observe([secondsAgo])
//                 return Number(pipCumulatives[0].toString())
//             }
//
//             it('fails before initialize', async () => {
//                 await expect(observeSingle(0)).to.be.revertedWith('I')
//             })
//
//             it('fails if an older observation does not exist', async () => {
//                 await twap.initialize({pip: 2, time: 5})
//                 await expect(observeSingle(1)).to.be.revertedWith('OLD')
//             })
//
//             it('does not fail across overflow boundary', async () => {
//                 await twap.initialize({pip: 2, time: 2 ** 32 - 1})
//                 await twap.advanceTime(2)
//                 const pipCumulative = await observeSingle(1)
//                 console.log('pipCumulative ', pipCumulative);
//                 expect(pipCumulative).to.be.eq(2);
//                 // expect(secondsPerLiquidityCumulativeX128).to.be.eq('85070591730234615865843651857942052864')
//             })
//
//
//             // it('interpolates correctly across uint32 seconds boundaries', async () => {
//             //     // setup
//             //     await twap.initialize({  pip: 0, time: 0 })
//             //     await twap.grow(2)
//             //     await twap.update({ advanceTimeBy: 2 ** 32 - 6, pip: 0})
//             //     let { secondsPerLiquidityCumulativeX128 } = await observeSingle(0)
//             //     expect(secondsPerLiquidityCumulativeX128).to.eq(BigNumber.from(2 ** 32 - 6).shl(128))
//             //     await twap.update({ advanceTimeBy: 13, pip: 0 });
//             //     ({ secondsPerLiquidityCumulativeX128 } = await observeSingle(0))
//             //     expect(secondsPerLiquidityCumulativeX128).to.eq(BigNumber.from(7).shl(128))
//             //
//             //     // interpolation checks
//             //     ;({ secondsPerLiquidityCumulativeX128 } = await observeSingle(3))
//             //     expect(secondsPerLiquidityCumulativeX128).to.eq(BigNumber.from(4).shl(128))
//             //     ;({ secondsPerLiquidityCumulativeX128 } = await observeSingle(8))
//             //     expect(secondsPerLiquidityCumulativeX128).to.eq(BigNumber.from(2 ** 32 - 1).shl(128))
//             // })
//
//             it('single observation at current time', async () => {
//                 await twap.initialize({pip: 2, time: 5})
//                 const pipCumulative = await observeSingle(0)
//                 expect(pipCumulative).to.eq(0)
//                 // expect(secondsPerLiquidityCumulativeX128).to.eq(0)
//             })
//
//             it('single observation in past but not earlier than secondsAgo', async () => {
//                 await twap.initialize({pip: 2, time: 5})
//                 await twap.advanceTime(3)
//                 await expect(observeSingle(4)).to.be.revertedWith('OLD')
//             })
//
//             it('single observation in past at exactly seconds ago', async () => {
//                 await twap.initialize({pip: 2, time: 5})
//                 await twap.advanceTime(3)
//                 const pipCumulative = await observeSingle(3)
//                 expect(pipCumulative).to.eq(0)
//                 // expect(secondsPerLiquidityCumulativeX128).to.eq(0)
//             })
//
//             it('single observation in past counterfactual in past', async () => {
//                 await twap.initialize({pip: 2, time: 5})
//                 await twap.advanceTime(3)
//                 const pipCumulative = await observeSingle(1)
//                 expect(pipCumulative).to.eq(4)
//                 // expect(secondsPerLiquidityCumulativeX128).to.eq('170141183460469231731687303715884105728')
//             })
//
//             it('single observation in past counterfactual now', async () => {
//                 await twap.initialize({pip: 2, time: 5})
//                 await twap.advanceTime(3)
//                 const pipCumulative = await observeSingle(0)
//                 expect(pipCumulative).to.eq(6)
//                 // expect(secondsPerLiquidityCumulativeX128).to.eq('255211775190703847597530955573826158592')
//             })
//
//             it('two observations in chronological order 0 seconds ago exact', async () => {
//                 await twap.initialize({pip: 5, time: 5})
//                 await twap.grow(2)
//                 await twap.update({advanceTimeBy: 4, pip: 1})
//                 const pipCumulative = await observeSingle(0)
//                 expect(pipCumulative).to.eq(-20)
//                 // expect(secondsPerLiquidityCumulativeX128).to.eq('272225893536750770770699685945414569164')
//             })
//
//             it('two observations in chronological order 0 seconds ago counterfactual', async () => {
//                 await twap.initialize({pip: 5, time: 5})
//                 await twap.grow(2)
//                 await twap.update({advanceTimeBy: 4, pip: 1})
//                 await twap.advanceTime(7)
//                 const pipCumulative = await observeSingle(0)
//                 expect(pipCumulative).to.eq(-13)
//                 // expect(secondsPerLiquidityCumulativeX128).to.eq('1463214177760035392892510811956603309260')
//             })
//
//             it('two observations in chronological order seconds ago is exactly on first observation', async () => {
//                 await twap.initialize({pip: 5, time: 5})
//                 await twap.grow(2)
//                 await twap.update({advanceTimeBy: 4, pip: 1})
//                 await twap.advanceTime(7)
//                 const pipCumulative = await observeSingle(11)
//                 expect(pipCumulative).to.eq(0)
//                 // expect(secondsPerLiquidityCumulativeX128).to.eq(0)
//             })
//
//             it('two observations in chronological   order seconds ago is between first and second', async () => {
//                 await twap.initialize({pip: 5, time: 5})
//                 await twap.grow(2)
//                 await twap.update({advanceTimeBy: 4, pip: 1})
//                 await twap.advanceTime(7)
//                 const pipCumulative = await observeSingle(9)
//                 expect(pipCumulative).to.eq(-10)
//                 // expect(secondsPerLiquidityCumulativeX128).to.eq('136112946768375385385349842972707284582')
//             })
//
//             it('two observations in reverse order 0 seconds ago exact', async () => {
//                 await twap.initialize({pip: 5, time: 5})
//                 await twap.grow(2)
//                 await twap.update({advanceTimeBy: 4, pip: 1})
//                 await twap.update({advanceTimeBy: 3, pip: 5})
//                 const pipCumulative = await observeSingle(0)
//                 expect(pipCumulative).to.eq(-17)
//                 // expect(secondsPerLiquidityCumulativeX128).to.eq('782649443918158465965761597093066886348')
//             })
//
//             it('two observations in reverse order 0 seconds ago counterfactual', async () => {
//                 await twap.initialize({pip: 5, time: 5})
//                 await twap.grow(2)
//                 await twap.update({advanceTimeBy: 4, pip: 1})
//                 await twap.update({advanceTimeBy: 3, pip: 5})
//                 await twap.advanceTime(7)
//                 const pipCumulative = await observeSingle(0)
//                 expect(pipCumulative).to.eq(-52)
//                 // expect(secondsPerLiquidityCumulativeX128).to.eq('1378143586029800777026667160098661256396')
//             })
//
//             it('two observations in reverse order seconds ago is exactly on first observation', async () => {
//                 await twap.initialize({pip: 5, time: 5})
//                 await twap.grow(2)
//                 await twap.update({advanceTimeBy: 4, pip: 1})
//                 await twap.update({advanceTimeBy: 3, pip: 5})
//                 await twap.advanceTime(7)
//                 const pipCumulative = await observeSingle(10)
//                 expect(pipCumulative).to.eq(-20)
//                 // expect(secondsPerLiquidityCumulativeX128).to.eq('272225893536750770770699685945414569164')
//             })
//
//             it('two observations in reverse order seconds ago is between first and second', async () => {
//                 await twap.initialize({pip: 5, time: 5})
//                 // console.log('cardinalityNext: ', (await twap.cardinalityNext).toString());
//                 await twap.grow(2)
//                 await twap.update({advanceTimeBy: 4, pip: 1})
//                 await twap.update({advanceTimeBy: 3, pip: 5})
//                 await twap.advanceTime(7)
//                 const pipCumulative = await observeSingle(9)
//                 expect(pipCumulative).to.eq(-19)
//                 // expect(secondsPerLiquidityCumulativeX128).to.eq('442367076997220002502386989661298674892')
//             })
//
//             it('can fetch multiple observations', async () => {
//                 await twap.initialize({time: 5, pip: 2})
//                 await twap.grow(4)
//                 await twap.update({advanceTimeBy: 13, pip: 6})
//                 await twap.advanceTime(5)
//
//                 const pipCumulatives = await twap.observe([0, 3, 8, 13, 15, 18])
//                 expect(pipCumulatives).to.have.lengthOf(6)
//                 expect(pipCumulatives[0]).to.eq(56)
//                 expect(pipCumulatives[1]).to.eq(38)
//                 expect(pipCumulatives[2]).to.eq(20)
//                 expect(pipCumulatives[3]).to.eq(10)
//                 expect(pipCumulatives[4]).to.eq(6)
//                 expect(pipCumulatives[5]).to.eq(0)
//                 // expect(secondsPerLiquidityCumulativeX128s).to.have.lengthOf(6)
//                 // expect(secondsPerLiquidityCumulativeX128s[0]).to.eq('550383467004691728624232610897330176')
//                 // expect(secondsPerLiquidityCumulativeX128s[1]).to.eq('301153217795020002454768787094765568')
//                 // expect(secondsPerLiquidityCumulativeX128s[2]).to.eq('103845937170696552570609926584401920')
//                 // expect(secondsPerLiquidityCumulativeX128s[3]).to.eq('51922968585348276285304963292200960')
//                 // expect(secondsPerLiquidityCumulativeX128s[4]).to.eq('31153781151208965771182977975320576')
//                 // expect(secondsPerLiquidityCumulativeX128s[5]).to.eq(0)
//             })
//             //
//             // it('gas for observe since most recent', async () => {
//             //     await twap.initialize({pip: -5, time: 5})
//             //     await twap.advanceTime(2)
//             //     await snapshotGasCost(twap.getGasCostOfObserve([1]))
//             // })
//             //
//             // it('gas for single observation at current time', async () => {
//             //     await twap.initialize({pip: -5, time: 5})
//             //     await snapshotGasCost(twap.getGasCostOfObserve([0]))
//             // })
//             //
//             // it('gas for single observation at current time counterfactually computed', async () => {
//             //     await twap.initialize({pip: -5, time: 5})
//             //     await twap.advanceTime(5)
//             //     await snapshotGasCost(twap.getGasCostOfObserve([0]))
//             // })
//         })
//
//         for (const startingTime of [5, 2 ** 32 - 5]) {
//             describe(`initialized with 5 observations with starting time of ${startingTime}`, () => {
//                 const twapFixture5Observations = async () => {
//                     const twap = await twapFixture()
//                     await twap.initialize({pip: -5, time: startingTime})
//                     await twap.grow(5)
//                     await twap.update({advanceTimeBy: 3, pip: 1})
//                     await twap.update({advanceTimeBy: 2, pip: -6})
//                     await twap.update({advanceTimeBy: 4, pip: -2})
//                     await twap.update({advanceTimeBy: 1, pip: -2})
//                     await twap.update({advanceTimeBy: 3, pip: 4})
//                     await twap.update({advanceTimeBy: 6, pip: 6})
//                     return twap
//                 }
//                 let twap: TwapTest
//                 beforeEach('set up observations', async () => {
//                     twap = await loadFixture(twapFixture5Observations)
//                 })
//
//                 const observeSingle = async (secondsAgo: number) => {
//                     const pipCumulatives = await twap.observe([secondsAgo])
//                     return pipCumulatives
//                 }
//
//                 it('index, cardinality, cardinality next', async () => {
//                     expect(await twap.index()).to.eq(1)
//                     expect(await twap.cardinality()).to.eq(5)
//                     expect(await twap.cardinalityNext()).to.eq(5)
//                 })
//                 it('latest observation same time as latest', async () => {
//                     const pipCumulative = await observeSingle(0)
//                     expect(pipCumulative).to.eq(-21)
//                     // expect(secondsPerLiquidityCumulativeX128).to.eq('2104079302127802832415199655953100107502')
//                 })
//                 it('latest observation 5 seconds after latest', async () => {
//                     await twap.advanceTime(5)
//                     const pipCumulative = await observeSingle(5)
//                     expect(pipCumulative).to.eq(-21)
//                     // expect(secondsPerLiquidityCumulativeX128).to.eq('2104079302127802832415199655953100107502')
//                 })
//                 it('current observation 5 seconds after latest', async () => {
//                     await twap.advanceTime(5)
//                     const pipCumulative = await observeSingle(0)
//                     expect(pipCumulative).to.eq(9)
//                     // expect(secondsPerLiquidityCumulativeX128).to.eq('2347138135642758877746181518404363115684')
//                 })
//                 it('between latest observation and just before latest observation at same time as latest', async () => {
//                     const pipCumulative = await observeSingle(3)
//                     expect(pipCumulative).to.eq(-33)
//                     // expect(secondsPerLiquidityCumulativeX128).to.eq('1593655751746395137220137744805447790318')
//                 })
//                 it('between latest observation and just before latest observation after the latest observation', async () => {
//                     await twap.advanceTime(5)
//                     const pipCumulative = await observeSingle(8)
//                     expect(pipCumulative).to.eq(-33)
//                     // expect(secondsPerLiquidityCumulativeX128).to.eq('1593655751746395137220137744805447790318')
//                 })
//                 it('older than oldest reverts', async () => {
//                     await expect(observeSingle(15)).to.be.revertedWith('OLD')
//                     await twap.advanceTime(5)
//                     await expect(observeSingle(20)).to.be.revertedWith('OLD')
//                 })
//                 it('oldest observation', async () => {
//                     const pipCumulative = await observeSingle(14)
//                     expect(pipCumulative).to.eq(-13)
//                     // expect(secondsPerLiquidityCumulativeX128).to.eq('544451787073501541541399371890829138329')
//                 })
//                 it('oldest observation after some time', async () => {
//                     await twap.advanceTime(6)
//                     const pipCumulative = await observeSingle(20)
//                     expect(pipCumulative).to.eq(-13)
//                     // expect(secondsPerLiquidityCumulativeX128).to.eq('544451787073501541541399371890829138329')
//                 })
//
//                 // it('fetch many values', async () => {
//                 //     await twap.advanceTime(6)
//                 //     const { pipCumulatives } = await twap.observe([
//                 //         20,
//                 //         17,
//                 //         13,
//                 //         10,
//                 //         5,
//                 //         1,
//                 //         0,
//                 //     ])
//                 //     expect({
//                 //         pipCumulatives: pipCumulatives.map((tc) => tc.toNumber()),
//                 //         secondsPerLiquidityCumulativeX128s: secondsPerLiquidityCumulativeX128s.map((lc) => lc.toString()),
//                 //     }).to.matchSnapshot()
//                 // })
//
//                 // it('gas all of last 20 seconds', async () => {
//                 //     await twap.advanceTime(6)
//                 //     await snapshotGasCost(
//                 //         twap.getGasCostOfObserve([20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0])
//                 //     )
//                 // })
//                 //
//                 // it('gas latest equal', async () => {
//                 //     await snapshotGasCost(twap.getGasCostOfObserve([0]))
//                 // })
//                 // it('gas latest transform', async () => {
//                 //     await twap.advanceTime(5)
//                 //     await snapshotGasCost(twap.getGasCostOfObserve([0]))
//                 // })
//                 // it('gas oldest', async () => {
//                 //     await snapshotGasCost(twap.getGasCostOfObserve([14]))
//                 // })
//                 // it('gas between oldest and oldest + 1', async () => {
//                 //     await snapshotGasCost(twap.getGasCostOfObserve([13]))
//                 // })
//                 // it('gas middle', async () => {
//                 //     await snapshotGasCost(twap.getGasCostOfObserve([5]))
//                 // })
//             })
//         }
//     })
//
//     describe.skip('full twap', function () {
//         this.timeout(1_200_000)
//
//         let twap: TwapTest
//
//         const BATCH_SIZE = 300
//
//         const STARTING_TIME = TEST_POOL_START_TIME
//
//         const maxedOuttwapFixture = async () => {
//             const twap = await twapFixture()
//             await twap.initialize({pip: 0, time: STARTING_TIME})
//             let cardinalityNext = await twap.cardinalityNext()
//             while (cardinalityNext < 65535) {
//                 const growTo = Math.min(65535, cardinalityNext + BATCH_SIZE)
//                 console.log('growing from', cardinalityNext, 'to', growTo)
//                 await twap.grow(growTo)
//                 cardinalityNext = growTo
//             }
//
//             for (let i = 0; i < 65535; i += BATCH_SIZE) {
//                 console.log('batch update starting at', i)
//                 const batch = Array(BATCH_SIZE)
//                     .fill(null)
//                     .map((_, j) => ({
//                         advanceTimeBy: 13,
//                         pip: -i - j,
//                     }))
//                 await twap.batchUpdate(batch)
//             }
//
//             return twap
//         }
//
//         beforeEach('create a full twap', async () => {
//             twap = await loadFixture(maxedOuttwapFixture)
//         })
//
//         it('has max cardinality next', async () => {
//             expect(await twap.cardinalityNext()).to.eq(65535)
//         })
//
//         it('has max cardinality', async () => {
//             expect(await twap.cardinality()).to.eq(65535)
//         })
//
//         it('index wrapped around', async () => {
//             expect(await twap.index()).to.eq(165)
//         })
//
//         async function checkObserve(
//             secondsAgo: number,
//             expected?: { pipCumulative: BigNumberish }
//         ) {
//             let pipCumulatives = await twap.observe([secondsAgo])
//             const check = {
//                 pipCumulative: pipCumulatives
//
//             }
//             if (typeof expected === 'undefined') {
//                 expect(check).to.matchSnapshot()
//             } else {
//                 expect(check).to.deep.eq({
//                     pipCumulative: expected.pipCumulative.toString(),
//                 })
//             }
//         }
//
//         it('can observe into the ordered portion with exact seconds ago', async () => {
//             await checkObserve(100 * 13, {
//                 pipCumulative: '-27970560813',
//             })
//         })
//
//         it('can observe into the ordered portion with unexact seconds ago', async () => {
//             await checkObserve(100 * 13 + 5, {
//                 pipCumulative: '-27970232823',
//             })
//         })
//
//         it('can observe at exactly the latest observation', async () => {
//             await checkObserve(0, {
//                 pipCumulative: '-28055903863',
//             })
//         })
//
//         it('can observe at exactly the latest observation after some time passes', async () => {
//             await twap.advanceTime(5)
//             await checkObserve(5, {
//                 pipCumulative: '-28055903863',
//             })
//         })
//
//         it('can observe after the latest observation counterfactual', async () => {
//             await twap.advanceTime(5)
//             await checkObserve(3, {
//                 pipCumulative: '-28056035261',
//             })
//         })
//
//         it('can observe into the unordered portion of array at exact seconds ago of observation', async () => {
//             await checkObserve(200 * 13, {
//                 pipCumulative: '-27885347763',
//             })
//         })
//
//         it('can observe into the unordered portion of array at seconds ago between observations', async () => {
//             await checkObserve(200 * 13 + 5, {
//                 pipCumulative: '-27885020273',
//             })
//         })
//
//         it('can observe the oldest observation 13*65534 seconds ago', async () => {
//             await checkObserve(13 * 65534, {
//                 pipCumulative: '-175890',
//             })
//         })
//
//         it('can observe the oldest observation 13*65534 + 5 seconds ago if time has elapsed', async () => {
//             await twap.advanceTime(5)
//             await checkObserve(13 * 65534 + 5, {
//                 pipCumulative: '-175890',
//             })
//         })
//
//         it('gas cost of observe(0)', async () => {
//             await snapshotGasCost(twap.getGasCostOfObserve([0]))
//         })
//         it('gas cost of observe(200 * 13)', async () => {
//             await snapshotGasCost(twap.getGasCostOfObserve([200 + 13]))
//         })
//         it('gas cost of observe(200 * 13 + 5)', async () => {
//             await snapshotGasCost(twap.getGasCostOfObserve([200 + 13 + 5]))
//         })
//         it('gas cost of observe(0) after 5 seconds', async () => {
//             await twap.advanceTime(5)
//             await snapshotGasCost(twap.getGasCostOfObserve([0]))
//         })
//         it('gas cost of observe(5) after 5 seconds', async () => {
//             await twap.advanceTime(5)
//             await snapshotGasCost(twap.getGasCostOfObserve([5]))
//         })
//         it('gas cost of observe(oldest)', async () => {
//             await snapshotGasCost(twap.getGasCostOfObserve([65534 * 13]))
//         })
//         it('gas cost of observe(oldest) after 5 seconds', async () => {
//             await twap.advanceTime(5)
//             await snapshotGasCost(twap.getGasCostOfObserve([65534 * 13 + 5]))
//         })
//     })
// })
//
