import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, id } from 'ethers'

import { EVMTokenManager } from './index.ts'
import { CCIPWalletInvalidError } from '../../errors/index.ts'
import type { EVMChain } from '../../evm/index.ts'
import { ChainFamily } from '../../networks.ts'
import { CCTContractTypeInvalidError, CCTParamsInvalidError } from '../errors.ts'

const TOKEN = '0x' + '11'.repeat(20)
const POOL = '0x' + '22'.repeat(20)
const ROUTER = '0x' + '33'.repeat(20)
const TAR = '0x' + '44'.repeat(20)

/** Minimal EVMChain stub — only the members EVMTokenManager touches. */
function stubChain(overrides: Partial<EVMChain> = {}, poolVersion = '1.5.1'): EVMChain {
  return {
    provider: {} as never,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    getTokenAdminRegistryFor: (_address: string) => Promise.resolve(TAR),
    typeAndVersion: (_address: string) => Promise.resolve(['BurnMintTokenPool', poolVersion]),
    nextNonce: async () => 0,
    rollbackNonce: () => {},
    ...overrides,
  } as unknown as EVMChain
}

const HASH = '0x' + 'ab'.repeat(32)

/** Fake ethers Signer whose broadcast resolves to a confirmed receipt. */
function fakeSigner() {
  return {
    signTransaction: () => Promise.resolve('0x'),
    getAddress: () => Promise.resolve(TOKEN),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: () =>
      Promise.resolve({ hash: HASH, wait: () => Promise.resolve({ status: 1 }) }),
  }
}

const SET_POOL_SELECTOR = id('setPool(address,address)').slice(0, 10)
const EXPECTED_DATA = new Interface([
  'function setPool(address localToken, address pool)',
]).encodeFunctionData('setPool', [TOKEN, POOL])
const EXPECTED_TRANSFER = new Interface([
  'function transferOwnership(address to)',
]).encodeFunctionData('transferOwnership', [TOKEN])

describe('EVMTokenManager (cct/evm)', () => {
  describe('construction', () => {
    it('fromChain wraps an existing chain and exposes its provider', () => {
      const chain = stubChain()
      const cct = EVMTokenManager.fromChain(chain)
      assert.ok(cct instanceof EVMTokenManager)
      assert.equal(cct.chain, chain)
      assert.equal(cct.provider, chain.provider)
    })
  })

  describe('generateUnsignedSetPool', () => {
    it('encodes setPool(token, pool) to the discovered TAR', async () => {
      const cct = EVMTokenManager.fromChain(stubChain())
      const unsigned = await cct.generateUnsignedSetPool({
        tokenAddress: TOKEN,
        poolAddress: POOL,
        address: ROUTER,
        sender: TOKEN,
      })

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)

      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, TAR)
      assert.equal(tx.from, TOKEN)
      assert.ok(tx.data!.startsWith(SET_POOL_SELECTOR), 'data starts with setPool selector')
      assert.equal(tx.data, EXPECTED_DATA)
    })

    it('discovers the TAR from the router address', async () => {
      let seen: string | undefined
      const cct = EVMTokenManager.fromChain(
        stubChain({
          getTokenAdminRegistryFor: (address: string) => {
            seen = address
            return Promise.resolve(TAR)
          },
        }),
      )
      await cct.generateUnsignedSetPool({
        tokenAddress: TOKEN,
        poolAddress: POOL,
        address: ROUTER,
      })
      assert.equal(seen, ROUTER)
    })

    it('omits `from` when no sender is given', async () => {
      const cct = EVMTokenManager.fromChain(stubChain())
      const unsigned = await cct.generateUnsignedSetPool({
        tokenAddress: TOKEN,
        poolAddress: POOL,
        address: ROUTER,
      })
      assert.equal(unsigned.transactions[0]!.from, undefined)
    })

    it('rejects an invalid address before any RPC, tagged with the operation', async () => {
      let called = false
      const cct = EVMTokenManager.fromChain(
        stubChain({
          getTokenAdminRegistryFor: () => {
            called = true
            return Promise.resolve(TAR)
          },
        }),
      )
      await assert.rejects(
        () =>
          cct.generateUnsignedSetPool({
            tokenAddress: 'not-an-address',
            poolAddress: POOL,
            address: ROUTER,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setPool' &&
          err.context.param === 'tokenAddress',
      )
      assert.equal(called, false, 'validation fails before TAR discovery')
    })
  })

  describe('setPool', () => {
    it('signs and submits, resolving to the confirmed tx hash', async () => {
      const cct = EVMTokenManager.fromChain(stubChain())
      const result = await cct.setPool({
        tokenAddress: TOKEN,
        poolAddress: POOL,
        address: ROUTER,
        wallet: fakeSigner(),
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a non-signer wallet', async () => {
      const cct = EVMTokenManager.fromChain(stubChain())
      await assert.rejects(
        () =>
          cct.setPool({
            tokenAddress: TOKEN,
            poolAddress: POOL,
            address: ROUTER,
            wallet: {},
          }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })
  })

  describe('transferOwnership', () => {
    it('probes the pool type/version, then builds transferOwnership to the pool', async () => {
      const probed: string[] = []
      const cct = EVMTokenManager.fromChain(
        stubChain({
          typeAndVersion: ((address: string) => {
            probed.push(address)
            return Promise.resolve(['BurnMintTokenPool', '1.5.1', 'BurnMintTokenPool 1.5.1'])
          }) as unknown as EVMChain['typeAndVersion'],
        }),
      )
      const unsigned = await cct.generateUnsignedTransferOwnership({
        poolAddress: POOL,
        newOwner: TOKEN,
      })
      assert.deepEqual(probed, [POOL]) // resolved the pool's type/version from its own address
      assert.equal(unsigned.transactions[0]!.to, POOL)
      assert.equal(unsigned.transactions[0]!.data, EXPECTED_TRANSFER)
    })

    it('surfaces an unsupported pool type reported by the probe', async () => {
      const cct = EVMTokenManager.fromChain(
        stubChain({
          typeAndVersion: (() =>
            Promise.resolve([
              'NotATokenPool',
              '1.5.1',
              'NotATokenPool 1.5.1',
            ])) as unknown as EVMChain['typeAndVersion'],
        }),
      )
      await assert.rejects(
        cct.generateUnsignedTransferOwnership({ poolAddress: POOL, newOwner: TOKEN }),
        (err: unknown) => err instanceof CCTContractTypeInvalidError,
      )
    })
  })
})
