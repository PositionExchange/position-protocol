import {BigNumber, BigNumberish, Wallet} from 'ethers'
import {ethers, waffle} from 'hardhat'
// import {PositionHouse} from "../../typeChain";
import {loadFixture} from "ethereum-waffle";
// import checkObservationEquals from "../../shared/checkObservationEquals";
// import snapshotGasCost from "../../shared/snapshotGasCost";
// import {expect} from "../../shared/expect";
// import {TEST_POOL_START_TIME} from "../../shared/fixtures";
import {describe} from "mocha";
import {expect} from 'chai'
import {PositionManager, PositionHouse} from "../../typeChain";
import {priceToPip, toWeiBN, toWeiWithString} from "../shared/utilities";

const SIDE = {
    LONG: 0,
    SHORT: 1
}

interface PositionData {
    size: BigNumber
    margin: BigNumber
    openNotional: BigNumber
}

describe("PositionHouse", () => {
    let positionHouse: PositionHouse;
    let positionManager: PositionManager;
    beforeEach(async () => {
        const positionManagerFactory = await ethers.getContractFactory("PositionManager")
        // BTC-USD Perpetual, initial price is 5000
        // each pip = 0.01
        // => initial pip = 500000
        positionManager = (await positionManagerFactory.deploy(500000)) as unknown as PositionManager;
        const factory = await ethers.getContractFactory("PositionHouse")
        positionHouse = (await factory.deploy()) as unknown as PositionHouse;
    })

    describe('openMarketPosition', async () => {
        it('should open market a position', async function () {
            const [trader] = await ethers.getSigners()
            const size = toWeiBN('1')
            console.log(size)
            const leverage = 10
            await positionManager.openLimitPosition(
                priceToPip(5000),
                toWeiBN('10'),
                true
            );
            await positionHouse.openMarketPosition(
                positionManager.address,
                SIDE.SHORT,
                size,
                leverage,
            )
            const positionInfo = await positionHouse.getPosition(positionManager.address, trader.address) as unknown as PositionData;
            console.log(positionInfo)
            const openNotional = positionInfo.openNotional.div('10000').toString()
            const expectedNotional = size.mul(5000).mul(leverage.toString()).toString()
            expect(positionInfo.size.toString()).eq(size.toString())
            expect(openNotional).eq(expectedNotional)
            expect(positionInfo.margin.div('10000').toString()).eq(toWeiWithString('500'))
        });
    })

    describe('openLimitPosition', async () => {

        it('should open limit a position', async function () {
            await positionHouse.openLimitPosition(
                positionManager.address,
                1,
                ethers.utils.parseEther('10000'),
                ethers.utils.parseEther('5.22'),
                10,
            );

        });

    })
})
