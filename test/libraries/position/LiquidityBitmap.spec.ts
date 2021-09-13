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
            const tx = await liquidityBitmap.setBitsInRange(fromPip, toPip)
            const receipt = await tx.wait()
            console.log(`Total GAS for set in range: ${fromPip} - ${toPip}: `, receipt.gasUsed.toNumber())
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
            for (let i = from; i < to; i++) {
                expect(await liquidityBitmap.hasLiquidity(i)).eq(typeof val === "undefined" ? true : val, `${i} not correct`);
            }
        }

        // async function  findNextInitializedLiquidity(pip : number, lte : boolean)  : number{
        //     const next = await  liquidityBitmap.findNextInitializedLiquidity(pip, lte);
        //
        // }

        it('should set and unset bits in range by the same position correctly', async function () {
            await setBitsInRage(0, 500);
            await hasLiquidityInRage(1, 500)
            // await setBitsInRage(503, 1000);
            // await hasLiquidityInRage(503, 1000)
            await unsetBitsInRange(10, 255);
            await hasLiquidityInRage(10, 255, false)
            await hasLiquidityInRage(0, 9, true)
            await hasLiquidityInRage(256, 500, true)
        });
        it('should set and unset bits cross the map index correctly', async function () {
            await setBitsInRage(0, 500);
            await hasLiquidityInRage(0, 500)
            // await setBitsInRage(503, 1000);
            // await hasLiquidityInRage(503, 1000)
            await unsetBitsInRange(10, 300);
            console.log(await liquidityBitmap.liquidityBitmap(0))
            await hasLiquidityInRage(0, 9, true)
            await hasLiquidityInRage(10, 300, false)
            await hasLiquidityInRage(301, 500, true)
        });
        it('should set and unset bits cross multiple map index correctly', async function () {
            /*
                Total GAS for set in range: 0 - 10000 pips:  915996
                Total GAS for unset in range: 100 - 5000 pips:  63546
                SUPER GAS SAVING!!!
             */
            await setBitsInRage(0, 10000);
            await hasLiquidityInRage(0, 10000)
            await unsetBitsInRange(100, 5000);
            await hasLiquidityInRage(0, 100, true)
            await hasLiquidityInRage(100, 5000, false)
            await hasLiquidityInRage(5001, 10000, true)
        });
        it('should set and unset bits in multiple range', async function () {
            await setBitsInRage(0, 257);
            await unsetBitsInRange(100, 105);
            await hasLiquidityInRage(100, 105, false)
            await liquidityBitmap.toggleSingleBit(104, true)
            await hasLiquidityInRage(104, 104, true)
            await liquidityBitmap.toggleSingleBit(104, false)
            await hasLiquidityInRage(104, 104, false)
        });
        it('should set and unset to 0 then set again', async function () {
            await setBitsInRage(0, 800);
            await unsetBitsInRange(0, 769);
            const tx = await liquidityBitmap.toggleSingleBit(300, true);
            const receipt = await tx.wait()
            console.log(receipt.gasUsed.toNumber())
        });

        it('should find pip has liquidity with lte is true', async function () {
            await setBitsInRage(50, 100);
            const next = await liquidityBitmap.findNextInitializedLiquidity(110, true);
            expect(next.toNumber()).eq(100)

            await setBitsInRage(50, 300);
            const next1 = await liquidityBitmap.findNextInitializedLiquidity(400, true);
            expect(next1.toNumber()).eq(300)


            await setBitsInRage(50, 350);
            const next2 = await liquidityBitmap.findNextInitializedLiquidity(600, true);
            expect(next2.toNumber()).eq(0)


            await setBitsInRage(50, 300);
            const next3 = await liquidityBitmap.findNextInitializedLiquidity(99, true);
            expect(next3.toNumber()).eq(99)
        })


        // testing with ltr = false
        it('should find pip has liquidity with lte is false', async function () {

            await setBitsInRage(50, 300);
            const next = await liquidityBitmap.findNextInitializedLiquidity(55, false);
            expect(next.toNumber()).be.eq(55)
            await unsetBitsInRange(50, 300);

            await setBitsInRage(50, 100);
            const next1 = await liquidityBitmap.findNextInitializedLiquidity(40, false);
            expect(next1.toNumber()).be.eq(50)
            await unsetBitsInRange(50, 100);


            await setBitsInRage(50, 300);
            const next2 = await liquidityBitmap.findNextInitializedLiquidity(40, false);
            expect(next2.toNumber()).be.eq(50)
            await unsetBitsInRange(50, 300);


        })


    });

});