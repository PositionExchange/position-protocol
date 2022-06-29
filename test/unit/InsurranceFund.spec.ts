import {ethers} from 'hardhat';
import {BEP20Mintable, InsuranceFundTest, PositionManager} from "../../typeChain";
import {BigNumber} from "ethers";
import {expect} from "chai";

describe('Position Manager', async function () {
    let deployer: any;
    let insuranceFund: InsuranceFundTest;
    let positionManager: PositionManager;
    let bep20Mintable: BEP20Mintable;
    let bep20Credit: BEP20Mintable;
    let trader: any;
    beforeEach(async () => {
        [deployer, trader] = await ethers.getSigners()

        // Deploy mock busd contract
        const bep20MintableFactory = await ethers.getContractFactory('BEP20Mintable')
        bep20Mintable = (await bep20MintableFactory.deploy('BUSD Mock', 'BUSD')) as unknown as BEP20Mintable

        // Deploy mock credit contract
        bep20Credit = (await bep20MintableFactory.deploy('BUSD Credit Mock', 'BUSDCredit')) as unknown as BEP20Mintable

        const pmFactory = await ethers.getContractFactory("PositionManagerTest")
        positionManager = (await pmFactory.deploy()) as unknown as PositionManager
        await positionManager.initialize(BigNumber.from(200), bep20Mintable.address, ethers.utils.formatBytes32String('BTC'), BigNumber.from(100), BigNumber.from(10000), BigNumber.from(10000), BigNumber.from(3000), BigNumber.from(1000), '0x5741306c21795FdCBb9b265Ea0255F499DFe515C'.toLowerCase(), deployer.address);

        const factory = await ethers.getContractFactory("InsuranceFundTest")
        insuranceFund = (await factory.deploy()) as unknown as InsuranceFundTest
        await insuranceFund.initialize();
        await insuranceFund.setCreditAddress(bep20Credit.address)
        await insuranceFund.setCounterParty(deployer.address)
        await insuranceFund.updateWhitelistManager(positionManager.address, true)

        await bep20Mintable.connect(trader).increaseAllowance(insuranceFund.address, BigNumber.from('100000000000000000000000000'))
        await bep20Credit.connect(trader).increaseAllowance(insuranceFund.address, BigNumber.from('100000000000000000000000000'))

        await bep20Mintable.mint(deployer.getAddress(), BigNumber.from('100000000000000000000000000'))
    })

    describe("test deposit", async () => {
        it("should take fund from credit balance if credit balance greater than 0", async () => {
            // Set balance
            await bep20Mintable.mint(trader.getAddress(), BigNumber.from('1000'))
            await bep20Credit.mint(trader.getAddress(), BigNumber.from('30'))

            await insuranceFund.connect(deployer).deposit(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('5'),
                BigNumber.from('0')
            )

            const balanceAfterDeposit = await bep20Mintable.balanceOf(trader.getAddress())
            const creditBalanceAfterDeposit = await bep20Credit.balanceOf(trader.getAddress())

            expect(balanceAfterDeposit).eq("1000");
            expect(creditBalanceAfterDeposit).eq("25");
        })

        it("should take fund from credit balance if credit balance greater than 0, if not enough, continue to take fund from quote token balance", async () => {
            // Set balance
            await bep20Mintable.mint(trader.getAddress(), BigNumber.from('1000'))
            await bep20Credit.mint(trader.getAddress(), BigNumber.from('30'))

            await insuranceFund.connect(deployer).deposit(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('100'),
                BigNumber.from('5')
            )

            const balanceAfterDeposit = await bep20Mintable.balanceOf(trader.getAddress())
            const creditBalanceAfterDeposit = await bep20Credit.balanceOf(trader.getAddress())

            expect(balanceAfterDeposit).eq("925");
            expect(creditBalanceAfterDeposit).eq("0");
        })

        it("should take fund from quote token balance if credit balance less or equals 0", async () => {
            // Set balance
            await bep20Mintable.mint(trader.getAddress(), BigNumber.from('1000'))
            await bep20Credit.mint(trader.getAddress(), BigNumber.from('0'))

            await insuranceFund.connect(deployer).deposit(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('90'),
                BigNumber.from('10')
            )

            const balanceAfterDeposit = await bep20Mintable.balanceOf(trader.getAddress())
            const creditBalanceAfterDeposit = await bep20Credit.balanceOf(trader.getAddress())

            expect(balanceAfterDeposit).eq("900");
            expect(creditBalanceAfterDeposit).eq("0");
        })
    })

    describe("test withdraw", async () => {
        it("given pnl greater than 0, should transfer fund to quote token balance", async () => {
            // Set balance and add fund to InsuranceFund
            await bep20Mintable.mint(trader.getAddress(), BigNumber.from('1000'))
            await bep20Credit.mint(trader.getAddress(), BigNumber.from('30'))
            await bep20Mintable.connect(deployer).transfer(insuranceFund.address, BigNumber.from('1000'))

            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('100'),
                BigNumber.from('5')
            )

            const balanceAfterDeposit = await bep20Mintable.balanceOf(trader.getAddress())
            const creditBalanceAfterDeposit = await bep20Credit.balanceOf(trader.getAddress())

            expect(balanceAfterDeposit).eq("1100");
            expect(creditBalanceAfterDeposit).eq("30");
        })

        it("given pnl less than 0, should reduce fund from credit balance", async () => {
            // Set balance and add fund to InsuranceFund
            await bep20Mintable.mint(trader.getAddress(), BigNumber.from('1000'))
            await bep20Credit.mint(trader.getAddress(), BigNumber.from('30'))
            await bep20Mintable.connect(deployer).transfer(insuranceFund.address, BigNumber.from('1000'))

            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('100'),
                BigNumber.from('-5')
            )

            const balanceAfterDeposit = await bep20Mintable.balanceOf(trader.getAddress())
            const creditBalanceAfterDeposit = await bep20Credit.balanceOf(trader.getAddress())

            expect(balanceAfterDeposit).eq("1070");
            expect(creditBalanceAfterDeposit).eq("0");
        })
    })
});

