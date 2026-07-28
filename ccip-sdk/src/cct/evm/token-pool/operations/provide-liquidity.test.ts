import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AbiCoder, Interface, getAddress } from 'ethers'

import { ProvideLiquidity } from './provide-liquidity.ts'
import ERC20LockBox_ABI from '../../../../evm/abi/ERC20LockBox.ts'
import TokenPool_1_6_ABI from '../../../../evm/abi/LockReleaseTokenPool_1_6_1.ts'
import TokenPool_2_0_ABI from '../../../../evm/abi/TokenPool_2_0.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCIPVersion } from '../../../../types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

const POOL = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'
const TOKEN = '0xd7bf0e3d34b4c4f7d5f3c4c6b2a1e0f9c8b7a6d5'
const LOCK_BOX = '0xaabbccddeeff00112233445566778899aabbccdd'
const AMOUNT = 1_000n * 10n ** 18n

const approveIface = new Interface(['function approve(address spender, uint256 amount)'])
const poolIface_1_6 = new Interface(TokenPool_1_6_ABI)
const poolIface_2_0 = new Interface(TokenPool_2_0_ABI)
const lockBoxIface = new Interface(ERC20LockBox_ABI)

const WALLET = '0x00000000000000000000000000000000000000ab'

const enc = (addr: string) => AbiCoder.defaultAbiCoder().encode(['address'], [addr])
const encAddrs = (addrs: string[]) => AbiCoder.defaultAbiCoder().encode(['address[]'], [addrs])
const selector = (iface: Interface, name: string) => iface.getFunction(name)!.selector

/**
 * Stub chain: `typeAndVersion` reports the given pool type + version; `provider.call`
 * dispatches on the 4-byte selector to answer `getToken` / `getLockBox`.
 */
function stubChain(version: CCIPVersion, poolType = 'LockReleaseTokenPool'): EVMChain {
  const iface = version >= CCIPVersion.V2_0 ? poolIface_2_0 : poolIface_1_6
  const getTokenSel = selector(iface, 'getToken')
  const getLockBoxSel = version >= CCIPVersion.V2_0 ? selector(iface, 'getLockBox') : ''
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => Promise.resolve([poolType, version, '', undefined]),
    provider: {
      call: (tx: { data?: string }) => {
        const sel = (tx.data ?? '').slice(0, 10)
        if (sel === getTokenSel) return Promise.resolve(enc(TOKEN))
        if (sel === getLockBoxSel) return Promise.resolve(enc(LOCK_BOX))
        return Promise.reject(new Error(`unexpected call selector ${sel}`))
      },
    },
  } as unknown as EVMChain
}

