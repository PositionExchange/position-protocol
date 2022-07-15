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
        await busdToken.connect(deployer).transfer(insuranceFund.address, BigNumber.from('10000'))

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

    describe("test withdraw, when partial close", async () => {

        it("given bonusBalance = 10 && withdrawAmount = 52, expect user receive busd = 42 and bonus = 10", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('52')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("42");
            expect(traderBonusBalanceAfterWithdraw).eq("10");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 10 && withdrawAmount = 73, expect user receive busd = 63 and bonus = 10", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('73')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("63");
            expect(traderBonusBalanceAfterWithdraw).eq("10");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 10 && withdrawAmount = 19, expect user receive busd = 9 and bonus = 10", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('19')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("9");
            expect(traderBonusBalanceAfterWithdraw).eq("10");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 10 && withdrawAmount = 982, expect user receive busd = 972 and bonus = 10", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('982')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("972");
            expect(traderBonusBalanceAfterWithdraw).eq("10");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 10 && withdrawAmount = 9010, expect user receive busd = 9000 and bonus = 10", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('9010')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("9000");
            expect(traderBonusBalanceAfterWithdraw).eq("10");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 10 && withdrawAmount = 15, expect user receive busd = 5 and bonus = 10", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('15')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("5");
            expect(traderBonusBalanceAfterWithdraw).eq("10");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 10 && withdrawAmount = 30, expect user receive busd = 20 and bonus = 10", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('30')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("20");
            expect(traderBonusBalanceAfterWithdraw).eq("10");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 10 && withdrawAmount = 5, expect user receive busd = 0 and bonus = 5", async () => {

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('5')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("0");
            expect(traderBonusBalanceAfterWithdraw).eq("5");
            expect(traderBonusBalanceInInsuranceFund).eq("5");
        })

        it("given bonusBalance = 60 && withdrawAmount = 1070, expect user receive busd = 1010 and bonus = 60", async () => {

            await insuranceFund.connect(deployer).setBonusBalance(positionManager.address, trader.getAddress(), BigNumber.from('60'))

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('1070')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("1010");
            expect(traderBonusBalanceAfterWithdraw).eq("60");
            expect(traderBonusBalanceInInsuranceFund).eq("0");
        })

        it("given bonusBalance = 90 && withdrawAmount = 50, expect user receive busd = 0 and bonus = 50", async () => {

            await insuranceFund.connect(deployer).setBonusBalance(positionManager.address, trader.getAddress(), BigNumber.from('90'))

            // Trader withdraw
            await insuranceFund.connect(deployer).withdraw(
                positionManager.address,
                trader.getAddress(),
                BigNumber.from('50')
            )

            const traderBUSDBalanceAfterWithdraw = await busdToken.balanceOf(trader.getAddress())
            const traderBonusBalanceAfterWithdraw = await busdBonusToken.balanceOf(trader.getAddress())
            const traderBonusBalanceInInsuranceFund = await insuranceFund.busdBonusBalances(positionManager.address, trader.getAddress())

            expect(traderBUSDBalanceAfterWithdraw).eq("0");
            expect(traderBonusBalanceAfterWithdraw).eq("50");
            expect(traderBonusBalanceInInsuranceFund).eq("40");
        })
    })
});

