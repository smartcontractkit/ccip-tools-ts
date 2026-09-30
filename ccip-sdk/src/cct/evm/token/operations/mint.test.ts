import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import CROSS_CHAIN_TOKEN_V2_0_0_ABI from '../../artifacts/abi/V2_0_0/cross-chain-token.ts'
import { type MintParams, Mint } from './mint.ts'

const TOKEN = '0x' + '11'.repeat(20)
const MINTER = '0x' + '22'.repeat(20)
const RECIPIENT = '0x' + '33'.repeat(20)
const NOT_A_MINTER = '0x' + '44'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
const AMOUNT = 1_000000000000000000n

/** Calldata built from a fresh Interface — never the SDK's cached one, or this proves nothing. */
const FRESH = new Interface([
  'function mint(address account, uint256 amount)',
  'function isMinter(address minter) view returns (bool)',
])
/** v2.0.0 CrossChainToken interface, for the AccessControl `hasRole` role read. */
const V2 = new Interface(CROSS_CHAIN_TOKEN_V2_0_0_ABI)
const expectedData = (account = RECIPIENT, amount = AMOUNT) =>
  FRESH.encodeFunctionData('mint', [account, amount])

/** The `eth_call`s the op makes, in order, as decoded function names. */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/** Base Sepolia; the chain the stub manager is on. Every built tx must be pinned to it. */
const CHAIN_ID = Number(networkInfo('ethereum-testnet-sepolia-base-1').chainId)

/**
 * EVMChain stub. `resolveToken` reads `typeAndVersion` to pick the role reader: a
 * `FactoryBurnMintERC20` routes to v1 `isMinter(address)`, a `CrossChainToken` to v2
 * `hasRole(MINTER_ROLE, address)`. The `mint(address,uint256)` calldata is identical either way.
 * `callError` fails both reads, standing in for a contract that is not a supported CCT token
 * (an EOA or pool): `resolveToken` falls back to v1 and the `isMinter` read then rejects.
 */
