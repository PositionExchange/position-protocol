import {ethers} from "hardhat";
import {PositionLimitOrderTest} from "../../../typeChain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from 'chai'

describe('test position limit order library', function () {
    let positionLimitOrderContract: PositionLimitOrderTest;
    let trader: SignerWithAddress, positionManager: SignerWithAddress
    const TRADE_SIDE = {
        LONG: 1,
        SHORT: 2
    }
    beforeEach(async () => {
        const positionLimitOrderTestContractFactory = await ethers.getContractFactory('PositionLimitOrderTest')
        positionLimitOrderContract = await positionLimitOrderTestContractFactory.deploy() as unknown as PositionLimitOrderTest
        [trader, positionManager] = await ethers.getSigners()
    })

    const mockCreateLimitOrder = async (quantity: number, side: number, pip: number, orderId: number, leverage: number = 10, isOpenLimitOrder: boolean = true) => {
        await positionLimitOrderContract.mockLimitOrder(
            positionManager.address,
            TRADE_SIDE.LONG,
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
        await positionLimitOrderContract.checkFilledToSelfOrders(positionManager.address, trader.address,6000, 5880, TRADE_SIDE.SHORT);

        // expect
        const positionData0 = await positionLimitOrderContract.limitOrderMap(positionManager.address, trader.address, 0)
        expect(positionData0.isSelfFilled).eq(1)

    });


});