describe('EVM cct provideLiquidity', () => {
  const op = new ProvideLiquidity()

  it('v1.6: [approve(pool), pool.provideLiquidity(amount)] — byte-identical', async () => {
    const unsigned = await op.generate(stubChain(CCIPVersion.V1_6), {
      poolAddress: POOL,
      amount: AMOUNT,
    })
    assert.equal(unsigned.family, ChainFamily.EVM)
    assert.equal(unsigned.transactions.length, 2)

    const [approveTx, provideTx] = unsigned.transactions
    assert.equal(approveTx!.to, getAddress(TOKEN))
    assert.equal(approveTx!.data, approveIface.encodeFunctionData('approve', [POOL, AMOUNT]))
    assert.equal(provideTx!.to, POOL)
    assert.equal(provideTx!.data, poolIface_1_6.encodeFunctionData('provideLiquidity', [AMOUNT]))
  })

  it('v2.0: [approve(lockBox), lockBox.deposit(token,0,amount)] — byte-identical', async () => {
    const unsigned = await op.generate(stubChain(CCIPVersion.V2_0), {
      poolAddress: POOL,
      amount: AMOUNT,
    })
    assert.equal(unsigned.transactions.length, 2)

    const [approveTx, provideTx] = unsigned.transactions
    assert.equal(approveTx!.to, getAddress(TOKEN))
    assert.equal(approveTx!.data, approveIface.encodeFunctionData('approve', [LOCK_BOX, AMOUNT]))
    assert.equal(provideTx!.to, getAddress(LOCK_BOX))
    assert.equal(provideTx!.data, lockBoxIface.encodeFunctionData('deposit', [TOKEN, 0n, AMOUNT]))
  })

  it('applies sender to from on the first tx', async () => {
    const unsigned = await op.generate(stubChain(CCIPVersion.V1_6), {
      poolAddress: POOL,
      amount: AMOUNT,
      sender: POOL,
    })
    assert.equal(unsigned.transactions[0]!.from, POOL)
  })

  it('rejects an invalid pool address before RPC', async () => {
    await assert.rejects(
      () => op.generate(stubChain(CCIPVersion.V1_6), { poolAddress: 'nope', amount: AMOUNT }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'poolAddress',
    )
  })

  it('rejects a non-positive amount', async () => {
    await assert.rejects(
      () => op.generate(stubChain(CCIPVersion.V1_6), { poolAddress: POOL, amount: 0n }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'amount',
    )
  })

  it('rejects non-lock-release pools', async () => {
    await assert.rejects(
      () =>
        op.generate(stubChain(CCIPVersion.V2_0, 'BurnMintTokenPool'), {
          poolAddress: POOL,
          amount: AMOUNT,
        }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'poolAddress',
    )
  })

  /**
   * Execute stub: `getAllAuthorizedCallers` returns `authorized`; `getLockBox`/`getToken`
   * answer the reads; every `sendTransaction` is recorded so tests can assert whether the
   * lockbox pre-authorize tx was issued. Signer/chain plumbing is minimal.
   */
  function executeStub(
    version: CCIPVersion,
    authorized: string[],
    poolType = 'LockReleaseTokenPool',
  ) {
    const iface = version >= CCIPVersion.V2_0 ? poolIface_2_0 : poolIface_1_6
    const getTokenSel = selector(iface, 'getToken')
    const getLockBoxSel = version >= CCIPVersion.V2_0 ? selector(iface, 'getLockBox') : ''
    const getAuthSel = selector(lockBoxIface, 'getAllAuthorizedCallers')
    const sent: { to?: string | null; data?: string }[] = []
    const wallet = {
      signTransaction: () => Promise.resolve('0x'),
      getAddress: () => Promise.resolve(getAddress(WALLET)),
      populateTransaction: (tx: { to?: string | null; data?: string }) =>
        Promise.resolve({ ...tx }),
      sendTransaction: (tx: { to?: string | null; data?: string }) => {
        sent.push(tx)
        return Promise.resolve({
          hash: `0xhash${sent.length}`,
          wait: () => Promise.resolve({ status: 1, hash: `0xhash${sent.length}` }),
        })
      },
    }
    const chain = {
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      typeAndVersion: () => Promise.resolve([poolType, version, '', undefined]),
      nextNonce: () => Promise.resolve(0),
      rollbackNonce: () => {},
      provider: {
        call: (tx: { data?: string }) => {
          const sel = (tx.data ?? '').slice(0, 10)
          if (sel === getTokenSel) return Promise.resolve(enc(TOKEN))
          if (sel === getLockBoxSel) return Promise.resolve(enc(LOCK_BOX))
          if (sel === getAuthSel) return Promise.resolve(encAddrs(authorized))
          return Promise.reject(new Error(`unexpected call selector ${sel}`))
        },
      },
    } as unknown as EVMChain
    return { chain, wallet, sent }
  }

  const applyAuthSel = selector(lockBoxIface, 'applyAuthorizedCallerUpdates')

  it('v2.0: pre-authorizes an unauthorized caller on the lockbox before approve+deposit', async () => {
    const { chain, wallet, sent } = executeStub(CCIPVersion.V2_0, [])
    await op.execute(chain, { poolAddress: POOL, amount: AMOUNT, wallet })
    assert.equal(sent.length, 3)
    assert.equal(getAddress(sent[0]!.to as string), getAddress(LOCK_BOX))
    assert.equal((sent[0]!.data ?? '').slice(0, 10), applyAuthSel)
    // the authorize update adds exactly the caller.
    const decoded = lockBoxIface.decodeFunctionData('applyAuthorizedCallerUpdates', sent[0]!.data!)
    assert.equal(
      getAddress((decoded[0] as { addedCallers: string[] }).addedCallers[0]!),
      getAddress(WALLET),
    )
  })

  it('v2.0: skips pre-authorize when the caller is already authorized', async () => {
    const { chain, wallet, sent } = executeStub(CCIPVersion.V2_0, [getAddress(WALLET)])
    await op.execute(chain, { poolAddress: POOL, amount: AMOUNT, wallet })
    assert.equal(sent.length, 2)
    assert.notEqual((sent[0]!.data ?? '').slice(0, 10), applyAuthSel)
  })

  it('v1.6: never issues a pre-authorize tx (no lockbox)', async () => {
    const { chain, wallet, sent } = executeStub(CCIPVersion.V1_6, [])
    await op.execute(chain, { poolAddress: POOL, amount: AMOUNT, wallet })
    assert.equal(sent.length, 2)
    assert.notEqual((sent[0]!.data ?? '').slice(0, 10), applyAuthSel)
  })
})
