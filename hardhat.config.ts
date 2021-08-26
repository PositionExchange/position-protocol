import "@nomiclabs/hardhat-waffle";
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-etherscan';
import "@typechain/hardhat";
import {task} from "hardhat/config";
import {BSC_TESTNET_URL, GAS_PRICE} from "./constants";

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (args, hre) => {
    const accounts = await hre.ethers.getSigners();
    for (const account of accounts) {
        console.log(account.address);
    }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
    networks: {
        hardhat: {
            allowUnlimitedContractSize: true,
        },
        // coverage: {
        //     url: COVERAGE_URL,
        // },
        bsctestnet: {
            url: BSC_TESTNET_URL,
            chainId: 97,
            gasPrice: 20000000000,
            // gasPrice: 5000000000,
            accounts: ["e797cad59780e24c113373fc91345869d7eab37ea0e843117575854b01625df4"],
        },

    },

    solidity: {
        compilers: [
            {
                version: "0.8.0",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 1000,
                    },
                },
            },
            {
                version: "0.6.0",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 1000,
                    },
                },
            }

        ]
    },
    typechain: {
        outDir: "typeChain",
        target: "ethers-v5",
    }
};

