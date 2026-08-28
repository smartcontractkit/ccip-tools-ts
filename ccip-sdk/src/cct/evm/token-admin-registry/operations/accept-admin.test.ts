import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ZeroAddress, getAddress, getIcapAddress, id, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import { interfaces } from '../../../../evm/const.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { AcceptAdmin } from './accept-admin.ts'

// SENDER and OTHER carry hex letters so their checksummed and lowercase spellings differ. That
// difference is what makes the `getAddress()` normalisation in the pending-admin and wallet-binding
// comparisons observable: with all-digit fixtures both spellings are identical, so dropping the
// normalisation would pass every test while locking a legitimate admin out in production (a
// lowercase address from an indexer vs a checksummed one decoded from the chain).
const SENDER = getAddress('0x' + 'ab'.repeat(20))
const OTHER = getAddress('0x' + 'cd'.repeat(20))
const TOKEN = '0x' + '33'.repeat(20)
const TAR = '0x' + '44'.repeat(20)
const ADDRESS = '0x' + '55'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

// acceptAdminRole(address) selector, per the vendored ABI (spec-pinned).
const SELECTOR = id('acceptAdminRole(address)').slice(0, 10)
// 20-byte address left-padded to a 32-byte word; lowercased, since ABI encoding emits lowercase hex
// regardless of how the caller spelled the address.
const word = (addr: string) => '000000000000000000000000' + addr.slice(2).toLowerCase()

/** Encodes a `getTokenConfig` return value against the vendored TokenAdminRegistry ABI. */
function encodeTokenConfig(config: {
  administrator?: string
  pendingAdministrator?: string
  tokenPool?: string
}): string {
  return interfaces.TokenAdminRegistry.encodeFunctionResult('getTokenConfig', [
    [
      config.administrator ?? ZeroAddress,
      config.pendingAdministrator ?? ZeroAddress,
      config.tokenPool ?? ZeroAddress,
    ],
  ])
}

/**
 * Fake provider whose `call` answers `getTokenConfig` with a fixed config, recording every
 * `tx` it was called with so tests can assert the read hit the resolved TAR with the
 * expected calldata (the read is this op's only authorization gate, so it earns its own
 * assertion rather than passing implicitly whenever the config happens to come back right).
 */
function stubProvider(config: {
  administrator?: string
  pendingAdministrator?: string
  tokenPool?: string
}) {
  const calls: { to?: string; data?: string }[] = []
  return {
    calls,
    call: (tx: { to?: string; data?: string }) => {
      calls.push(tx)
      return Promise.resolve(encodeTokenConfig(config))
    },
  }
}

/** Minimal EVMChain stub — the build path resolves the TAR, then reads `getTokenConfig` off `provider`. */
function stubChain(overrides: Partial<EVMChain> = {}): EVMChain {
  return {
    provider: stubProvider({ pendingAdministrator: SENDER }),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    getTokenAdminRegistryFor: (_address: string) => Promise.resolve(TAR),
    nextNonce: async () => 0,
    rollbackNonce: () => {},
    ...overrides,
  } as unknown as EVMChain
}

/** Fake ethers Signer for a plain (non-deployment) tx. */
function fakeSigner(opts: { waitError?: Error } = {}) {
  return {
    signTransaction: () => Promise.resolve('0x'),
    getAddress: () => Promise.resolve(SENDER),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: () =>
      Promise.resolve({
        hash: HASH,
        wait: () =>
          opts.waitError
            ? Promise.reject(opts.waitError)
            : Promise.resolve({ status: 1, contractAddress: null }),
      }),
  }
}

