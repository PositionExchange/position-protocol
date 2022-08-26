import dotenv from "dotenv"
import { join, resolve } from "path"
dotenv.config()

export const ROOT_DIR = __dirname
export const SRC_DIR_NAME = "src"
const LEGACY_SRC_DIR_NAME = join(SRC_DIR_NAME, "legacy")

export const COVERAGE_URL = "http://127.0.0.1:8555"
export const LOCALHOST_URL = "http://127.0.0.1:8545"
export const BSC_TESTNET_URL = process.env["BSC_TESTNET_ENDPOINT"] || "https://data-seed-prebsc-1-s1.binance.org:8545/"
export const BSC_MAINNET_URL = process.env["BSC_MAINNET_ENDPOINT"] || "https://bsc-dataseed.binance.org/"
export const GANACHE_QC_URL = process.env["GANACHE_QC_ENDPOINT"] || "http://geth.nonprodposi.com/"
export const POSI_CHAIN_DEVNET_URL = process.env["GANACHE_QC_ENDPOINT"] || "https://api.s0.d.posichain.org/"
export const POSI_CHAIN_TESTNET_URL = process.env["GANACHE_QC_ENDPOINT"] || "https://api.s0.t.posichain.org/"
export const PRIV_TESTNET_ACCOUNT = process.env["PRIV_TESTNET_ACCOUNT"] || ""
export const PRIV_MAINNET_ACCOUNT = process.env["PRIV_MAINNET_ACCOUNT"] || ""
export const PRIV_GANACHE_ACCOUNT = process.env["PRIV_GANACHE_ACCOUNT"] || ""
export const PRIV_POSI_CHAIN_DEVNET_ACCOUNT = process.env["PRIV_POSI_CHAIN_DEVNET_ACCOUNT"] || ""
export const PRIV_POSI_CHAIN_TESTNET_ACCOUNT = process.env["PRIV_POSI_CHAIN_TESTNET_ACCOUNT"] || ""
export const BUSD_ADDRESS = "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56"
export const POSI_ADDRESS = "0x5ca42204cdaa70d5c773946e69de942b85ca6706"
export const BUSD = 'BUSD'
export const POSI = 'POSI'

// export const BSC_TESTNET_URL = `${process.env["BSC_TESTNET"]}
// export const ROPSTEN_URL = `${process.env["WEB3_ENDPOINT"]}`
// export const KOVAN_URL = `${process.env["WEB3_KOVAN_ENDPOINT"]}`
// export const RINKEBY_URL = `${process.env["WEB3_RINKEBY_ENDPOINT"]}`
// export const HOMESTEAD_URL = `${process.env["WEB3_HOMESTEAD_ENDPOINT"]}`
// export const SOKOL_URL = `${process.env["WEB3_SOKOL_ENDPOINT"]}`
// export const XDAI_URL = `${process.env["WEB3_XDAI_ENDPOINT"]}`
// export const RINKEBY_ARCHIVE_NODE_URL = `${process.env["ALCHEMY_RINKEBY_ENDPOINT"]}`
// export const HOMESTEAD_ARCHIVE_NODE_URL = `${process.env["ALCHEMY_HOMESTEAD_ENDPOINT"]}`
// export const XDAI_ARCHIVE_NODE_URL = "https://xdai-archive.blockscout.com"
// export const ROPSTEN_MNEMONIC = process.env["ROPSTEN_MNEMONIC"] || ""
// export const KOVAN_MNEMONIC = process.env["KOVAN_MNEMONIC"] || ""
// export const RINKEBY_MNEMONIC = process.env["RINKEBY_MNEMONIC"] || ""
// export const HOMESTEAD_MNEMONIC = process.env["HOMESTEAD_MNEMONIC"] || ""
// export const SOKOL_MNEMONIC = process.env["SOKOL_MNEMONIC"] || ""
// export const XDAI_MNEMONIC = process.env["XDAI_MNEMONIC"] || ""
export const ARTIFACTS_DIR = "./artifacts"
export const GAS = 8000000
export const GAS_PRICE = 2_000_000_000
export const SRC_DIR = join(ROOT_DIR, SRC_DIR_NAME)
export const LEGACY_SRC_DIR = join(ROOT_DIR, LEGACY_SRC_DIR_NAME)
export const ETHERSCAN_API_KEY = process.env["ETHERSCAN_API_KEY"] || ""
export const CHAINLINK_ABI_TESTNET = [{"inputs":[{"internalType":"bytes32","name":"_priceFeedKey","type":"bytes32"},{"internalType":"address","name":"_aggregator","type":"address"}],"name":"addAggregator","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes32","name":"_priceFeedKey","type":"bytes32"}],"name":"getAggregator","outputs":[{"internalType":"contract AggregatorV3Interface","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"contract AggregatorV3Interface","name":"_aggregator","type":"address"}],"name":"getLatestRoundDataTest","outputs":[{"internalType":"uint80","name":"round","type":"uint80"},{"internalType":"int256","name":"latestPrice","type":"int256"},{"internalType":"uint256","name":"latestTimestamp","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"_priceFeedKey","type":"bytes32"}],"name":"getLatestTimestamp","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"_priceFeedKey","type":"bytes32"},{"internalType":"uint256","name":"_numOfRoundBack","type":"uint256"}],"name":"getPreviousPrice","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"_priceFeedKey","type":"bytes32"},{"internalType":"uint256","name":"_numOfRoundBack","type":"uint256"}],"name":"getPreviousTimestamp","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"_priceFeedKey","type":"bytes32"}],"name":"getPrice","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"contract AggregatorV3Interface","name":"_aggregator","type":"address"},{"internalType":"uint80","name":"_round","type":"uint80"}],"name":"getRoundDataTest","outputs":[{"internalType":"int256","name":"latestPrice","type":"int256"},{"internalType":"uint256","name":"startedAt","type":"uint256"},{"internalType":"uint256","name":"latestTimestamp","type":"uint256"},{"internalType":"uint80","name":"answeredInRound","type":"uint80"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"_priceFeedKey","type":"bytes32"},{"internalType":"uint256","name":"_interval","type":"uint256"}],"name":"getTwapPrice","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"name":"priceFeedDecimalMap","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"","type":"uint256"}],"name":"priceFeedKeys","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"name":"priceFeedMap","outputs":[{"internalType":"contract AggregatorV3Interface","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"_priceFeedKey","type":"bytes32"}],"name":"removeAggregator","outputs":[],"stateMutability":"nonpayable","type":"function"}]