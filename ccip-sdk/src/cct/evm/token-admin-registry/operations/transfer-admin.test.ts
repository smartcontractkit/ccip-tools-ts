import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ZeroAddress, getAddress } from 'ethers'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import { interfaces } from '../../../../evm/const.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { type TransferAdminParams, TransferAdmin } from './transfer-admin.ts'

const TOKEN = '0x' + '11'.repeat(20)
const ADDRESS = '0x' + '22'.repeat(20)
const TAR = '0x' + '33'.repeat(20)
const CURRENT_ADMIN = '0x' + '44'.repeat(20)
const NEW_ADMIN = '0x' + '55'.repeat(20)
const OTHER = '0x' + '66'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

const TRANSFER_ADMIN_ROLE_SELECTOR =
  interfaces.TokenAdminRegistry.getFunction('transferAdminRole')!.selector
const EXPECTED_DATA = interfaces.TokenAdminRegistry.encodeFunctionData('transferAdminRole', [
  TOKEN,
  NEW_ADMIN,
])

/** Encodes a `getTokenConfig` result the way the on-chain TAR would. */
function encodeTokenConfig(
  administrator: string,
  pendingAdministrator = ZeroAddress,
  tokenPool = ZeroAddress,
) {
  return interfaces.TokenAdminRegistry.encodeFunctionResult('getTokenConfig', [
    [administrator, pendingAdministrator, tokenPool],
  ])
}

/**
 * Minimal EVMChain stub — a fake provider answers `getTokenConfig` reads via `call`.
 * @remarks The provider asserts *what* it was asked rather than answering blindly, so every test in
 * this file pins the read: a mutation that points the authorization pre-check at the wrong contract
 * (e.g. the registry module instead of the resolved TAR) or at the wrong token would otherwise keep
 * the whole suite green. `decodeFunctionData` also rejects a wrong-function mutation outright.
 */
