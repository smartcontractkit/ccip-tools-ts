import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, JsonRpcProvider, id } from 'ethers'

import { EVMTokenAdmin } from './index.ts'
import {
  CCIPProvideLiquidityParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import ERC20LockBoxABI from '../../evm/abi/ERC20LockBox.ts'
import TokenPool_1_6_ABI from '../../evm/abi/LockReleaseTokenPool_1_6_1.ts'
import TokenPool_2_0_ABI from '../../evm/abi/TokenPool_2_0.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../networks.ts'
import { CCIPVersion } from '../../types.ts'

// ── Helpers ──

const dummyNetwork: NetworkInfo = {
  name: 'test',
  family: ChainFamily.EVM,
  chainSelector: 1n,
  chainId: 1,
  networkType: NetworkType.Testnet,
}

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} }

const POOL = '0xb857E4C876D45742411CFa22f6f063C489599E2E'
const TOKEN = '0x302F39fE7443EF10576Ba9A3f79b2bAe51CDbdFE'
const LOCKBOX = '0x4e3D08ce9c861E51D1C7028c9FfE45aA17790fFc'
const AMOUNT = 1_000n * 10n ** 18n

const erc20Iface = new Interface(['function approve(address spender, uint256 amount)'])
const iface20 = new Interface(TokenPool_2_0_ABI)
const iface16 = new Interface(TokenPool_1_6_ABI)
const lockBoxIface = new Interface(ERC20LockBoxABI)

const GET_TOKEN_SEL = id('getToken()').slice(0, 10)
const GET_LOCKBOX_SEL = id('getLockBox()').slice(0, 10)

/** Mocks provider.call so getToken / getLockBox resolve without RPC. */
function mockPoolReads(provider: JsonRpcProvider): void {
  provider.call = async (tx) => {
    const data = (tx.data ?? '0x').slice(0, 10)
    if (data === GET_TOKEN_SEL) return iface20.encodeFunctionResult('getToken', [TOKEN])
    if (data === GET_LOCKBOX_SEL) return iface20.encodeFunctionResult('getLockBox', [LOCKBOX])
    return '0x'
  }
}

function makeAdmin(provider: JsonRpcProvider, type: string, version: string): EVMTokenAdmin {
  const admin = new EVMTokenAdmin(provider, dummyNetwork, {
    logger: silentLogger,
    apiClient: null,
  })
  admin.typeAndVersion = async () => [type, version, `${type} ${version}`]
  return admin
}

// =============================================================================
// generateUnsignedProvideLiquidity — version dispatch
// =============================================================================

describe('EVMTokenAdmin provideLiquidity — versioned interaction', () => {
  it('v2.0 lock-release: approve(lockBox) + lockBox.deposit(token, 0, amount)', async () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    it.after(() => provider.destroy())
    const admin = makeAdmin(provider, 'LockReleaseTokenPool', CCIPVersion.V2_0)
    mockPoolReads(provider)

    const unsigned = await admin.generateUnsignedProvideLiquidity({
      poolAddress: POOL,
      amount: AMOUNT,
    })
    assert.equal(unsigned.transactions.length, 2)

    const [approveTx, depositTx] = unsigned.transactions
    // approve goes to the token, spender = lockBox
    assert.equal((approveTx!.to as string).toLowerCase(), TOKEN.toLowerCase())
    const approveArgs = erc20Iface.decodeFunctionData('approve', approveTx!.data!)
    assert.equal((approveArgs[0] as string).toLowerCase(), LOCKBOX.toLowerCase())
    assert.equal(approveArgs[1] as bigint, AMOUNT)
    // deposit goes to the lockBox: deposit(token, remoteChainSelector(unused), amount)
    assert.equal((depositTx!.to as string).toLowerCase(), LOCKBOX.toLowerCase())
    const depArgs = lockBoxIface.decodeFunctionData('deposit', depositTx!.data!)
    assert.equal((depArgs[0] as string).toLowerCase(), TOKEN.toLowerCase())
    assert.equal(depArgs[2] as bigint, AMOUNT)
  })

  it('v1.6 lock-release: approve(pool) + pool.provideLiquidity(amount)', async () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    it.after(() => provider.destroy())
    const admin = makeAdmin(provider, 'LockReleaseTokenPool', CCIPVersion.V1_6)
    mockPoolReads(provider)

    const unsigned = await admin.generateUnsignedProvideLiquidity({
      poolAddress: POOL,
      amount: AMOUNT,
    })
    assert.equal(unsigned.transactions.length, 2)

    const [approveTx, provideTx] = unsigned.transactions
    assert.equal((approveTx!.to as string).toLowerCase(), TOKEN.toLowerCase())
    const approveArgs = erc20Iface.decodeFunctionData('approve', approveTx!.data!)
    // v1.x spender = the pool itself
    assert.equal((approveArgs[0] as string).toLowerCase(), POOL.toLowerCase())
    // provideLiquidity(amount) on the pool
    assert.equal((provideTx!.to as string).toLowerCase(), POOL.toLowerCase())
    const provArgs = iface16.decodeFunctionData('provideLiquidity', provideTx!.data!)
    assert.equal(provArgs[0] as bigint, AMOUNT)
  })

  it('rejects non-lock-release (burn-mint) pools with a clear error', async () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    it.after(() => provider.destroy())
    const admin = makeAdmin(provider, 'BurnMintTokenPool', CCIPVersion.V2_0)

    await assert.rejects(
      () => admin.generateUnsignedProvideLiquidity({ poolAddress: POOL, amount: AMOUNT }),
      CCIPProvideLiquidityParamsInvalidError,
    )
  })

  it('rejects empty poolAddress and non-positive amount', async () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    it.after(() => provider.destroy())
    const admin = makeAdmin(provider, 'LockReleaseTokenPool', CCIPVersion.V2_0)

    await assert.rejects(
      () => admin.generateUnsignedProvideLiquidity({ poolAddress: '', amount: AMOUNT }),
      CCIPProvideLiquidityParamsInvalidError,
    )
    await assert.rejects(
      () => admin.generateUnsignedProvideLiquidity({ poolAddress: POOL, amount: 0n }),
      CCIPProvideLiquidityParamsInvalidError,
    )
  })

  it('signed provideLiquidity rejects a non-signer wallet', async () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    it.after(() => provider.destroy())
    const admin = makeAdmin(provider, 'LockReleaseTokenPool', CCIPVersion.V2_0)

    await assert.rejects(
      () => admin.provideLiquidity({}, { poolAddress: POOL, amount: AMOUNT }),
      CCIPWalletInvalidError,
    )
  })
})
