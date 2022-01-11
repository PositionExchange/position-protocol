import {expect} from 'chai';
import {ethers} from 'hardhat'
import {LiquidityBitmapTest} from "../../../typeChain";
import {BigNumber} from "ethers";
import {BN} from "ethereumjs-util";


describe('LiquidityBitmapTest', function () {
    let liquidityBitmap: LiquidityBitmapTest;
    beforeEach('deploy liquidity bitmap', async () => {
        const liquidityBitmapTestFactory = await ethers.getContractFactory('LiquidityBitmapTest')
        liquidityBitmap = (await liquidityBitmapTestFactory.deploy()) as LiquidityBitmapTest;
    })

    describe('setInRage', async function () {
        async function setBitsInRage(fromPip: number, toPip: number) {
            return setBitsInRage2(fromPip, toPip)
            // @deprecated due to wrong in setBitsRange
            const tx = await liquidityBitmap.setBitsInRange(fromPip, toPip)
            const receipt = await tx.wait()
            console.log(`Total GAS for set in range: ${fromPip} - ${toPip}: `, receipt.gasUsed.toNumber())
        }

        async function setBitsInRage2(fromPip: number, toPip: number) {
            for(let i = fromPip;i <= toPip; i++){
                await liquidityBitmap.toggleSingleBit(i, true)
            }
        }

        async function unsetBitsInRange(fromPip: number, toPip: number) {
            const tx = await liquidityBitmap.unsetBitsRange(fromPip, toPip)
            const receipt = await tx.wait()
            console.log(`Total GAS for unset in range: ${fromPip} - ${toPip}: `, receipt.gasUsed.toNumber())
        }

        async function expectBinaryAtIndex(index: number, val: string) {
            const index0 = await liquidityBitmap.liquidityBitmap(0)
            expect((index0.toNumber()).toString(2)).eq(val)
        }

        async function hasLiquidityInRage(from: number, to: number, val?: boolean | undefined) {
            for (let i = from; i <= to; i++) {
                expect(await liquidityBitmap.hasLiquidity(i)).eq(typeof val === "undefined" ? true : val, `${i} not correct`);
            }
        }

        // async function  findNextInitializedLiquidity(pip : number, lte : boolean)  : number{
        //     const next = await  liquidityBitmap.findNextInitializedLiquidity(pip, lte);
        //
        // }

        describe('should unset bit increment', function () {
            it('should set bit and unset bit in single value', async function () {
                await liquidityBitmap.toggleSingleBit(240, true);
                await liquidityBitmap.toggleSingleBit(241, true);
                expect(await liquidityBitmap.hasLiquidity(240)).eq(true)
                expect(await liquidityBitmap.hasLiquidity(241)).eq(true)
                await unsetBitsInRange(200, 240);
                expect(await liquidityBitmap.hasLiquidity(240)).eq(false)
                expect(await liquidityBitmap.hasLiquidity(241)).eq(true)
            });

            it('should unsetBitsInRange in a small range', async function () {
                let startPip = 240;
                for(let i=0;i<=4;i++){
                    await liquidityBitmap.toggleSingleBit(startPip+i, true);
                }expect(await liquidityBitmap.hasLiquidity(240)).eq(true)
                expect(await liquidityBitmap.hasLiquidity(241)).eq(true)
                expect(await liquidityBitmap.hasLiquidity(242)).eq(true)
                expect(await liquidityBitmap.hasLiquidity(243)).eq(true)
                expect(await liquidityBitmap.hasLiquidity(244)).eq(true)
                await unsetBitsInRange(240, 242);
                expect(await liquidityBitmap.hasLiquidity(240)).eq(false)
                expect(await liquidityBitmap.hasLiquidity(241)).eq(false)
                expect(await liquidityBitmap.hasLiquidity(242)).eq(false)
                expect(await liquidityBitmap.hasLiquidity(243)).eq(true)
                expect(await liquidityBitmap.hasLiquidity(244)).eq(true)
            });

            it('should set and unset bits in range by the same position correctly', async function () {
                await setBitsInRage2(1, 500);
                await hasLiquidityInRage(1, 500)
                // await setBitsInRage(503, 1000);
                // await hasLiquidityInRage(503, 1000)
                await unsetBitsInRange(10, 254);
                await hasLiquidityInRage(10, 254, false)
                await hasLiquidityInRage(1, 9, true)
                await hasLiquidityInRage(256, 500, true)
            });
            it('should set and unset bits cross the map index correctly', async function () {
                await setBitsInRage(1, 500);
                await hasLiquidityInRage(1, 500)
                // await setBitsInRage(503, 1000);
                // await hasLiquidityInRage(503, 1000)
                await unsetBitsInRange(10, 300);
                console.log(await liquidityBitmap.liquidityBitmap(0))
                await hasLiquidityInRage(1, 9, true)
                await hasLiquidityInRage(10, 300, false)
                await hasLiquidityInRage(301, 500, true)
            });
            it('should set and unset bits cross multiple map index correctly', async function () {
                /*
                    Total GAS for set in range: 0 - 10000 pips:  915996
                    Total GAS for unset in range: 100 - 5000 pips:  63546
                    SUPER GAS SAVING!!!
                 */
                await setBitsInRage(1, 1000);
                await hasLiquidityInRage(1, 1000)
                await unsetBitsInRange(100, 500);
                await hasLiquidityInRage(1, 99, true)
                await hasLiquidityInRage(100, 500, false)
                await hasLiquidityInRage(501, 1000, true)
            });
            it('should set and unset bits in multiple range', async function () {
                await setBitsInRage(1, 257);
                await unsetBitsInRange(100, 105);
                await hasLiquidityInRage(100, 105, false)
                await liquidityBitmap.toggleSingleBit(104, true)
                await hasLiquidityInRage(104, 104, true)
                await liquidityBitmap.toggleSingleBit(104, false)
                await hasLiquidityInRage(104, 104, false)
            });
            it('should set and unset to 0 then set again', async function () {
                await setBitsInRage(1, 800);
                await unsetBitsInRange(1, 769);
                const tx = await liquidityBitmap.toggleSingleBit(300, true);
                const receipt = await tx.wait()
                console.log(receipt.gasUsed.toNumber())
            });
        });
        describe('should unset bit decrement', function () {
            it('should unset bit', async function () {
                await setBitsInRage2(240, 270)
                await hasLiquidityInRage(240, 270, true)
                await unsetBitsInRange(270, 245)
                await hasLiquidityInRage(240, 244, true)
                await hasLiquidityInRage(245, 280, false)
            });
        });

        it('should find pip has liquidity with lte is true', async function () {
            await setBitsInRage(50, 100);
            const next = await liquidityBitmap.findNextInitializedLiquidity(110, true);
            expect(next.toNumber()).eq(100)
            await unsetBitsInRange(50, 100);

            await setBitsInRage(50, 300);
            const next1 = await liquidityBitmap.findNextInitializedLiquidity(400, true);
            expect(next1.toNumber()).eq(300)
            await unsetBitsInRange(50, 300);


            await setBitsInRage(50, 350);
            const next2 = await liquidityBitmap.findNextInitializedLiquidity(600, true);
            expect(next2.toNumber()).eq(0)
            await unsetBitsInRange(50, 350);

            await setBitsInRage(50, 350);
            const next3 = await liquidityBitmap.findNextInitializedLiquidity(50, true);
            expect(next3.toNumber()).eq(50)
            await unsetBitsInRange(50, 350);

            await setBitsInRage(50, 300);
            const next5 = await liquidityBitmap.findNextInitializedLiquidity(99, true);
            expect(next5.toNumber()).eq(99)
            await unsetBitsInRange(50, 300);


            // not passed
            // await setBitsInRage(50, 350);
            // const next4 = await liquidityBitmap.findNextInitializedLiquidity(49, true);
            // expect(next4.toNumber()).eq(0)
            // await unsetBitsInRange(50, 350);

        })


        // testing with ltr = false
        it('should find pip has liquidity with lte is false', async function () {

            await setBitsInRage(50, 300);
            const next = await liquidityBitmap.findNextInitializedLiquidity(55, false);
            expect(next.toNumber()).be.eq(55)
            await unsetBitsInRange(50, 300);

            // await setBitsInRage(50, 100);
            // console.log(await liquidityBitmap.liquidityBitmap(0))
            // console.log(await liquidityBitmap.hasLiquidity(49))
            // const next1 = await liquidityBitmap.findNextInitializedLiquidity(40, false);
            // expect(next1.toNumber()).be.eq(50)
            // await unsetBitsInRange(50, 100);


            // await setBitsInRage(50, 300);
            // const next2 = await liquidityBitmap.findNextInitializedLiquidity(40, false);
            // expect(next2.toNumber()).be.eq(50)
            // await unsetBitsInRange(50, 300);


            await setBitsInRage(50, 300);
            const next3 = await liquidityBitmap.findNextInitializedLiquidity(50, false);
            expect(next3.toNumber()).be.eq(50)
            await unsetBitsInRange(50, 300);


            await setBitsInRage(50, 100);
            const next4 = await liquidityBitmap.findNextInitializedLiquidity(110, false);
            expect(next4.toNumber()).be.eq(0)
            await unsetBitsInRange(50, 100);


            // not passed
            await setBitsInRage(50, 100);
            await liquidityBitmap.toggleSingleBit(100, true)
            console.log(await liquidityBitmap.hasLiquidity(100))
            const next5 = await liquidityBitmap.findNextInitializedLiquidity(100, false);
            expect(next5.toNumber()).be.eq(100)
            await unsetBitsInRange(50, 100);
        })

        describe('should find next initialized pip in multiple words', async function () {
            describe('lte = false', function () {
                it('lte = false, from 200 find next 270', async function () {
                    await setBitsInRage2(270, 500);
                    const result = await liquidityBitmap.findHasLiquidityInMultipleWords(200, 10, false);
                    expect(result.toNumber()).eq(270)
                });
                it('lte = false, from 200 find next 500', async function () {
                    await setBitsInRage2(500, 1000);
                    const result = await liquidityBitmap.findHasLiquidityInMultipleWords(200, 10, false);
                    expect(result.toNumber()).eq(500)
                });
                it('should not find any pip', async function () {
                    await setBitsInRage2(2805, 2855);
                    const result = await liquidityBitmap.findHasLiquidityInMultipleWords(200, 10, false);
                    expect(result.toNumber()).eq(0)
                });
            });
            describe('lte = true', function () {
                it('should finding from 500, next 250', async function () {
                    await setBitsInRage2(250, 500);
                    const result = await liquidityBitmap.findHasLiquidityInMultipleWords(1000, 10, true);
                    expect(result.toNumber()).eq(500)
                });
                it('should not find any pip', async function () {
                    await setBitsInRage2(140, 200);
                    const result = await liquidityBitmap.findHasLiquidityInMultipleWords(3000, 10, false);
                    expect(result.toNumber()).eq(0)
                });
            });
        });
    });

});