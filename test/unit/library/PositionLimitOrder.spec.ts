import {ethers, waffle} from "hardhat";
import {PositionLimitOrderTest, PositionManager} from "../../../typeChain";
import {abi as PositionManagerAbi} from '../../../artifacts/contracts/protocol/PositionManager.sol/PositionManager.json'
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from 'chai'

describe('test position limit order library', function () {
    let positionLimitOrderContract: PositionLimitOrderTest;
    let trader: SignerWithAddress, positionManager: any
    const TRADE_SIDE = {
        LONG: 0,
        SHORT: 1
    }
    beforeEach(async () => {
        const positionLimitOrderTestContractFactory = await ethers.getContractFactory('PositionLimitOrderTest')
        positionLimitOrderContract = await positionLimitOrderTestContractFactory.deploy() as unknown as PositionLimitOrderTest
        [trader,] = await ethers.getSigners()
        positionManager = await waffle.deployMockContract(trader, PositionManagerAbi) as unknown as any
    })

    const mockCreateLimitOrder = async (quantity: number, side: number, pip: number, orderId: number, leverage: number = 10, isOpenLimitOrder: boolean = true) => {
        await positionLimitOrderContract.mockLimitOrder(
            positionManager.address,
            TRADE_SIDE.LONG == side ? 1 : 2,
            quantity,
            pip,
            orderId,
            leverage,
            isOpenLimitOrder
        )
    }

    it('should check self filled limit orders correct', async function () {
        // suppose that current price is at pip 6000
        // trader0 opens 2 long orders
        await mockCreateLimitOrder(100, TRADE_SIDE.LONG, 5900, 1)
        await mockCreateLimitOrder(200, TRADE_SIDE.LONG, 5950, 1)
        // then now he open a short market orders
        await positionManager.mock.getPendingOrderDetail.withArgs(5900, 1).returns(true, 0, 100, 0)
        await positionManager.mock.getPendingOrderDetail.withArgs(5950, 1).returns(true, 0, 200, 0)
        const selfFiledAmount = await positionLimitOrderContract.checkFilledToSelfOrders(positionManager.address, trader.address,6000, 5880, TRADE_SIDE.SHORT);
        expect(selfFiledAmount.toString()).eq('300')

        await positionManager.mock.getPendingOrderDetail.withArgs(5900, 1).returns(true, 0, 100, 50)
        await positionManager.mock.getPendingOrderDetail.withArgs(5950, 1).returns(true, 0, 200, 0)
        const selfFiledAmount2 = await positionLimitOrderContract.checkFilledToSelfOrders(positionManager.address, trader.address,6000, 5880, TRADE_SIDE.SHORT);
        expect(selfFiledAmount2.toString()).eq('250')

    });


});