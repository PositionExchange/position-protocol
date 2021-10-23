require("@nomiclabs/hardhat-waffle")
require('@nomiclabs/hardhat-ethers')
require('@nomiclabs/hardhat-etherscan')
// import "@nomiclabs/hardhat-waffle";
// import '@nomiclabs/hardhat-ethers';
// import '@nomiclabs/hardhat-etherscan';
// import "@typechain/hardhat";
// import {task} from "hardhat/config";
// import {BSC_MAINNET_URL, BSC_TESTNET_URL, GAS_PRICE} from "./constants";
const BSC_TESTNET_URL =
    `${process.env["BSC_TESTNET_ENDPOINT"]}` || "https://data-seed-prebsc-1-s1.binance.org:8545/"
const BSC_MAINNET_URL = `${process.env["BSC_MAINNET_ENDPOINT"]}`
// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
// task("accounts", "Prints the list of accounts", async (args, hre) => {
//     const accounts = await hre.ethers.getSigners();
//     for (const account of accounts) {
//         console.log(account.address);
//     }
// });

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
    defaultNetwork: "hardhat",

    networks: {
        localhost: {
            url: "http://127.0.0.1:8545"
        },
        hardhat: {
            allowUnlimitedContractSize: true,
        },
        testnet: {
            url: 'https://data-seed-prebsc-1-s1.binance.org:8545/',
            chainId: 97,
            gasPrice: 20000000000,
            accounts: ["e797cad59780e24c113373fc91345869d7eab37ea0e843117575854b01625df4"],
        },
        mainnet: {
            url: BSC_MAINNET_URL,
            chainId: 56,
            gasPrice: 20000000000,
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
    etherscan: {
        apiKey: 'TEMK85WIQR8NGI74AZBCJ3J88FI49XRHJN',
    },
    typechain: {
        outDir: "typeChain",
        target: "ethers-v5",
    },
    mocha: {
        timeout: 100000
    }
};

