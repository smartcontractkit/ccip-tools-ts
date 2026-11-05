import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { AcceptDefaultAdminTransfer } from './accept-default-admin-transfer.ts'
import { type AcceptTokenOwnershipParams, AcceptTokenOwnership } from './accept-token-ownership.ts'

const TOKEN = '0x' + '11'.repeat(20)
const PROPOSED_OWNER = '0x' + '22'.repeat(20)
const SOMEONE_ELSE = '0x' + '88'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

/**
 * Byte-parity oracle: a fresh Interface built from the signature literal, so the assertion is
 * independent of the SDK's cached, ABI-derived interfaces.
 */
const EXPECTED = new Interface(['function acceptOwnership()']).encodeFunctionData(
  'acceptOwnership',
  [],
)

const PENDING = new Interface([
  'function pendingDefaultAdmin() view returns (address newAdmin, uint48 schedule)',
])

/**
 * EVMChain stub whose only `eth_call` answer is v2's `pendingDefaultAdmin()`, naming
 * `PROPOSED_OWNER`: a v1 token cannot read its pending owner, so `onCall` pins that v1 makes no
 * `call`. `typeAndVersion` is the one read it does make; `typeAndVersion: undefined` reproduces a
 * v1.5.1 token, which predates the function.
 */
function stubChain({
  typeAndVersion = 'FactoryBurnMintERC20 1.6.2',
  onCall,
}: { typeAndVersion?: string; onCall?: (kind: 'call' | 'typeAndVersion') => void } = {}): EVMChain {
  return {
    network: networkInfo('ethereum-testnet-sepolia-base-1'),
    provider: {
      call: () => {
        onCall?.('call')
        return Promise.resolve(
          PENDING.encodeFunctionResult('pendingDefaultAdmin', [PROPOSED_OWNER, 1n]),
        )
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      onCall?.('typeAndVersion')
      return typeAndVersion
        ? Promise.resolve(parseTypeAndVersion(typeAndVersion))
        : Promise.reject(
            makeError('execution reverted', 'CALL_EXCEPTION', {
              action: 'call',
              data: '0x',
              reason: null,
              transaction: { to: TOKEN },
              invocation: null,
              revert: null,
            }),
          )
    },
    nextNonce: () => Promise.resolve(0),
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

function fakeSigner(address = PROPOSED_OWNER, waitError?: Error) {
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

const op = new AcceptTokenOwnership()

function generate(chain: EVMChain, overrides: Partial<AcceptTokenOwnershipParams> = {}) {
  return op.generate(chain, { tokenAddress: TOKEN, sender: PROPOSED_OWNER, ...overrides })
}

describe('AcceptTokenOwnership (cct/evm)', () => {
  describe('generate', () => {
    it('encodes acceptOwnership(), identically for v1.5.1 and v1.6.2', async () => {
      const unsigned = await generate(stubChain())
      const tx = unsigned.transactions[0]!

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      assert.equal(tx.to, TOKEN)
      assert.equal(tx.from, PROPOSED_OWNER)
      assert.equal(tx.data, EXPECTED)
    })

    it('reads only typeAndVersion — the pending owner has no getter to check', async () => {
      const kinds: string[] = []
      await generate(stubChain({ onCall: (kind) => kinds.push(kind) }))
      assert.deepEqual(kinds, ['typeAndVersion'])
    })

    it('encodes for a v1.5.1 token, whose typeAndVersion() reverts', async () => {
      const unsigned = await generate(stubChain({ typeAndVersion: undefined }))
      assert.equal(unsigned.transactions[0]!.data, EXPECTED)
    })

    for (const typeAndVersion of ['FactoryBurnMintERC20 1.6.2', 'CrossChainToken 2.0.0'])
      it(`builds exactly what AcceptDefaultAdminTransfer builds (${typeAndVersion})`, async () => {
        const chain = stubChain({ typeAndVersion })
        assert.deepEqual(
          await generate(chain),
          await new AcceptDefaultAdminTransfer().generate(chain, {
            tokenAddress: TOKEN,
            sender: PROPOSED_OWNER,
          }),
        )
      })

    it('reports a v2 pre-flight error under its own name', async () => {
      await assert.rejects(
        () =>
          generate(stubChain({ typeAndVersion: 'CrossChainToken 2.0.0' }), {
            sender: SOMEONE_ELSE,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'acceptTokenOwnership' &&
          err.context.param === 'sender',
      )
    })

    it('omits from when sender is not supplied', async () => {
      const unsigned = await generate(stubChain(), { sender: undefined })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.equal(unsigned.transactions[0]!.data, EXPECTED)
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['tokenAddress', 'not-an-address'],
      ['tokenAddress', ZeroAddress],
      ['sender', 'not-an-address'],
    ] as const) {
      it(`rejects ${param} = ${value}`, async () => {
        await assert.rejects(
          () => generate(stubChain(), { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'acceptTokenOwnership' &&
            err.context.param === param,
        )
      })
    }
  })

  describe('execute', () => {
    const params = { tokenAddress: TOKEN }

    it('signs and submits as the proposed owner, resolving to the tx hash', async () => {
      assert.deepEqual(await op.execute(stubChain(), { ...params, wallet: fakeSigner() }), {
        hash: HASH,
      })
    })

    it('maps an on-chain revert — e.g. Must be proposed owner — to CCIPExecTxRevertedError', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            ...params,
            wallet: fakeSigner(PROPOSED_OWNER, makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError &&
          err.context.operation === 'acceptTokenOwnership',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: {} }),
        CCIPWalletInvalidError,
      )
    })

    it('rejects a sender that is not the executing wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, sender: SOMEONE_ELSE, wallet: fakeSigner() }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('accepts any signer — the proposed owner cannot be verified before broadcast', async () => {
      assert.deepEqual(
        await op.execute(stubChain(), { ...params, wallet: fakeSigner(SOMEONE_ELSE) }),
        { hash: HASH },
      )
    })
  })
})
