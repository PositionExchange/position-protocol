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
    PositionStrategyOrder
} from "../../typeChain";
import {BigNumber} from "ethers";
import PositionManagerTestingTool from "./positionManagerTestingTool";
import PositionHouseTestingTool from "./positionHouseTestingTool";

export async function deployPositionHouse(){
    const [trader] = await ethers.getSigners();
    // Deploy position house function contract
    const positionHouseFunction = await ethers.getContractFactory('PositionHouseFunction')
    const libraryIns = (await positionHouseFunction.deploy())
    const PositionHouseMath = await ethers.getContractFactory('PositionHouseMath')
    const positionHouseMath = await PositionHouseMath.deploy()
    const PositionNotionalConfigProxyFactory = await ethers.getContractFactory('PositionNotionalConfigProxy')
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
    let positionManagerFactory = await ethers.getContractFactory("PositionManagerTest")
    let positionManager = (await positionManagerFactory.deploy()) as unknown as PositionManager;

    // Deploy funding rate test contract
    let fundingRateTestFactory = await ethers.getContractFactory("FundingRateTest")
    let fundingRateTest = (await fundingRateTestFactory.deploy()) as unknown as FundingRateTest

    let positionHouseViewer = await ((await ethers.getContractFactory('PositionHouseViewer', {
        libraries: {
            PositionHouseFunction: libraryIns.address
        }
    })).deploy()) as unknown as PositionHouseViewer

    // Deploy position house contract
    const factory = await ethers.getContractFactory("PositionHouse", {
        libraries: {
            PositionHouseFunction: libraryIns.address,
            PositionHouseMath: positionHouseMath.address
        }
    })

    let positionStrategyOrderFactory = await ethers.getContractFactory("PositionStrategyOrder")
    let positionStrategyOrder = (await positionStrategyOrderFactory.deploy()) as unknown as PositionStrategyOrder


    let positionHouse = (await factory.deploy()) as unknown as PositionHouse;
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

    await positionManager.initialize(BigNumber.from(500000), bep20Mintable.address, ethers.utils.formatBytes32String('BTC'), BigNumber.from(100), BigNumber.from(10000), BigNumber.from(10000), BigNumber.from(3000), BigNumber.from(1000), '0x5741306c21795FdCBb9b265Ea0255F499DFe515C'.toLowerCase(), positionHouse.address);
    await fundingRateTest.initialize(BigNumber.from(500000), bep20Mintable.address, ethers.utils.formatBytes32String('BTC'), BigNumber.from(100), BigNumber.from(10000), BigNumber.from(10000), BigNumber.from(3000), BigNumber.from(1000), '0x5741306c21795FdCBb9b265Ea0255F499DFe515C'.toLowerCase(), positionHouse.address);
    await positionHouseConfiguration.initialize(BigNumber.from(3), BigNumber.from(80), BigNumber.from(3), BigNumber.from(20))
    await positionHouse.initialize(insuranceFund.address, positionHouseConfiguration.address, positionNotionalConfigProxy.address)
    await positionHouseViewer.initialize(positionHouse.address, positionHouseConfiguration.address)

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