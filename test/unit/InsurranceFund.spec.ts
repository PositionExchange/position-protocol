import {ethers} from 'hardhat';
import {BEP20Mintable, InsuranceFundTest, PositionManager} from "../../typeChain";
import {BigNumber} from "ethers";
import {expect} from "chai";

describe('Insurance Fund', async function () {
    let deployer: any;
    let insuranceFund: InsuranceFundTest;
    let positionManager: PositionManager;
    let busdToken: BEP20Mintable;
    let busdBonusToken: BEP20Mintable;
    let trader: any;
    beforeEach(async () => {
        [deployer, trader] = await ethers.getSigners()

        // Deploy mock busd contract
        const bep20MintableFactory = await ethers.getContractFactory('BEP20Mintable')
        busdToken = (await bep20MintableFactory.deploy('BUSD Mock', 'BUSD')) as unknown as BEP20Mintable

        // Deploy mock credit contract
        busdBonusToken = (await bep20MintableFactory.deploy('BUSD Bonus Mock', 'BUSDBONUS')) as unknown as BEP20Mintable

        const pmFactory = await ethers.getContractFactory("PositionManagerTest")
        positionManager = (await pmFactory.deploy()) as unknown as PositionManager
        await positionManager.initialize(BigNumber.from(200), busdToken.address, ethers.utils.formatBytes32String('BTC'), BigNumber.from(100), BigNumber.from(10000), BigNumber.from(10000), BigNumber.from(3000), BigNumber.from(1000), '0x5741306c21795FdCBb9b265Ea0255F499DFe515C'.toLowerCase(), deployer.address);

        const factory = await ethers.getContractFactory("InsuranceFundTest")
        insuranceFund = (await factory.deploy()) as unknown as InsuranceFundTest
        await insuranceFund.initialize();
        await insuranceFund.setBonusAddress(busdBonusToken.address)
        await insuranceFund.setCounterParty(deployer.address)
        await insuranceFund.updateWhitelistManager(positionManager.address, true)
        await insuranceFund.shouldAcceptBonus(true)

        await busdToken.connect(trader).increaseAllowance(insuranceFund.address, BigNumber.from('100000000000000000000000000'))
        await busdBonusToken.connect(trader).increaseAllowance(insuranceFund.address, BigNumber.from('100000000000000000000000000'))

        await busdToken.mint(deployer.getAddress(), BigNumber.from('100000000000000000000000000'))
        await busdBonusToken.mint(deployer.getAddress(), BigNumber.from('100000000000000000000000000'))

        // Reset trader balance
        const traderBalance = await busdToken.balanceOf(trader.getAddress())
        if (traderBalance.gt(BigNumber.from('0'))) {
            await busdToken.connect(trader).burn(traderBalance)
        }

        // Set InsuranceFund BUSD balance
        await busdToken.connect(deployer).transfer(insuranceFund.address, BigNumber.from('1000'))

        // Set InsuranceFund BUSD Bonus balance
        await busdBonusToken.connect(deployer).transfer(insuranceFund.address, BigNumber.from('1000'))

        // Set Trader BUSD balance
        await busdToken.mint(trader.getAddress(), BigNumber.from('0'))

        // Set Trader bonus balance in InsuranceFund
        await insuranceFund.connect(deployer).setBonusBalance(positionManager.address, trader.getAddress(), BigNumber.from('10'))

        // Default is
        // Bonus balance in insurance fund = 10
        // Bonus balance in wallet fund = 0
        // BUSD balance in wallet = 0
    })

    describe("test deposit", async () => {
        it("given bonusBalance > 0 && depositAmount < bonusBalance, should take fund from bonus balance", async () => {
            // Set Trader BUSD balance
            await busdToken.mint(trader.getAddress(), BigNumber.from('1000'))

            // Set Trader bonus balance in Wallet
            await busdBonusToken.mint(trader.getAddress(), BigNumber.from('10'))

            // Set Trader bonus balance in InsuranceFund
            await insuranceFund.connect(deployer).setBonusBalance(positionManager.address, trader.getAddress(), BigNumber.from('0'))

            // Trader deposit
            await insuranceFund.connect(deployer).deposit(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('5'),
                BigNumber.from('2')
            )

            const traderBUSDBalanceAfterDeposit = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterDeposit = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterDeposit).eq("1000");
            expect(traderBonusBalanceAfterDeposit).eq("3");
            expect(traderBonusBalanceInInsuranceFund).eq("5");
        })

        it("given bonusBalance > 0 && depositAmount == bonusBalance, should take all fund from bonus balance", async () => {
            // Set Trader BUSD balance
            await busdToken.mint(trader.getAddress(), BigNumber.from('1000'))

            // Set Trader bonus balance in InsuranceFund
            await busdBonusToken.mint(trader.getAddress(), BigNumber.from('10'))

            // Set Trader bonus balance in InsuranceFund
            await insuranceFund.connect(deployer).setBonusBalance(positionManager.address, trader.getAddress(), BigNumber.from('0'))

            // Trader deposit
            await insuranceFund.connect(deployer).deposit(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('7'),
                BigNumber.from('3')
            )

            const traderBUSDBalanceAfterDeposit = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterDeposit = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterDeposit).eq("1000");
            expect(traderBonusBalanceAfterDeposit).eq("0");
            expect(traderBonusBalanceInInsuranceFund).eq("7");
        })

        it("given bonusBalance > 0 && depositAmount > bonusBalance, should take fund from bonus balance and quote token balance", async () => {
            // Set Trader BUSD balance
            await busdToken.mint(trader.getAddress(), BigNumber.from('1000'))

            // Set Trader bonus balance in InsuranceFund
            await busdBonusToken.mint(trader.getAddress(), BigNumber.from('10'))

            // Set Trader bonus balance in InsuranceFund
            await insuranceFund.connect(deployer).setBonusBalance(positionManager.address, trader.getAddress(), BigNumber.from('0'))

            // Trader deposit
            await insuranceFund.connect(deployer).deposit(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('100'),
                BigNumber.from('5')
            )

            const traderBUSDBalanceAfterDeposit = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterDeposit = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterDeposit).eq("905");
            expect(traderBonusBalanceAfterDeposit).eq("0");
            expect(traderBonusBalanceInInsuranceFund).eq("5");
        })

        it("given bonusBalance <= 0, should take fund from quote token balance", async () => {
            // Set Trader BUSD balance
            await busdToken.mint(trader.getAddress(), BigNumber.from('1000'))

            // Set Trader bonus balance in InsuranceFund
            await busdBonusToken.mint(trader.getAddress(), BigNumber.from('0'))

            // Set Trader bonus balance in InsuranceFund
            await insuranceFund.connect(deployer).setBonusBalance(positionManager.address, trader.getAddress(), BigNumber.from('0'))

            // Trader deposit
            await insuranceFund.connect(deployer).deposit(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('90'),
                BigNumber.from('10')
            )

            const traderBUSDBalanceAfterDeposit = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterDeposit = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterDeposit).eq("900");
            expect(traderBonusBalanceAfterDeposit).eq("0");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 100 && depositAmount = 95, fee = 5", async () => {

            // Set Trader bonus balance in InsuranceFund
            await busdBonusToken.mint(trader.getAddress(), BigNumber.from('100'))

            // Set Trader bonus balance in InsuranceFund
            await insuranceFund.connect(deployer).setBonusBalance(positionManager.address, trader.getAddress(), BigNumber.from('0'))

            // Trader deposit
            await insuranceFund.connect(deployer).deposit(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('95'),
                BigNumber.from('5')
            )

            const traderBUSDBalanceAfterDeposit = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterDeposit = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterDeposit).eq("0");
            expect(traderBonusBalanceAfterDeposit).eq("0");
            expect(traderBonusBalanceInInsuranceFund).eq("95");
        })

        it("given bonusBalance = 100 && depositAmount = 15, fee = 5", async () => {

            // Set Trader bonus balance in InsuranceFund
            await busdBonusToken.mint(trader.getAddress(), BigNumber.from('100'))

            // Set Trader bonus balance in InsuranceFund
            await insuranceFund.connect(deployer).setBonusBalance(positionManager.address, trader.getAddress(), BigNumber.from('0'))

            // Trader deposit
            await insuranceFund.connect(deployer).deposit(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('15'),
                BigNumber.from('5')
            )

            const traderBUSDBalanceAfterDeposit = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterDeposit = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterDeposit).eq("0");
            expect(traderBonusBalanceAfterDeposit).eq("80");
            expect(traderBonusBalanceInInsuranceFund).eq("15");
        })

        it("given bonusBalance in wallet = 100 && given bonusBalance in InsuranceFund = 10 && depositAmount = 15, fee = 5", async () => {

            // Set Trader bonus balance in InsuranceFund
            await busdBonusToken.mint(trader.getAddress(), BigNumber.from('100'))

            // Set Trader bonus balance in InsuranceFund
            await insuranceFund.connect(deployer).setBonusBalance(positionManager.address, trader.getAddress(), BigNumber.from('10'))

            // Trader deposit
            await insuranceFund.connect(deployer).deposit(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('15'),
                BigNumber.from('5')
            )

            const traderBUSDBalanceAfterDeposit = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterDeposit = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterDeposit).eq("0");
            expect(traderBonusBalanceAfterDeposit).eq("80");
            expect(traderBonusBalanceInInsuranceFund).eq("25");
        })

        it("given bonusBalance > 0 && depositAmount + fee > bonusBalance, should take all fund from bonus balance", async () => {
            // Set Trader BUSD balance
            await busdToken.mint(trader.getAddress(), BigNumber.from('1000'))

            // Set Trader bonus balance in InsuranceFund
            await busdBonusToken.mint(trader.getAddress(), BigNumber.from('10'))

            // Set Trader bonus balance in InsuranceFund
            await insuranceFund.connect(deployer).setBonusBalance(positionManager.address, trader.getAddress(), BigNumber.from('0'))

            // Trader deposit
            await insuranceFund.connect(deployer).deposit(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('10'),
                BigNumber.from('2')
            )

            const traderBUSDBalanceAfterDeposit = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterDeposit = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterDeposit).eq("998");
            expect(traderBonusBalanceAfterDeposit).eq("0");
            expect(traderBonusBalanceInInsuranceFund).eq("8");
        })

        it("given bonusBalance in wallet > 0 && given bonusBalance in InsuranceFund > 0 && depositAmount + fee > bonusBalance, should take all fund from bonus balance", async () => {
            // Set Trader BUSD balance
            await busdToken.mint(trader.getAddress(), BigNumber.from('1000'))

            // Set Trader bonus balance in InsuranceFund
            await busdBonusToken.mint(trader.getAddress(), BigNumber.from('10'))

            // Set Trader bonus balance in InsuranceFund
            await insuranceFund.connect(deployer).setBonusBalance(positionManager.address, trader.getAddress(), BigNumber.from('20'))

            // Trader deposit
            await insuranceFund.connect(deployer).deposit(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('10'),
                BigNumber.from('2')
            )

            const traderBUSDBalanceAfterDeposit = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterDeposit = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterDeposit).eq("998");
            expect(traderBonusBalanceAfterDeposit).eq("0");
            expect(traderBonusBalanceInInsuranceFund).eq("28");
        })

        it("given bonusBalance in wallet > 0 && given bonusBalance in InsuranceFund > 0 && depositAmount + fee > bonusBalance, should take all fund from bonus balance & BUSD balance", async () => {
            // Set Trader BUSD balance
            await busdToken.mint(trader.getAddress(), BigNumber.from('1000'))

            // Set Trader bonus balance in InsuranceFund
            await busdBonusToken.mint(trader.getAddress(), BigNumber.from('10'))

            // Set Trader bonus balance in InsuranceFund
            await insuranceFund.connect(deployer).setBonusBalance(positionManager.address, trader.getAddress(), BigNumber.from('20'))

            // Trader deposit
            await insuranceFund.connect(deployer).deposit(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('100'),
                BigNumber.from('5')
            )

            const traderBUSDBalanceAfterDeposit = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterDeposit = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterDeposit).eq("905");
            expect(traderBonusBalanceAfterDeposit).eq("0");
            expect(traderBonusBalanceInInsuranceFund).eq("25");
        })
    })

    describe("test withdraw, when fully close and old margin only have bonus", async () => {

        // p
        it("given bonusBalance = 10 && withdrawAmount = 5 && pnl = 4, expect user receive busd = 4 and bonus = 1", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('5'),
                BigNumber.from('10'),
                BigNumber.from('4')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("4");
            expect(traderBonusBalanceAfterWithdraw).eq("1");
            expect(traderBonusBalanceInInsuranceFund).eq("9");
        })

        // p
        it("given bonusBalance = 10 && withdrawAmount = 5 && pnl = 2, expect user receive busd = 2 and bonus = 3", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('5'),
                BigNumber.from('10'),
                BigNumber.from('2')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("2");
            expect(traderBonusBalanceAfterWithdraw).eq("3");
            expect(traderBonusBalanceInInsuranceFund).eq("7");
        })

        //p
        it("given bonusBalance = 10 && withdrawAmount = 5 && pnl = 0, expect user receive busd = 0 and bonus = 5", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('5'),
                BigNumber.from('10'),
                BigNumber.from('0')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("0");
            expect(traderBonusBalanceAfterWithdraw).eq("5");
            expect(traderBonusBalanceInInsuranceFund).eq("5");
        })

        //p
        it("given bonusBalance = 10 && withdrawAmount = 5 && pnl = -2, expect user receive busd = 0 and bonus = 5", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('5'),
                BigNumber.from('10'),
                BigNumber.from('-2')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("0");
            expect(traderBonusBalanceAfterWithdraw).eq("5");
            expect(traderBonusBalanceInInsuranceFund).eq("3");
        })

        it("given bonusBalance = 10 && withdrawAmount = 7 && pnl = -3, expect user receive busd = 0 and bonus = 7", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('7'),
                BigNumber.from('10'),
                BigNumber.from('-3')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("0");
            expect(traderBonusBalanceAfterWithdraw).eq("7");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 10 && withdrawAmount = 1 && pnl = -9, expect user receive busd = 0 and bonus = 1", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('1'),
                BigNumber.from('10'),
                BigNumber.from('-9')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("0");
            expect(traderBonusBalanceAfterWithdraw).eq("1");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })
    })

    describe("test withdraw, when fully close and old margin have BUSD and bonus", async () => {

        it("given bonusBalance = 10 && withdrawAmount = 98 && pnl = -2, expect user receive busd = 90 and bonus = 8", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('98'),
                BigNumber.from('100'),
                BigNumber.from('-2')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("90");
            expect(traderBonusBalanceAfterWithdraw).eq("8");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 10 && withdrawAmount = 95 && pnl = -5, expect user receive busd = 90 and bonus = 5", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('95'),
                BigNumber.from('100'),
                BigNumber.from('-5')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("90");
            expect(traderBonusBalanceAfterWithdraw).eq("5");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 10 && withdrawAmount = 90 && pnl = -10, expect user receive busd = 90 and bonus = 0", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('90'),
                BigNumber.from('100'),
                BigNumber.from('-10')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("90");
            expect(traderBonusBalanceAfterWithdraw).eq("0");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 10 && withdrawAmount = 80 && pnl = -20, expect user receive busd = 80 and bonus = 0", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('80'),
                BigNumber.from('100'),
                BigNumber.from('-20')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("80");
            expect(traderBonusBalanceAfterWithdraw).eq("0");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 10 && withdrawAmount = 70 && pnl = -30, expect user receive busd = 70 and bonus = 0", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('70'),
                BigNumber.from('100'),
                BigNumber.from('-30')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("70");
            expect(traderBonusBalanceAfterWithdraw).eq("0");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 10 && withdrawAmount = 15 && pnl = 0, expect user receive busd = 5 and bonus = 10", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('15'),
                BigNumber.from('15'),
                BigNumber.from('0')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("5");
            expect(traderBonusBalanceAfterWithdraw).eq("10");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 10 && withdrawAmount = 30 && pnl = 0, expect user receive busd = 20 and bonus = 10", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('30'),
                BigNumber.from('30'),
                BigNumber.from('0')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("20");
            expect(traderBonusBalanceAfterWithdraw).eq("10");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 10 && withdrawAmount = 40 && pnl = 20, expect user receive busd = 30 and bonus = 10", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('40'),
                BigNumber.from('20'),
                BigNumber.from('20')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("30");
            expect(traderBonusBalanceAfterWithdraw).eq("10");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 10 && withdrawAmount = 10 && pnl = -10, expect user receive busd = 10 and bonus = 0", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('10'),
                BigNumber.from('20'),
                BigNumber.from('-10')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("10");
            expect(traderBonusBalanceAfterWithdraw).eq("0");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 10 && withdrawAmount = 1 && pnl = -20, expect user receive busd = 1 and bonus = 0", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('1'),
                BigNumber.from('21'),
                BigNumber.from('-20')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("1");
            expect(traderBonusBalanceAfterWithdraw).eq("0");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })
    })

    describe("test withdraw, when partial close and old margin have BUSD and bonus", async () => {
        it("given bonusBalance = 10 && withdrawAmount = 98 && pnl = -2, expect user receive busd = 98 and bonus = 0", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('98'),
                BigNumber.from('500'),
                BigNumber.from('-2')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("98");
            expect(traderBonusBalanceAfterWithdraw).eq("0");
            expect(traderBonusBalanceInInsuranceFund).eq("8");
        })

        it("given bonusBalance = 10 && withdrawAmount = 50 && pnl = -20, expect user receive busd = 50 and bonus = 0", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('50'),
                BigNumber.from('100'),
                BigNumber.from('-20')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("50");
            expect(traderBonusBalanceAfterWithdraw).eq("0");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 10 && withdrawAmount = 50 && pnl = -10, expect user receive busd = 50 and bonus = 0", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('50'),
                BigNumber.from('100'),
                BigNumber.from('-10')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("50");
            expect(traderBonusBalanceAfterWithdraw).eq("0");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 60 && withdrawAmount = 10 && pnl = -70, expect user receive busd = 10 and bonus = 0", async () => {

            await insuranceFund.connect(deployer).setBonusBalance(positionManager.address, trader.getAddress(), BigNumber.from('60'))
            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('10'),
                BigNumber.from('100'),
                BigNumber.from('-70')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("10");
            expect(traderBonusBalanceAfterWithdraw).eq("0");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 60 && withdrawAmount = 10 && pnl = -60, expect user receive busd = 10 and bonus = 0", async () => {

            await insuranceFund.connect(deployer).setBonusBalance(positionManager.address, trader.getAddress(), BigNumber.from('60'))
            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('10'),
                BigNumber.from('100'),
                BigNumber.from('-60')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("10");
            expect(traderBonusBalanceAfterWithdraw).eq("0");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 60 && withdrawAmount = 10 && pnl = -40, expect user receive busd = 10 and bonus = 0", async () => {

            await insuranceFund.connect(deployer).setBonusBalance(positionManager.address, trader.getAddress(), BigNumber.from('60'))

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('10'),
                BigNumber.from('100'),
                BigNumber.from('-40')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("10");
            expect(traderBonusBalanceAfterWithdraw).eq("0");
            expect(traderBonusBalanceInInsuranceFund).eq("20");
        })

        it("given bonusBalance = 10 && withdrawAmount = 50 && pnl = 20, expect user receive busd = 50 and bonus = 0", async () => {

            await insuranceFund.connect(deployer).setBonusBalance(positionManager.address, trader.getAddress(), BigNumber.from('10'))

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('50'),
                BigNumber.from('100'),
                BigNumber.from('20')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("50");
            expect(traderBonusBalanceAfterWithdraw).eq("0");
            expect(traderBonusBalanceInInsuranceFund).eq("10");
        })

        it("given bonusBalance = 90 && withdrawAmount = 50 && pnl = 20, expect user receive busd = 30 and bonus = 20", async () => {

            await insuranceFund.connect(deployer).setBonusBalance(positionManager.address, trader.getAddress(), BigNumber.from('90'))

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('50'),
                BigNumber.from('100'),
                BigNumber.from('20')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("30");
            expect(traderBonusBalanceAfterWithdraw).eq("20");
            expect(traderBonusBalanceInInsuranceFund).eq("70");
        })

        it("given bonusBalance = 90 && withdrawAmount = 50 && pnl = 0, expect user receive busd = 10 and bonus = 40", async () => {

            await insuranceFund.connect(deployer).setBonusBalance(positionManager.address, trader.getAddress(), BigNumber.from('90'))

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('50'),
                BigNumber.from('100'),
                BigNumber.from('0')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("10");
            expect(traderBonusBalanceAfterWithdraw).eq("40");
            expect(traderBonusBalanceInInsuranceFund).eq("50");
        })
    })
});

