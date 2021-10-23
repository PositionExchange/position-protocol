const {formatBytes32String} = require( "ethers/lib/utils");

const hre = require("hardhat");
const { version } = require('chai');


async function verifyContract(address, args, contract ) {
    const verifyObj = {address}
    if(args){
        verifyObj.constructorArguments = args
    }
    if(contract){
        verifyObj.contract = contract;
    }
    console.log("verifyObj", verifyObj)
    return hre
        .run("verify:verify", verifyObj)
        .then(() =>
            console.log(
                "Contract address verified:",
                address
            )
        );
}

async function main() {
    const ChainLink = await hre.ethers.getContractFactory("ChainLinkPriceFeed");
    const hardhatChainLink = await ChainLink.deploy();

    await hardhatChainLink.deployed();

    console.log("ChainLink deployed to:", hardhatChainLink.address);
    await verifyContract(hardhatChainLink.address)
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });