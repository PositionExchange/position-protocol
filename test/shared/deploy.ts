import {ethers} from "hardhat";
import {BEP20Mintable, InsuranceFund, PositionHouse, PositionHouseFunction, PositionHouseViewer, PositionManager} from "../../typeChain";
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

    // Deploy mock busd contract
    const bep20MintableFactory = await ethers.getContractFactory('BEP20Mintable')
    let bep20Mintable = (await bep20MintableFactory.deploy('BUSD Mock', 'BUSD')) as unknown as BEP20Mintable

    // Deploy insurance fund contract
    const insuranceFundFactory = await ethers.getContractFactory('InsuranceFund')
    let insuranceFund = (await insuranceFundFactory.deploy()) as unknown as InsuranceFund

    // Deploy position manager contract
    let positionManagerFactory = await ethers.getContractFactory("PositionManager")
    let positionManager = (await positionManagerFactory.deploy()) as unknown as PositionManager;
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
    let positionHouse = (await factory.deploy()) as unknown as PositionHouse;
    await insuranceFund.connect(trader).initialize()
    await insuranceFund.connect(trader).setCounterParty(positionHouse.address);

    (await ethers.getSigners()).forEach(element => {
        bep20Mintable.mint(element.address, BigNumber.from('10000000000000000000000000000000'))
        bep20Mintable.connect(element).approve(insuranceFund.address, BigNumber.from('1000000000000000000000000000000000000'))
    })
    let positionManagerTestingTool = new PositionManagerTestingTool(positionManager)
    let positionHouseTestingTool = new PositionHouseTestingTool(positionHouse, positionManager)

    await positionManager.initialize(BigNumber.from(500000), bep20Mintable.address, ethers.utils.formatBytes32String('BTC'), BigNumber.from(100), BigNumber.from(10000), BigNumber.from(10000), BigNumber.from(3000), BigNumber.from(1000), '0x5741306c21795FdCBb9b265Ea0255F499DFe515C'.toLowerCase(), positionHouse.address);
    await positionHouse.initialize(BigNumber.from(3), BigNumber.from(80), BigNumber.from(3), BigNumber.from(20), insuranceFund.address)
    await positionHouseViewer.initialize(positionHouse.address)

    await insuranceFund.updateWhitelistManager(positionManager.address, true);

    return [
        positionHouse,
        positionManager,
        positionManagerFactory,
        positionManagerTestingTool,
        positionHouseTestingTool,
        bep20Mintable,
        insuranceFund,
        positionHouseViewer
    ]

}