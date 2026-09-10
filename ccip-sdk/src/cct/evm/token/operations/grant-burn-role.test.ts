import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTContractTypeInvalidError, CCTParamsInvalidError } from '../../../errors.ts'
import { type GrantBurnRoleParams, GrantBurnRole } from './grant-burn-role.ts'

const TOKEN = '0x' + '11'.repeat(20)
const OWNER = '0x' + '22'.repeat(20)
const ACCOUNT = '0x' + '33'.repeat(20)
const NOT_THE_OWNER = '0x' + '44'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

/** Calldata built from a fresh Interface — never the SDK's cached one, or this proves nothing. */
const FRESH = new Interface([
  'function grantBurnRole(address burner)',
  'function isBurner(address burner) view returns (bool)',
  'function owner() view returns (address)',
])
const expectedData = (burner = ACCOUNT) => FRESH.encodeFunctionData('grantBurnRole', [burner])

/** The `eth_call`s the op makes, in order, as decoded function names. */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/**
 * EVMChain stub for a BurnMintERC677 token owned by `OWNER`. `holdsRole` is the pre-existing
 * role state of the account being granted — false is the state that makes this call a real change.
 */
function stubChain({
  holdsRole = false,
  owner = OWNER,
  callError,
  seen = newSeen(),
}: {
  holdsRole?: boolean
  owner?: string
  /** Fails every `eth_call`, standing in for a contract that is not a BurnMintERC677 token. */
  callError?: Error
  seen?: Seen
} = {}): EVMChain {
  const results: Record<string, unknown[]> = { isBurner: [holdsRole], owner: [owner] }
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    provider: {
      call: ({ data }: { data: string }) => {
        if (callError) return Promise.reject(callError)
        const fn = FRESH.getFunction(data.slice(0, 10))!.name
        seen.calls.push(fn)
        return Promise.resolve(FRESH.encodeFunctionResult(fn, results[fn]))
      },
    },
    nextNonce: () => Promise.resolve(0),
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

function fakeSigner(waitError?: Error, address = OWNER) {
  return {
    signTransaction: () => Promise.resolve('0x'),
    getAddress: () => Promise.resolve(address),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: () =>
      Promise.resolve({
        hash: HASH,
        wait: () => (waitError ? Promise.reject(waitError) : Promise.resolve({ status: 1 })),
      }),
  }
}

/** A revert with no data, the shape a call to an undeclared function produces. */
const missingFunction = () =>
  makeError('execution reverted', 'CALL_EXCEPTION', {
    action: 'call',
    data: '0x',
    reason: null,
    transaction: { to: TOKEN, data: '0x' },
    invocation: null,
    revert: null,
  })

const op = new GrantBurnRole()

function generate(chain: EVMChain, overrides: Partial<GrantBurnRoleParams> = {}) {
  return op.generate(chain, { tokenAddress: TOKEN, burner: ACCOUNT, sender: OWNER, ...overrides })
}

describe('GrantBurnRole (cct/evm)', () => {
  describe('generate', () => {
    it('encodes grantBurnRole(address) to the token', async () => {
      const seen = newSeen()
      const unsigned = await generate(stubChain({ seen }))
      const tx = unsigned.transactions[0]!

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      assert.equal(tx.to, TOKEN)
      assert.equal(tx.from, OWNER)
      assert.equal(tx.data, expectedData())
      // the role read comes first: it is also the family check, so it gates the owner read
      assert.deepEqual(seen.calls, ['isBurner', 'owner'])
    })

    it('omits from when sender is not supplied, but still probes the token', async () => {
      const seen = newSeen()
      const unsigned = await generate(stubChain({ seen }), { sender: undefined })

      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.equal(unsigned.transactions[0]!.data, expectedData())
      // no sender to compare, so the owner read is skipped — the family check is not
      assert.deepEqual(seen.calls, ['isBurner'])
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['tokenAddress', 'not-an-address'],
      // a tx to `0x0` hits no code, so it mines as a successful no-op instead of reverting
      ['tokenAddress', ZeroAddress],
      ['burner', 'not-an-address'],
      ['burner', ZeroAddress],
      ['sender', 'not-an-address'],
    ] as const) {
      it(`rejects ${param} = ${String(value)} before any RPC`, async () => {
        const seen = newSeen()
        await assert.rejects(
          () => generate(stubChain({ seen }), { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'grantBurnRole' &&
            err.context.param === param,
        )
        assert.deepEqual(seen.calls, [])
      })
    }
  })

  describe('family check', () => {
    it('rejects a contract that is not a BurnMintERC677 token', async () => {
      // a v2.0.0 CrossChainToken, a token pool, and an EOA all fail the isBurner read
      await assert.rejects(
        () => generate(stubChain({ callError: missingFunction() })),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError && err.context.address === TOKEN,
      )
    })

    it('rejects an unrelated address even with no sender to check', async () => {
      // the case an owner gate alone would miss: a token pool declares owner() too
      await assert.rejects(
        () => generate(stubChain({ callError: missingFunction() }), { sender: undefined }),
        (err: unknown) => err instanceof CCTContractTypeInvalidError,
      )
    })
  })

  describe('no-op guard', () => {
    it('rejects a grant when the account already holds the burn role', async () => {
      // stricter than the chain: the role set is an EnumerableSet, so this would mine as a
      // silent no-op rather than revert
      const seen = newSeen()
      await assert.rejects(
        () => generate(stubChain({ holdsRole: true, seen })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'grantBurnRole' &&
          err.context.param === 'burner' &&
          /already holds the burn role/.test(String(err.context.reason)),
      )
      // rejected on the role read alone, before the owner read
      assert.deepEqual(seen.calls, ['isBurner'])
    })

    it('rejects the no-op with no sender supplied too', async () => {
      await assert.rejects(
        () => generate(stubChain({ holdsRole: true }), { sender: undefined }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'burner',
      )
    })
  })

  describe('owner gate', () => {
    it('rejects a sender that does not own the token', async () => {
      await assert.rejects(
        () => generate(stubChain(), { sender: NOT_THE_OWNER }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          /must be the current token owner/.test(String(err.context.reason)),
      )
    })
  })

  describe('execute', () => {
    it('submits as the token owner and returns the tx hash', async () => {
      const { hash } = await op.execute(stubChain(), {
        tokenAddress: TOKEN,
        burner: ACCOUNT,
        wallet: fakeSigner(),
      })
      assert.equal(hash, HASH)
    })

    it('rejects a sender that is not the signing wallet', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            tokenAddress: TOKEN,
            burner: ACCOUNT,
            sender: NOT_THE_OWNER,
            wallet: fakeSigner(),
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects a wallet that does not own the token', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            tokenAddress: TOKEN,
            burner: ACCOUNT,
            wallet: fakeSigner(undefined, NOT_THE_OWNER),
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('surfaces an on-chain revert', async () => {
      const revert = makeError('execution reverted', 'CALL_EXCEPTION', {
        action: 'sendTransaction',
        data: '0x',
        reason: 'OnlyOwner',
        transaction: { to: TOKEN, data: '0x' },
        invocation: null,
        revert: null,
      })
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            tokenAddress: TOKEN,
            burner: ACCOUNT,
            wallet: fakeSigner(revert),
          }),
        (err: unknown) => err instanceof CCIPExecTxRevertedError,
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { tokenAddress: TOKEN, burner: ACCOUNT, wallet: {} }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })
  })
})