function stubChain(
  administrator = CURRENT_ADMIN,
  opts: {
    pendingAdministrator?: string
    onAddress?: (address: string) => void
    /** Token the pre-check is expected to read; defaults to the token under test. */
    expectToken?: string
  } = {},
): EVMChain {
  return {
    provider: {
      call: async (tx: { to?: string; data?: string }) => {
        assert.equal(
          getAddress(tx.to ?? ZeroAddress),
          getAddress(TAR),
          'pre-check must read the TAR resolved from `address`',
        )
        const [readToken] = interfaces.TokenAdminRegistry.decodeFunctionData(
          'getTokenConfig',
          tx.data ?? '0x',
        ) as unknown as [string]
        assert.equal(
          getAddress(readToken),
          getAddress(opts.expectToken ?? TOKEN),
          'pre-check must read the config of the token being transferred',
        )
        return encodeTokenConfig(administrator, opts.pendingAdministrator)
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    getTokenAdminRegistryFor: (address: string) => {
      opts.onAddress?.(address)
      return Promise.resolve(TAR)
    },
    nextNonce: async () => 0,
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

/** Fake ethers Signer whose broadcast resolves to a confirmed receipt. */
function fakeSigner(address = CURRENT_ADMIN) {
  return {
    signTransaction: () => Promise.resolve('0x'),
    getAddress: () => Promise.resolve(address),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: () =>
      Promise.resolve({ hash: HASH, wait: () => Promise.resolve({ status: 1 }) }),
  }
}

const op = new TransferAdmin()

function generate(chain: EVMChain, overrides: Partial<TransferAdminParams> = {}) {
  return op.generate(chain, {
    tokenAddress: TOKEN,
    newAdmin: NEW_ADMIN,
    address: ADDRESS,
    sender: CURRENT_ADMIN,
    ...overrides,
  })
}

describe('TransferAdmin (cct/evm)', () => {
  describe('generate', () => {
    it('encodes transferAdminRole(token, newAdmin) to the discovered TAR', async () => {
      const unsigned = await generate(stubChain())

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)

      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, TAR)
      assert.equal(tx.from, CURRENT_ADMIN)
      assert.ok(
        tx.data!.startsWith(TRANSFER_ADMIN_ROLE_SELECTOR),
        'data starts with transferAdminRole selector',
      )
      assert.equal(tx.data, EXPECTED_DATA)
    })

    it('discovers the TAR from the address param', async () => {
      let seen: string | undefined
      await generate(stubChain(CURRENT_ADMIN, { onAddress: (address) => (seen = address) }))
      assert.equal(seen, ADDRESS)
    })
  })

  describe('validation', () => {
    it('rejects an invalid tokenAddress before any RPC, tagged with the operation', async () => {
      let called = false
      const chain = stubChain(CURRENT_ADMIN, { onAddress: () => (called = true) })
      await assert.rejects(
        () => generate(chain, { tokenAddress: 'not-an-address' }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferAdmin' &&
          err.context.param === 'tokenAddress',
      )
      assert.equal(called, false, 'validation fails before TAR discovery')
    })

    it('rejects an invalid newAdmin', async () => {
      await assert.rejects(
        () => generate(stubChain(), { newAdmin: 'not-an-address' }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'newAdmin',
      )
    })

    it('rejects an invalid address', async () => {
      await assert.rejects(
        () => generate(stubChain(), { address: 'not-an-address' }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'address',
      )
    })

    it('rejects a missing sender', async () => {
      await assert.rejects(
        () => generate(stubChain(), { sender: undefined }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects a zero-address sender before any RPC', async () => {
      // `isAddress` permits the zero address (and its ICAP spelling), and under
      // `preflight: 'report'` the registry comparisons no longer reject it. So a zero `sender` has
      // to die in `parse` — under either mode — or it reaches the caller as a `from` no key can
      // sign.
      let called = false
      const chain = stubChain(ZeroAddress, { onAddress: () => (called = true) })
      await assert.rejects(
        () => generate(chain, { sender: ZeroAddress }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferAdmin' &&
          err.context.param === 'sender' &&
          typeof err.context.reason === 'string' &&
          err.context.reason.includes('must not be the zero address'),
      )
      assert.equal(called, false, 'validation fails before TAR discovery')
    })

    it('rejects a sender that is not the current administrator', async () => {
      await assert.rejects(
        () => generate(stubChain(CURRENT_ADMIN), { sender: OTHER }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          typeof err.context.reason === 'string' &&
          err.context.reason.includes('must be the current token administrator'),
      )
    })

    it('rejects a token that is not registered', async () => {
      await assert.rejects(
        () => generate(stubChain(ZeroAddress), { sender: OTHER }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          typeof err.context.reason === 'string' &&
          err.context.reason.includes('is not registered'),
      )
    })

    it('distinguishes a registration still pending acceptance from not-registered', async () => {
      await assert.rejects(
        () =>
          generate(stubChain(ZeroAddress, { pendingAdministrator: NEW_ADMIN }), { sender: OTHER }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          typeof err.context.reason === 'string' &&
          err.context.reason.includes('still pending acceptance') &&
          err.context.reason.includes(NEW_ADMIN),
      )
    })
  })

  // Every state below is reachable from within a single plan — a `registerAdmin` or an earlier
  // `transferAdmin` puts the registry there — which is what this mode exists for.
  describe("preflight: 'report'", () => {
    it('returns the calldata and records a sender that is not the current administrator', async () => {
      const unsigned = await generate(stubChain(CURRENT_ADMIN), {
        sender: OTHER,
        preflight: 'report',
      })
      assert.equal(unsigned.transactions[0]!.data, EXPECTED_DATA)
      assert.equal(unsigned.preconditions?.length, 1)
      assert.equal(unsigned.preconditions![0]!.param, 'sender')
      assert.ok(
        unsigned.preconditions![0]!.reason.includes('must be the current token administrator'),
      )
    })

    it('records a token that is not registered', async () => {
      const unsigned = await generate(stubChain(ZeroAddress), {
        sender: OTHER,
        preflight: 'report',
      })
      assert.equal(unsigned.transactions[0]!.data, EXPECTED_DATA)
      assert.ok(unsigned.preconditions![0]!.reason.includes('is not registered'))
    })

    it('distinguishes a registration still pending acceptance from not-registered', async () => {
      const unsigned = await generate(stubChain(ZeroAddress, { pendingAdministrator: NEW_ADMIN }), {
        sender: OTHER,
        preflight: 'report',
      })
      const { reason } = unsigned.preconditions![0]!
      assert.ok(reason.includes('still pending acceptance'))
      assert.ok(reason.includes(NEW_ADMIN))
    })

    it('omits preconditions entirely when sender is the current administrator', async () => {
      const unsigned = await generate(stubChain(CURRENT_ADMIN), { preflight: 'report' })
      assert.equal(unsigned.preconditions, undefined)
    })

    it('execute rejects under this mode too, without submitting', async () => {
      let sent = false
      const wallet = {
        ...fakeSigner(OTHER),
        sendTransaction: () => ((sent = true), Promise.reject()),
      }
      await assert.rejects(
        () =>
          op.execute(stubChain(CURRENT_ADMIN), {
            tokenAddress: TOKEN,
            newAdmin: NEW_ADMIN,
            address: ADDRESS,
            sender: OTHER,
            preflight: 'report',
            wallet,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferAdmin' &&
          err.context.param === 'sender' &&
          /must be the current token administrator/.test(err.message),
      )
      assert.equal(sent, false)
    })
  })

  describe('execute', () => {
    it('signs and submits, resolving to the confirmed tx hash', async () => {
      const result = await op.execute(stubChain(), {
        tokenAddress: TOKEN,
        newAdmin: NEW_ADMIN,
        address: ADDRESS,
        sender: CURRENT_ADMIN,
        wallet: fakeSigner(CURRENT_ADMIN),
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('defaults sender to the wallet address when omitted', async () => {
      // Uniform with registerAdmin/acceptAdmin: `sender` is required for generate() (buildUnsigned
      // must know who to authorize against before encoding), but execute() can always derive it
      // from the wallet — the only address that can satisfy the current-administrator check for a
      // signed submission. Omitting it must therefore succeed, not fail validation.
      const result = await op.execute(stubChain(), {
        tokenAddress: TOKEN,
        newAdmin: NEW_ADMIN,
        address: ADDRESS,
        wallet: fakeSigner(CURRENT_ADMIN),
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            tokenAddress: TOKEN,
            newAdmin: NEW_ADMIN,
            address: ADDRESS,
            sender: CURRENT_ADMIN,
            wallet: {},
          }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })

    it('rejects sender not matching the executing wallet, without reading the registry', async () => {
      let readRegistry = false
      const chain = stubChain(CURRENT_ADMIN, { onAddress: () => (readRegistry = true) })
      await assert.rejects(
        () =>
          op.execute(chain, {
            tokenAddress: TOKEN,
            newAdmin: NEW_ADMIN,
            address: ADDRESS,
            // sender is a valid administrator, but not the address that `wallet` signs with —
            // the registry read alone can't catch this (submit() clears tx.from before
            // populate), so execute must compare sender against the wallet directly.
            sender: CURRENT_ADMIN,
            wallet: fakeSigner(OTHER),
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          typeof err.context.reason === 'string' &&
          err.context.reason.includes('must be the executing wallet'),
      )
      assert.equal(readRegistry, false, 'rejected before reading the registry / broadcasting')
    })
  })
})
