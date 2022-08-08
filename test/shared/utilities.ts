import bn from 'bignumber.js'
import {BigNumber, BigNumberish, constants, Contract, ContractTransaction, utils, Wallet} from 'ethers'
import web3Utils from "web3-utils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {PositionManager} from "../../typeChain";
import Decimal from 'decimal.js'

const {web3, ethers} = require("hardhat");

// const web3Utils = require('web3-utils')


export const MaxUint128 = BigNumber.from(2).pow(128).sub(1)

export const getMinTick = (tickSpacing: number) => Math.ceil(-887272 / tickSpacing) * tickSpacing
export const getMaxTick = (tickSpacing: number) => Math.floor(887272 / tickSpacing) * tickSpacing
export const getMaxLiquidityPerTick = (tickSpacing: number) =>
    BigNumber.from(2)
        .pow(128)
        .sub(1)
        .div((getMaxTick(tickSpacing) - getMinTick(tickSpacing)) / tickSpacing + 1)

export const MIN_SQRT_RATIO = BigNumber.from('4295128739')
export const MAX_SQRT_RATIO = BigNumber.from('1461446703485210103287273052203988822378723970342')

export enum FeeAmount {
    LOW = 500,
    MEDIUM = 3000,
    HIGH = 10000,
}

export const TICK_SPACINGS: { [amount in FeeAmount]: number } = {
    [FeeAmount.LOW]: 10,
    [FeeAmount.MEDIUM]: 60,
    [FeeAmount.HIGH]: 200,
}

export function expandTo18Decimals(n: number): BigNumber {
    return BigNumber.from(n).mul(BigNumber.from(10).pow(18))
}

export function getCreate2Address(
    factoryAddress: string,
    [tokenA, tokenB]: [string, string],
    fee: number,
    bytecode: string
): string {
    const [token0, token1] = tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA]
    const constructorArgumentsEncoded = utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint24'],
        [token0, token1, fee]
    )
    const create2Inputs = [
        '0xff',
        factoryAddress,
        // salt
        utils.keccak256(constructorArgumentsEncoded),
        // init code. bytecode + constructor arguments
        utils.keccak256(bytecode),
    ]
    const sanitizedInputs = `0x${create2Inputs.map((i) => i.slice(2)).join('')}`
    return utils.getAddress(`0x${utils.keccak256(sanitizedInputs).slice(-40)}`)
}

bn.config({EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40})

// returns the sqrt price as a 64x96
export function encodePriceSqrt(reserve1: BigNumberish, reserve0: BigNumberish): BigNumber {
    return BigNumber.from(
        new bn(reserve1.toString())
            .div(reserve0.toString())
            .sqrt()
            .multipliedBy(new bn(2).pow(96))
            .integerValue(3)
            .toString()
    )
}

export function toWei(n: number | string): any {
    return BigNumber.from(web3Utils.toWei(n.toString()))
}

export function multiNumberToWei(n: (number | string | BigNumber)[]): any {
    let convertedArray = []
    for (let i = 0; i < n.length; i++) {
        if (n[i] != undefined) {
            convertedArray.push(toWei(n[i].toString()))
        } else {
            convertedArray.push(undefined)
        }
    }
    return convertedArray
}

export function fromWei(n: number | string): any {
    return web3Utils.fromWei(n.toString())
}

export function toWeiBN(n: string) {
    return ethers.utils.parseEther(n)
}

export function toWeiWithString(n: string): any {
    return web3Utils.toWei(n)
}

export function fromWeiWithString(n: string): any {
    return web3Utils.fromWei(n)
}

export function stringToBytes32(str: string): string {
    // return ethers.utils.toUtf8Bytes(str);
    return ethers.utils.formatBytes32String(str)
    // return web3Utils.asciiToHex(str)
}

export function fromBytes32(str: string): string {
    return ethers.utils.parseBytes32String(str);
    // return web3Utils.hexToUtf8(str)
}

export function pipToPrice(pip: number, basicPoint = 0.01): number | string {
    return pip * basicPoint;
}

