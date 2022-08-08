import "@nomiclabs/hardhat-waffle";
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-etherscan';
import "@openzeppelin/hardhat-upgrades"
import "@typechain/hardhat";
import "hardhat-contract-sizer"
import "@openzeppelin/hardhat-defender"
import {task} from "hardhat/config";
import {
    BSC_MAINNET_URL,
    BSC_TESTNET_URL,
    GAS_PRICE,
    PRIV_TESTNET_ACCOUNT,
    PRIV_MAINNET_ACCOUNT,
    GANACHE_QC_URL, PRIV_GANACHE_ACCOUNT
} from "./constants";
import "./scripts/deploy";
import "hardhat-gas-reporter";
import "solidity-coverage";
// const BSC_TESTNET_URL =
//     `${process.env["BSC_TESTNET_ENDPOINT"]}` || "https://data-seed-prebsc-1-s1.binance.org:8545/"
// const BSC_MAINNET_URL = `${process.env["BSC_MAINNET_ENDPOINT"]}`
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
    defaultNetwork: "hardhat",

    networks: {
        localhost: {
            url: "http://127.0.0.1:8545"
        },
        hardhat: {
            allowUnlimitedContractSize: true,
        },
        bsc_testnet: {
            url: BSC_TESTNET_URL,
            chainId: 97,
            accounts: PRIV_TESTNET_ACCOUNT ? [PRIV_TESTNET_ACCOUNT] : [],
        },
        bsc_mainnet: {
            url: BSC_MAINNET_URL,
            chainId: 56,
            accounts: PRIV_MAINNET_ACCOUNT ? [PRIV_MAINNET_ACCOUNT] : [],
        },
        qc: {
            url: GANACHE_QC_URL,
            chainId: 1337,
            accounts: PRIV_GANACHE_ACCOUNT ? [PRIV_GANACHE_ACCOUNT] : [],
        },
    },

    solidity: {
        compilers: [
            {
                version: "0.8.8",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            },
            {
                version: "0.8.0",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            },
            {
                version: "0.6.0",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            },
            {
                version: "0.8.2",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            }

        ]
    },
    etherscan: {
        apiKey: 'UXFZRYWHB141CX97CPECWH9V7E9QSPHUF6',
    },
    defender: {
        apiKey: process.env.DEFENDER_TEAM_API_KEY,
        apiSecret: process.env.DEFENDER_TEAM_API_SECRET_KEY,
    },
    typechain: {
        outDir: "typeChain",
        target: "ethers-v5",
    },
    contractSizer: {
        strict: true
    },
    mocha: {
        timeout: 100000
    }
};