describe('AcceptAdmin (cct/evm token-admin-registry operation)', () => {
  describe('generate (golden vectors)', () => {
    it('encodes acceptAdminRole(token) to the discovered TAR when sender is pending', async () => {
      const provider = stubProvider({ pendingAdministrator: SENDER })
      const unsigned = await new AcceptAdmin().generate(
        stubChain({ provider: provider as never }),
        {
          tokenAddress: TOKEN,
          address: ADDRESS,
          sender: SENDER,
        },
      )

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, TAR)
      assert.equal(tx.from, SENDER)
      assert.ok(tx.data!.startsWith(SELECTOR), 'data carries the acceptAdminRole selector')
      assert.equal(tx.data, SELECTOR + word(TOKEN))

      // The read is this op's only authorization gate — assert it actually hit the resolved
      // TAR with `getTokenConfig(tokenAddress)`, not just that some read returned a config
      // that happened to satisfy the pending-admin check.
      assert.equal(provider.calls.length, 1)
      assert.equal(provider.calls[0]!.to, TAR)
      assert.equal(
        provider.calls[0]!.data,
        interfaces.TokenAdminRegistry.encodeFunctionData('getTokenConfig', [TOKEN]),
      )
    })

    it('discovers the TAR from the given address', async () => {
      let seen: string | undefined
      const unsigned = await new AcceptAdmin().generate(
        stubChain({
          getTokenAdminRegistryFor: (address: string) => {
            seen = address
            return Promise.resolve(TAR)
          },
        }),
        { tokenAddress: TOKEN, address: ADDRESS, sender: SENDER },
      )
      assert.equal(seen, ADDRESS)
      assert.equal(unsigned.transactions[0]!.to, TAR)
    })

    it('matches a checksum-insensitive sender against the pending administrator', async () => {
      // pendingAdministrator decodes checksummed off-chain; a lowercase sender must still match.
      const unsigned = await new AcceptAdmin().generate(
        stubChain({ provider: stubProvider({ pendingAdministrator: SENDER }) as never }),
        { tokenAddress: TOKEN, address: ADDRESS, sender: SENDER.toLowerCase() },
      )
      assert.equal(unsigned.transactions[0]!.data, SELECTOR + word(TOKEN))
    })
  })

  describe('validation', () => {
    it('rejects an invalid tokenAddress before any RPC', async () => {
      let called = false
      await assert.rejects(
        () =>
          new AcceptAdmin().generate(
            stubChain({
              getTokenAdminRegistryFor: () => {
                called = true
                return Promise.resolve(TAR)
              },
            }),
            { tokenAddress: 'not-an-address', address: ADDRESS, sender: SENDER },
          ),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'acceptAdmin' &&
          err.context.param === 'tokenAddress',
      )
      assert.equal(called, false, 'validation fails before TAR discovery')
    })

    it('rejects an invalid address', async () => {
      await assert.rejects(
        () =>
          new AcceptAdmin().generate(stubChain(), {
            tokenAddress: TOKEN,
            address: 'not-an-address',
            sender: SENDER,
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'address',
      )
    })

    it('rejects a missing sender', async () => {
      await assert.rejects(
        () => new AcceptAdmin().generate(stubChain(), { tokenAddress: TOKEN, address: ADDRESS }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects an invalid sender', async () => {
      await assert.rejects(
        () =>
          new AcceptAdmin().generate(stubChain(), {
            tokenAddress: TOKEN,
            address: ADDRESS,
            sender: 'not-an-address',
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects the zero address written in ICAP form as sender', async () => {
      // isAddress() accepts ICAP, and this never equals ZeroAddress literally
      await assert.rejects(
        () =>
          new AcceptAdmin().generate(stubChain(), {
            tokenAddress: TOKEN,
            address: ADDRESS,
            sender: getIcapAddress(ZeroAddress),
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects when no administrator is pending', async () => {
      await assert.rejects(
        () =>
          new AcceptAdmin().generate(
            stubChain({
              provider: stubProvider({ administrator: OTHER }) as never, // pendingAdministrator omitted -> zero
            }),
            { tokenAddress: TOKEN, address: ADDRESS, sender: SENDER },
          ),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'acceptAdmin' &&
          err.context.param === 'sender' &&
          /nothing to accept/.test(err.message),
      )
    })

    it('rejects when sender is not the pending administrator', async () => {
      await assert.rejects(
        () =>
          new AcceptAdmin().generate(
            stubChain({ provider: stubProvider({ pendingAdministrator: OTHER }) as never }),
            { tokenAddress: TOKEN, address: ADDRESS, sender: SENDER },
          ),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          /must be the pending token administrator/.test(err.message),
      )
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns the tx hash', async () => {
      const result = await new AcceptAdmin().execute(stubChain(), {
        tokenAddress: TOKEN,
        address: ADDRESS,
        sender: SENDER,
        wallet: fakeSigner(),
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('throws CCIPExecTxRevertedError when the tx reverts on-chain', async () => {
      await assert.rejects(
        () =>
          new AcceptAdmin().execute(stubChain(), {
            tokenAddress: TOKEN,
            address: ADDRESS,
            sender: SENDER,
            wallet: fakeSigner({ waitError: makeError('execution reverted', 'CALL_EXCEPTION') }),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'acceptAdmin',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () =>
          new AcceptAdmin().execute(stubChain(), {
            tokenAddress: TOKEN,
            address: ADDRESS,
            sender: SENDER,
            wallet: {},
          }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })

    it('defaults sender to the executing wallet address when omitted', async () => {
      // fakeSigner().getAddress() resolves to SENDER, which stubChain()'s provider also
      // reports as pendingAdministrator — so an omitted `sender` must still pass the
      // pending-administrator pre-check by binding to the wallet.
      const result = await new AcceptAdmin().execute(stubChain(), {
        tokenAddress: TOKEN,
        address: ADDRESS,
        wallet: fakeSigner(),
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('binds a lowercase sender to a checksummed wallet address', async () => {
      // The wallet-binding comparison normalises both sides with getAddress(). Without that, a
      // lowercase `sender` — the shape that comes out of indexers, subgraphs and `toLowerCase()`
      // pipelines — would read as a different address from the checksummed one the signer reports,
      // and the legitimate pending administrator would be rejected as "not the executing wallet".
      // fakeSigner() reports the checksummed SENDER.
      const result = await new AcceptAdmin().execute(stubChain(), {
        tokenAddress: TOKEN,
        address: ADDRESS,
        sender: SENDER.toLowerCase(),
        wallet: fakeSigner(),
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a malformed sender with CCTParamsInvalidError, not a raw ethers error', async () => {
      // The execute override compares addresses before the base generate()'s validate() runs,
      // so it must validate first — otherwise getAddress() leaks an ethers TypeError.
      await assert.rejects(
        () =>
          new AcceptAdmin().execute(stubChain(), {
            tokenAddress: TOKEN,
            address: ADDRESS,
            sender: 'not-an-address',
            wallet: fakeSigner(),
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'acceptAdmin' &&
          err.context.param === 'sender',
      )
    })

    it('rejects a sender that does not match the executing wallet', async () => {
      // Regression guard: a caller-supplied `sender` must bind to the address that actually
      // signs. `fakeSigner()` resolves to SENDER, which stubChain()'s provider also reports as
      // pendingAdministrator — so absent this check, `sender: OTHER` would sail through the
      // pending-administrator pre-check (SENDER === SENDER) yet broadcast from a signer whose
      // on-chain `msg.sender` doesn't match, reverting with `OnlyPendingAdministrator` instead
      // of failing fast here.
      await assert.rejects(
        () =>
          new AcceptAdmin().execute(stubChain(), {
            tokenAddress: TOKEN,
            address: ADDRESS,
            sender: OTHER,
            wallet: fakeSigner(),
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'acceptAdmin' &&
          err.context.param === 'sender' &&
          /executing wallet address/.test(err.message),
      )
    })
  })
})
