import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress } from 'ethers'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
import { type SetCCIPAdminParams, SetCCIPAdmin } from './set-ccip-admin.ts'

const TOKEN = '0x' + '11'.repeat(20)
const ADMIN = '0x' + '22'.repeat(20)
const NEW_ADMIN = '0x' + '33'.repeat(20)
const OTHER = '0x' + '44'.repeat(20)
const OWNER = '0x' + '55'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
const FRESH = new Interface([
  'function setCCIPAdmin(address newAdmin)',
  'function defaultAdmin() view returns (address)',
])
/** The CrossChainPoolToken getters the op reads, from signature literals, never the vendored ABI. */
const POOL_TOKEN = new Interface([
  'function owner() view returns (address)',
  'function getCCIPAdmin() view returns (address)',
])

function stubChain({ admin = ADMIN } = {}): EVMChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    network: networkInfo('ethereum-testnet-sepolia-base-1'),
    typeAndVersion: () => Promise.resolve(['CrossChainToken', '2.0.0', 'CrossChainToken 2.0.0']),
    provider: {
      call: ({ data }: { data: string }) => {
        assert.equal(FRESH.getFunction(data.slice(0, 10))!.name, 'defaultAdmin')
        return Promise.resolve(FRESH.encodeFunctionResult('defaultAdmin', [admin]))
      },
    },
    nextNonce: () => Promise.resolve(0),
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

/**
 * EVMChain stub for a CrossChainPoolToken v2.0.0 owned by `OWNER`, whose CCIP admin is `ADMIN`.
 * `calls` records the `eth_call`s the op makes, as decoded function names.
 */
function stubPoolTokenChain({ version = '2.0.0', calls = [] as string[] } = {}): EVMChain {
  const results: Record<string, unknown[]> = { owner: [OWNER], getCCIPAdmin: [ADMIN] }
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    network: networkInfo('ethereum-testnet-sepolia-base-1'),
    typeAndVersion: () =>
      Promise.resolve(['CrossChainPoolToken', version, `CrossChainPoolToken ${version}`]),
    provider: {
      call: ({ data }: { data: string }) => {
        const fn = POOL_TOKEN.getFunction(data.slice(0, 10))!.name
        calls.push(fn)
        return Promise.resolve(POOL_TOKEN.encodeFunctionResult(fn, results[fn]))
      },
    },
    nextNonce: () => Promise.resolve(0),
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

function fakeSigner(address = ADMIN) {
  return {
    signTransaction: () => Promise.resolve('0x'),
    getAddress: () => Promise.resolve(address),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: () =>
      Promise.resolve({ hash: HASH, wait: () => Promise.resolve({ status: 1 }) }),
  }
}

const op = new SetCCIPAdmin()
function generate(chain: EVMChain, overrides: Partial<SetCCIPAdminParams> = {}) {
  return op.generate(chain, {
    tokenAddress: TOKEN,
    newAdmin: NEW_ADMIN,
    sender: ADMIN,
    ...overrides,
  })
}

describe('SetCCIPAdmin (cct/evm)', () => {
  describe('generate', () => {
    it('encodes setCCIPAdmin(address) to a CrossChainToken', async () => {
      const unsigned = await generate(stubChain())
      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions[0]!.to, TOKEN)
      assert.equal(unsigned.transactions[0]!.from, ADMIN)
      assert.equal(
        unsigned.transactions[0]!.data,
        FRESH.encodeFunctionData('setCCIPAdmin', [NEW_ADMIN]),
      )
    })

    it('allows zero newAdmin, which CrossChainToken permits unlike BaseERC20', async () => {
      const unsigned = await generate(stubChain(), { newAdmin: ZeroAddress })
      assert.equal(
        unsigned.transactions[0]!.data,
        FRESH.encodeFunctionData('setCCIPAdmin', [ZeroAddress]),
      )
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['tokenAddress', ZeroAddress],
      ['newAdmin', 'not-an-address'],
      ['sender', 'not-an-address'],
    ] as const) {
      it(`rejects ${param} before RPC`, async () => {
        await assert.rejects(
          () => generate(stubChain(), { [param]: value }),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
      })
    }
  })

  describe('version and default-admin checks', () => {
    it('rejects a contract that is not a CrossChainToken', async () => {
      const chain = stubChain()
      chain.typeAndVersion = () => Promise.resolve(['FactoryBurnMintERC20', '1.6.2', ''])
      await assert.rejects(() => generate(chain), CCTContractTypeInvalidError)
    })

    it('rejects a sender that is not the current default admin', async () => {
      await assert.rejects(
        () => generate(stubChain(), { sender: OTHER }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })
  })

  describe('CrossChainPoolToken', () => {
    it('encodes setCCIPAdmin(address) to the pool token as its owner', async () => {
      const calls: string[] = []
      const unsigned = await generate(stubPoolTokenChain({ calls }), { sender: OWNER })
      assert.equal(unsigned.transactions[0]!.to, TOKEN)
      assert.equal(unsigned.transactions[0]!.from, OWNER)
      assert.equal(
        unsigned.transactions[0]!.data,
        FRESH.encodeFunctionData('setCCIPAdmin', [NEW_ADMIN]),
      )
      assert.deepEqual(calls, ['owner'])
    })

    it('rejects the current CCIP admin when it is not the owner, as the override is onlyOwner', async () => {
      await assert.rejects(
        () => generate(stubPoolTokenChain(), { sender: ADMIN }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          /token pool owner/.test(err.message),
      )
    })

    it('encodes the same call with no sender, and never reads owner()', async () => {
      const calls: string[] = []
      const unsigned = await generate(stubPoolTokenChain({ calls }), { sender: undefined })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.equal(
        unsigned.transactions[0]!.data,
        FRESH.encodeFunctionData('setCCIPAdmin', [NEW_ADMIN]),
      )
      assert.deepEqual(calls, [])
    })

    it('rejects a CrossChainPoolToken at any version but 2.0.0', async () => {
      await assert.rejects(
        () => generate(stubPoolTokenChain({ version: '1.6.1' }), { sender: OWNER }),
        CCTContractVersionUnsupportedError,
      )
    })
  })

  describe('execute', () => {
    it('submits as the current default admin', async () => {
      assert.equal(
        (
          await op.execute(stubChain(), {
            tokenAddress: TOKEN,
            newAdmin: NEW_ADMIN,
            wallet: fakeSigner(),
          })
        ).hash,
        HASH,
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { tokenAddress: TOKEN, newAdmin: NEW_ADMIN, wallet: {} }),
        CCIPWalletInvalidError,
      )
    })
  })
})
