import {ethers} from "hardhat";
import {
    BEP20Mintable,
    InsuranceFund,
    PositionHouse,
    PositionHouseConfigurationProxy,
    PositionHouseFunction,
    PositionHouseViewer,
    PositionManager,
    FundingRateTest,
    PositionNotionalConfigProxy,
    PositionStrategyOrder, PositionHouseCoinMargin
} from "../../typeChain";
import {BigNumber} from "ethers";
import PositionManagerTestingTool from "./positionManagerTestingTool";
import PositionHouseTestingTool from "./positionHouseTestingTool";

export async function deployPositionHouse(isCoinMargin? : boolean){
    const [trader] = await ethers.getSigners();
    // Deploy position house function contract

    let USDMarginFactory = await ethers.getContractFactory('USDMargin')
    if (isCoinMargin) {
        USDMarginFactory = await ethers.getContractFactory('CoinMargin')
    }
    let USDMargin = await USDMarginFactory.deploy();

    const PositionMath = await ethers.getContractFactory('PositionMath', {
        libraries: {
            USDMargin: USDMargin.address
        }
    })
    const positionMath = await PositionMath.deploy()

    const PositionHouseFunction = await ethers.getContractFactory('PositionHouseFunction', {
        libraries: {
            PositionMath: positionMath.address
        }
    })
    const positionHouseFunction = (await PositionHouseFunction.deploy())

    const PositionNotionalConfigProxyFactory = await ethers.getContractFactory('PositionNotionalConfigProxyTest')
    let positionNotionalConfigProxy = (await PositionNotionalConfigProxyFactory.deploy()) as unknown as PositionNotionalConfigProxy

    // Deploy mock busd contract
    const bep20MintableFactory = await ethers.getContractFactory('BEP20Mintable')
    let bep20Mintable = (await bep20MintableFactory.deploy('BUSD Mock', 'BUSD')) as unknown as BEP20Mintable

    // Deploy insurance fund contract
    const insuranceFundFactory = await ethers.getContractFactory('InsuranceFund')
    let insuranceFund = (await insuranceFundFactory.deploy()) as unknown as InsuranceFund

    const positionHouseConfigurationProxyFactory = await ethers.getContractFactory('PositionHouseConfigurationProxy')
    let positionHouseConfiguration = (await positionHouseConfigurationProxyFactory.deploy()) as unknown as PositionHouseConfigurationProxy

    // Deploy position manager contract
    let positionManagerFactory = await ethers.getContractFactory("PositionManagerTest", {
        libraries: {
            PositionMath: positionMath.address
        }
    })
    let positionManager = (await positionManagerFactory.deploy()) as unknown as PositionManager;

    // Deploy funding rate test contract
    let fundingRateTestFactory = await ethers.getContractFactory("FundingRateTest", {
        libraries: {
            PositionMath: positionMath.address
        }
    })
    let fundingRateTest = (await fundingRateTestFactory.deploy()) as unknown as FundingRateTest

    let positionHouseViewer = await ((await ethers.getContractFactory('PositionHouseViewer', {
        libraries: {
            PositionHouseFunction: positionHouseFunction.address,
            PositionMath: positionMath.address
        }
    })).deploy()) as unknown as PositionHouseViewer

    // Deploy position house contract

    let factory = await ethers.getContractFactory("PositionHouse", {
        libraries: {
            PositionHouseFunction: positionHouseFunction.address,
            PositionMath: positionMath.address
        }
    })

    if (isCoinMargin) {
        factory = await ethers.getContractFactory("PositionHouseCoinMargin", {
            libraries: {
                PositionHouseFunction: positionHouseFunction.address,
                PositionMath: positionMath.address
            }
        })
    }

    let positionStrategyOrderFactory = await ethers.getContractFactory("PositionStrategyOrder")
    let positionStrategyOrder = (await positionStrategyOrderFactory.deploy()) as unknown as PositionStrategyOrder

    let positionHouse
    if (isCoinMargin) {
        positionHouse = (await factory.deploy()) as unknown as PositionHouseCoinMargin;
    } else {
        positionHouse = (await factory.deploy()) as unknown as PositionHouse;
    }
    await insuranceFund.connect(trader).initialize()
    await insuranceFund.connect(trader).setCounterParty(positionHouse.address);

    await bep20Mintable.mint(insuranceFund.address, BigNumber.from('10000000000000000000000000000000'));

    (await ethers.getSigners()).forEach(element => {
        bep20Mintable.mint(element.address, BigNumber.from('10000000000000000000000000000000'))
        bep20Mintable.connect(element).approve(insuranceFund.address, BigNumber.from('1000000000000000000000000000000000000'))
    })
    let positionManagerTestingTool = new PositionManagerTestingTool(positionManager)
    let positionHouseTestingTool = new PositionHouseTestingTool(positionHouse, positionManager, positionHouseViewer)

    await positionStrategyOrder.initialize(positionHouse.address, positionHouseViewer.address)

    await positionManager.initialize(BigNumber.from(500000), bep20Mintable.address, ethers.utils.formatBytes32String('BTC'), BigNumber.from(100), BigNumber.from(10000), BigNumber.from(10000), BigNumber.from(3000), BigNumber.from(3600), '0x5741306c21795FdCBb9b265Ea0255F499DFe515C'.toLowerCase(), positionHouse.address);
    await fundingRateTest.initialize(BigNumber.from(500000), bep20Mintable.address, ethers.utils.formatBytes32String('BTC'), BigNumber.from(100), BigNumber.from(10000), BigNumber.from(10000), BigNumber.from(3000), BigNumber.from(3600), '0x5741306c21795FdCBb9b265Ea0255F499DFe515C'.toLowerCase(), positionHouse.address);
    await positionHouseConfiguration.initialize(BigNumber.from(3), BigNumber.from(80), BigNumber.from(3), BigNumber.from(20))
    await positionHouse.initialize(insuranceFund.address, positionHouseConfiguration.address, positionNotionalConfigProxy.address)
    await positionHouseViewer.initialize(positionHouse.address, positionHouseConfiguration.address)

    await positionManager.updateInsuranceFundAddress(insuranceFund.address)
    await fundingRateTest.updateInsuranceFundAddress(insuranceFund.address)

    if (isCoinMargin) {
        await positionHouse.setContractPrice(positionManager.address, 100);
        await positionHouse.setContractPrice(fundingRateTest.address, 100);
        await insuranceFund.connect(trader).setCounterParty(positionManager.address);
    }

    await positionHouse.setPositionStrategyOrder(positionStrategyOrder.address)

    await positionHouse.updateConfigNotionalKey(positionManager.address, ethers.utils.formatBytes32String("BTC_BUSD"))
    await positionHouse.updateConfigNotionalKey(fundingRateTest.address, ethers.utils.formatBytes32String("BTC_BUSD"))
    await insuranceFund.updateWhitelistManager(positionManager.address, true);
    await insuranceFund.updateWhitelistManager(fundingRateTest.address, true);

    return [
        positionHouse,
        positionManager,
        positionManagerFactory,
        positionManagerTestingTool,
        positionHouseTestingTool,
        bep20Mintable,
        insuranceFund,
        positionHouseViewer,
        fundingRateTest,
        positionStrategyOrder
    ]

}