export function priceToPip(price: number | string, basicPoint = 0.01): string | number {

    return Number(price) / basicPoint;


}


export const SIDE = {
    LONG: 0,
    SHORT: 1
}


export interface OpenLimitPositionAndExpectParams {
    _trader?: SignerWithAddress
    limitPrice: number | string | BigNumber
    leverage: number | BigNumber,
    quantity: number | BigNumber
    side: number
    _positionManager?: PositionManager
    skipCheckBalance?: boolean
}

export interface OpenMarketPositionParams {
    quantity: BigNumber,
    leverage: number,
    side: number,
    trader?: string,
    instanceTrader: any,
    expectedMargin?: BigNumber,
    expectedNotional?: BigNumber | string,
    expectedSize?: BigNumber,
    expectDeposit?: BigNumber | string,
    price?: number,
    _positionManager?: any
}

export interface PositionData {
      quantity: BigNumber;
      margin: BigNumber;
      openNotional: BigNumber;
      lastUpdatedCumulativePremiumFraction: BigNumber;
      blockNumber: BigNumber;
      leverage: number;
      __dummy: number;
}

export interface MaintenanceDetail {
    maintenanceMargin: BigNumber
    marginBalance: BigNumber
    marginRatio: BigNumber
}

export interface PositionLimitOrderID {
    pip: BigNumber,
    orderId: BigNumber
    orderIdOfTrader: BigNumber
}

export interface ClaimFund {
    canClaim: boolean,
    amount: BigNumber
    realPnL: BigNumber
}

export interface PositionPendingOrder {
    limitPrice: BigNumber
    leverage: BigNumber,
    quantity: BigNumber
    side: BigNumber,
    margin: BigNumber
    openNotional: BigNumber
}

export interface PendingOrder {
    isFilled: boolean,
    isBuy: boolean,
    size: BigNumber,
    partialFilled: BigNumber
}

export interface LimitOrderReturns {
    orderId: string;
    pip: string;
}

export interface NotionalAndUnrealizedPnlReturns {
    positionNotional : BigNumber
    unrealizedPnl : BigNumber
}

export interface ChangePriceParams {
    limitPrice: number | string
    toHigherPrice: boolean
    _positionManager?: PositionManager
}

export interface ExpectTestCaseParams {
    positionManagerAddress: string,
    traderAddress: string,
    expectedOpenNotional?: BigNumber | string | number,
    expectedMargin?: BigNumber | string | number,
    expectedPnl?: BigNumber | string | number
    expectedQuantity?: BigNumber | string | number
    expectedMaintenanceMargin?: BigNumber | string | number
    expectedMarginBalance?: BigNumber | string | number
    expectedMarginRatio?: BigNumber | string | number
}

export interface ExpectMaintenanceDetail {
    positionManagerAddress: string,
    traderAddress: string,
    expectedMarginRatio: number,
    expectedMaintenanceMargin: number,
    expectedMarginBalance: number,
}

export interface MarketOrderReturns {
    size: BigNumber,
    openNotional: BigNumber
}

export enum OrderType {
    Limit = 'limit',
    Market = 'market'
}

export enum OrderSide {
    Long = 'long',
    Short = 'short',
    Close = 'close'
}

export enum POSITION_SIDE {
    LONG,
    SHORT
}

export interface OpenLimitInHouseParams {
    pip: BigNumber,
    quantity: BigNumber,
    leverage: number,
    side: number,
    instanceTrader: any
}

export interface OpenMarketInHouseParams {
    quantity: BigNumber,
    leverage: number,
    side: number,
    instanceTrader: any
}

export const subDecimal = (a: number, b: number): number => {
    return new Decimal(a).minus(new Decimal(b)).toNumber()
}

export interface OrderData {
    pip: number,
    quantity: number
}

export interface CancelLimitOrderParams {
    trader?: SignerWithAddress
    positionManager?: PositionManager
    orderIdx: number | string,
    isReduce: number | string,
    refundAmount?: number | string
}

export interface ExpectClaimFund {
    trader?: SignerWithAddress,
    positionManager?: PositionManager,
    claimableAmount: number | string
}