function stubChain({
  isMinter = true,
  callError,
  seen = newSeen(),
  tokenType = 'v1',
}: {
  isMinter?: boolean
  callError?: Error
  seen?: Seen
  tokenType?: 'v1' | 'v2'
} = {}): EVMChain {
  const iface = tokenType === 'v2' ? V2 : FRESH
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    network: { chainId: CHAIN_ID },
    typeAndVersion: () =>
      callError
        ? Promise.reject(callError)
        : Promise.resolve(
            tokenType === 'v2'
              ? ['CrossChainToken', '2.0.0', 'CrossChainToken 2.0.0']
              : ['FactoryBurnMintERC20', '1.5.1', ''],
          ),
    provider: {
      call: ({ data }: { data: string }) => {
        if (callError) return Promise.reject(callError)
        const fn = iface.getFunction(data.slice(0, 10))!.name
        seen.calls.push(fn)
        return Promise.resolve(iface.encodeFunctionResult(fn, [isMinter]))
      },
    },
    nextNonce: () => Promise.resolve(0),
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

function fakeSigner(waitError?: Error, address = MINTER) {
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

const op = new Mint()

function generate(chain: EVMChain, overrides: Partial<MintParams> = {}) {
  return op.generate(chain, {
    tokenAddress: TOKEN,
    account: RECIPIENT,
    amount: AMOUNT,
    sender: MINTER,
    ...overrides,
  })
}

describe('Mint (cct/evm)', () => {
  describe('generate', () => {
    it('encodes mint(address,uint256) to the token', async () => {
      const unsigned = await generate(stubChain())
      const tx = unsigned.transactions[0]!

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      assert.equal(tx.to, TOKEN)
      assert.equal(tx.from, MINTER)
      assert.equal(tx.chainId, CHAIN_ID, 'pinned to the manager chain')
      assert.equal(tx.data, expectedData())
    })

    it('encodes the full uint256 range', async () => {
      const amount = 2n ** 256n - 1n
      const unsigned = await generate(stubChain(), { amount })
      assert.equal(unsigned.transactions[0]!.data, expectedData(RECIPIENT, amount))
    })

    it('accepts a zero amount, which the token mines as a Transfer of nothing', async () => {
      const unsigned = await generate(stubChain(), { amount: 0n })
      assert.equal(unsigned.transactions[0]!.data, expectedData(RECIPIENT, 0n))
    })

    it('omits from when sender is not supplied, but still probes the token', async () => {
      const seen = newSeen()
      const unsigned = await generate(stubChain({ seen }), { sender: undefined })

      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.equal(unsigned.transactions[0]!.data, expectedData())
      // the read doubles as the family check, so it runs with no sender to compare
      assert.deepEqual(seen.calls, ['isMinter'])
    })

    it('pre-flights with exactly one isMinter read', async () => {
      const seen = newSeen()
      await generate(stubChain({ seen }))
      assert.deepEqual(seen.calls, ['isMinter'])
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['tokenAddress', 'not-an-address'],
      // a tx to `0x0` hits no code, so it mines as a successful no-op instead of reverting
      ['tokenAddress', ZeroAddress],
      ['account', 'not-an-address'],
      // the token's own _mint reverts on a zero recipient
      ['account', ZeroAddress],
      ['amount', 1 as never],
      ['amount', -1n],
      ['amount', 2n ** 256n],
      ['sender', 'not-an-address'],
    ] as const) {
      it(`rejects ${param} = ${String(value)} before any RPC`, async () => {
        const seen = newSeen()
        await assert.rejects(
          () => generate(stubChain({ seen }), { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'mint' &&
            err.context.param === param,
        )
        assert.deepEqual(seen.calls, [])
      })
    }
  })

  // A token that declares neither isMinter (v1) nor hasRole (v2): the pre-flight is skipped and
  // the mint is built best-effort — the chain enforces the role at broadcast. No family-check
  // rejection.
  describe('unrecognized token — best-effort fallback', () => {
    const missingReaders = () =>
      makeError('execution reverted', 'CALL_EXCEPTION', {
        action: 'call',
        data: '0x',
        reason: null,
        transaction: { to: TOKEN, data: '0x' },
        invocation: null,
        revert: null,
      })

    it('builds the mint without a role pre-flight, even with a sender', async () => {
      const unsigned = await generate(stubChain({ callError: missingReaders() }))
      assert.equal(unsigned.transactions[0]!.to, TOKEN)
      assert.equal(unsigned.transactions[0]!.data, expectedData())
    })

    it('builds with no sender to check', async () => {
      const unsigned = await generate(stubChain({ callError: missingReaders() }), {
        sender: undefined,
      })
      assert.equal(unsigned.transactions[0]!.data, expectedData())
    })
  })

  describe('role gate', () => {
    it('rejects a sender that does not hold the mint role', async () => {
      await assert.rejects(
        () => generate(stubChain({ isMinter: false }), { sender: NOT_A_MINTER }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'mint' &&
          err.context.param === 'sender' &&
          /must hold the mint role/.test(String(err.context.reason)),
      )
    })

    it('does not gate on the owner — a minter that is not the owner still builds', async () => {
      const seen = newSeen()
      const unsigned = await generate(stubChain({ seen }))
      assert.equal(unsigned.transactions[0]!.data, expectedData())
      assert.ok(!seen.calls.includes('owner'), 'mint is onlyMinter, not onlyOwner')
    })
  })

  // A CrossChainToken (v2.0.0) — the token `deployToken` creates — gates mint on the AccessControl
  // MINTER_ROLE via hasRole, not v1 isMinter. The mint(address,uint256) calldata is identical.
  describe('v2 CrossChainToken', () => {
    it('mints a v2 token, reading the role via hasRole(MINTER_ROLE)', async () => {
      const seen = newSeen()
      const unsigned = await generate(stubChain({ seen, tokenType: 'v2' }))
      const tx = unsigned.transactions[0]!

      assert.equal(tx.to, TOKEN)
      assert.equal(tx.from, MINTER)
      assert.equal(tx.data, expectedData(), 'same mint(address,uint256) calldata as v1')
      // the role pre-flight uses v2 AccessControl, not v1 isMinter
      assert.deepEqual(seen.calls, ['hasRole'])
    })

    it('rejects a v2 sender that does not hold MINTER_ROLE', async () => {
      await assert.rejects(
        () => generate(stubChain({ isMinter: false, tokenType: 'v2' }), { sender: NOT_A_MINTER }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          /must hold the mint role/.test(String(err.context.reason)),
      )
    })

    it('submits a v2 mint as the minting wallet', async () => {
      const { hash } = await op.execute(stubChain({ tokenType: 'v2' }), {
        tokenAddress: TOKEN,
        account: RECIPIENT,
        amount: AMOUNT,
        wallet: fakeSigner(),
      })
      assert.equal(hash, HASH)
    })
  })

  describe('execute', () => {
    it('submits as the minting wallet and returns the tx hash', async () => {
      const { hash } = await op.execute(stubChain(), {
        tokenAddress: TOKEN,
        account: RECIPIENT,
        amount: AMOUNT,
        wallet: fakeSigner(),
      })
      assert.equal(hash, HASH)
    })

    it('rejects a sender that is not the signing wallet', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            tokenAddress: TOKEN,
            account: RECIPIENT,
            amount: AMOUNT,
            sender: NOT_A_MINTER,
            wallet: fakeSigner(),
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects a wallet that does not hold the mint role', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain({ isMinter: false }), {
            tokenAddress: TOKEN,
            account: RECIPIENT,
            amount: AMOUNT,
            wallet: fakeSigner(undefined, NOT_A_MINTER),
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('surfaces an on-chain revert — e.g. a mint past maxSupply, which is not pre-flighted', async () => {
      const revert = makeError('execution reverted', 'CALL_EXCEPTION', {
        action: 'sendTransaction',
        data: '0x',
        reason: 'MaxSupplyExceeded',
        transaction: { to: TOKEN, data: '0x' },
        invocation: null,
        revert: null,
      })
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            tokenAddress: TOKEN,
            account: RECIPIENT,
            amount: AMOUNT,
            wallet: fakeSigner(revert),
          }),
        (err: unknown) => err instanceof CCIPExecTxRevertedError,
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            tokenAddress: TOKEN,
            account: RECIPIENT,
            amount: AMOUNT,
            wallet: {},
          }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })
  })
})
