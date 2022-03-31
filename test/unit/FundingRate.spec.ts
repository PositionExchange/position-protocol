import {BigNumber, ContractFactory} from 'ethers'
import {ethers, waffle} from 'hardhat'

const {solidity} = waffle

import {expect, use} from 'chai'
import {PositionManager, PositionHouse, ChainLinkPriceFeed, BEP20Mintable, InsuranceFund, FundingRateTest} from "../../typeChain";
import {
    ChangePriceParams,
    ClaimFund,
    LimitOrderReturns,
    MaintenanceDetail,
    NotionalAndUnrealizedPnlReturns, OpenLimitInHouseParams,
    OpenLimitPositionAndExpectParams, OpenMarketInHouseParams,
    PositionData,
    PositionLimitOrderID,
    priceToPip,
    SIDE,
    toWeiBN,
    toWeiWithString
} from "../shared/utilities";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

use(solidity)

const sideObj = {
    0: 'LONG',
    1: 'SHORT'
}

describe("FundingRate", () => {
    let trader0: any;
    let trader1: any;
    let trader2: any;
    let trader3: any;
    let trader4: any;
    let tradercp1: any;
    let tradercp2: any;
    let fundingRateTest: FundingRateTest;
    let insuranceFund: InsuranceFund
    let bep20Mintable: BEP20Mintable
    let positionHouse: PositionHouse;

    beforeEach(async () => {
        [trader0, trader1, trader2, trader3, trader4, tradercp1, tradercp2] = await ethers.getSigners();
        const positionHouseFunction = await ethers.getContractFactory('PositionHouseFunction')
        const libraryIns = (await positionHouseFunction.deploy())
        const PositionHouseMath = await ethers.getContractFactory('PositionHouseMath')
        const positionHouseMath = await PositionHouseMath.deploy()

        // Deploy mock busd contract
        const bep20MintableFactory = await ethers.getContractFactory('BEP20Mintable')
        bep20Mintable = (await bep20MintableFactory.deploy('BUSD Mock', 'BUSD')) as unknown as BEP20Mintable

        // Deploy insurance fund contract
        const insuranceFundFactory = await ethers.getContractFactory('InsuranceFund')
        insuranceFund = (await insuranceFundFactory.deploy()) as unknown as InsuranceFund

        const FundingRateTest = await ethers.getContractFactory('FundingRateTest')
        fundingRateTest = (await FundingRateTest.deploy()) as unknown as FundingRateTest

        // Deploy position house contract
        const factory = await ethers.getContractFactory("PositionHouse", {
            libraries: {
                PositionHouseFunction: libraryIns.address,
                PositionHouseMath: positionHouseMath.address
                // unsafeAllowLinkedLibraries : true
            }
        })
        positionHouse = (await factory.deploy()) as unknown as PositionHouse;

        await insuranceFund.connect(trader0).initialize()
        await insuranceFund.connect(trader0).setCounterParty(positionHouse.address);
        await bep20Mintable.mint(insuranceFund.address, BigNumber.from('10000000000000000000000000000000'));

        [trader0, trader1, trader2, trader3, trader4, tradercp1, tradercp2].forEach(element => {
            bep20Mintable.mint(element.address, BigNumber.from('10000000000000000000000000000000'))
            bep20Mintable.connect(element).approve(insuranceFund.address, BigNumber.from('1000000000000000000000000000000000000'))
        })

        await fundingRateTest.initialize(BigNumber.from(500000), bep20Mintable.address, ethers.utils.formatBytes32String('BTC'), BigNumber.from(100), BigNumber.from(10000), BigNumber.from(10000), BigNumber.from(3000), BigNumber.from(3600), '0x5741306c21795FdCBb9b265Ea0255F499DFe515C'.toLowerCase(), positionHouse.address);
        await positionHouse.initialize(BigNumber.from(3), BigNumber.from(80), BigNumber.from(3), BigNumber.from(20), insuranceFund.address)

        await positionHouse.updateWhitelistManager(fundingRateTest.address, true);

    })

    async function openLimitOrder({pip, quantity, leverage, side, instanceTrader} : OpenLimitInHouseParams) {
        const tx = await positionHouse.connect(instanceTrader).openLimitOrder(
            fundingRateTest.address,
            side,
            quantity,
            pip,
            leverage
        )
        console.log("GAS USED LIMIT", (await tx.wait()).gasUsed.toString())
    }

    async function openMarketPosition({quantity, leverage, side, instanceTrader} : OpenMarketInHouseParams) {
        const tx = await positionHouse.connect(instanceTrader).openMarketPosition(
            fundingRateTest.address,
            side,
            quantity,
            leverage
        )
        console.log("GAS USED MARKET", (await tx.wait()).gasUsed.toString())
    }

    async function changePrice({
                                   limitPrice,
                                   toHigherPrice
                               }: ChangePriceParams) {
        await openLimitOrder({
            pip: BigNumber.from(limitPrice),
            quantity: BigNumber.from("1"),
            leverage: 10,
            side: toHigherPrice ? 1 : 0,
            instanceTrader: tradercp1
        })

        await openMarketPosition({
            quantity: BigNumber.from("1"),
            leverage: 10,
            side: toHigherPrice ? 0 : 1,
            instanceTrader: tradercp2
        })
    }

    async function setMockTimeAndBlockNumber(time: any, blocknumber: any) {
        await fundingRateTest.setMockTime(time)
        await fundingRateTest.setBlockNumber(blocknumber)
    }

    describe("should open limit and market to change price", async () => {
        it("should open limit and market success", async () => {
            await setMockTimeAndBlockNumber(1647923687,1)

            await openLimitOrder({
                pip: BigNumber.from("490000"),
                quantity: BigNumber.from(1),
                leverage: 10,
                side: 0,
                instanceTrader: trader0
            })

            await openMarketPosition({
                quantity: BigNumber.from(1),
                leverage: 10,
                side: 1,
                instanceTrader: trader1
            })

            await changePrice({
                limitPrice: 490000,
                toHigherPrice: false
            })

            await setMockTimeAndBlockNumber(1647923690,2)
            await changePrice({
                limitPrice: 510000,
                toHigherPrice: true
            })

            await setMockTimeAndBlockNumber(1647923692,2)
            console.log((await fundingRateTest.getTwapPrice(3600)).toString())
            expect((await fundingRateTest.getTwapPrice(3600)).toString()).eq("49999722")
            await positionHouse.payFunding(fundingRateTest.address)
            console.log((await positionHouse.getLatestCumulativePremiumFraction(fundingRateTest.address)).toString())

        })
    })

})
