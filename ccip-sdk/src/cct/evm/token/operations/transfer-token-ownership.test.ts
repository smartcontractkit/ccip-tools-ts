import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { BeginDefaultAdminTransfer } from './begin-default-admin-transfer.ts'
import { CancelDefaultAdminTransfer } from './cancel-default-admin-transfer.ts'
import {
  type TransferTokenOwnershipParams,
  TransferTokenOwnership,
} from './transfer-token-ownership.ts'

const TOKEN = '0x' + '11'.repeat(20)
const OWNER = '0x' + '22'.repeat(20)
const NEW_OWNER = '0x' + '44'.repeat(20)
const NOT_THE_OWNER = '0x' + '88'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

/**
 * Byte-parity oracle: a fresh Interface built from the signature literals, so the assertions are
 * independent of the SDK's cached, ABI-derived interfaces. `owner()` doubles as the stub's
 * response encoder.
 */
const IFACE = new Interface([
  'function transferOwnership(address to)',
  'function owner() view returns (address)',
  'function defaultAdmin() view returns (address)',
  'function pendingDefaultAdmin() view returns (address newAdmin, uint48 schedule)',
])
const dataFor = (to: string) => IFACE.encodeFunctionData('transferOwnership', [to])

/**
 * EVMChain stub: `provider.call` answers `owner()`, and v2's `defaultAdmin()` (also `owner`) and
 * `pendingDefaultAdmin()`. `typeAndVersion` picks the version; `typeAndVersion: undefined`
 * reproduces a v1.5.1 token, which predates the function.
 */
function stubChain({
  owner = OWNER,
  typeAndVersion = 'FactoryBurnMintERC20 1.6.2',
  onCall,
}: {
  owner?: string
  typeAndVersion?: string
  onCall?: () => void
} = {}): EVMChain {
  return {
    network: networkInfo('ethereum-testnet-sepolia-base-1'),
    provider: {
      call: ({ data }: { data: string }) => {
        onCall?.()
        const fn = IFACE.getFunction(data.slice(0, 10))?.name
        if (fn === 'pendingDefaultAdmin')
          return Promise.resolve(IFACE.encodeFunctionResult(fn, [NEW_OWNER, 1n]))
        if (fn !== 'owner' && fn !== 'defaultAdmin')
          throw makeError('execution reverted', 'CALL_EXCEPTION', {
            action: 'call',
            data: '0x',
            reason: null,
            transaction: { to: TOKEN, data },
            invocation: null,
            revert: null,
          })
        return Promise.resolve(IFACE.encodeFunctionResult(fn, [owner]))
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () =>
      typeAndVersion
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
          ),
    nextNonce: () => Promise.resolve(0),
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

function fakeSigner(address = OWNER, waitError?: Error) {
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

const op = new TransferTokenOwnership()

function generate(chain: EVMChain, overrides: Partial<TransferTokenOwnershipParams> = {}) {
  return op.generate(chain, {
    tokenAddress: TOKEN,
    newOwner: NEW_OWNER,
    sender: OWNER,
    ...overrides,
  })
}

describe('TransferTokenOwnership (cct/evm)', () => {
  describe('generate', () => {
    it('encodes transferOwnership(newOwner), identically for v1.5.1 and v1.6.2', async () => {
      const unsigned = await generate(stubChain())
      const tx = unsigned.transactions[0]!

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      assert.equal(tx.to, TOKEN)
      assert.equal(tx.from, OWNER)
      assert.equal(tx.data, dataFor(NEW_OWNER))
    })

    it('allows the zero address, which retracts a pending transfer', async () => {
      const unsigned = await generate(stubChain(), { newOwner: ZeroAddress })
      assert.equal(unsigned.transactions[0]!.data, dataFor(ZeroAddress))
    })

    it('reads the owner and nothing else', async () => {
      let calls = 0
      await generate(stubChain({ onCall: () => (calls += 1) }))
      assert.equal(calls, 1)
    })

    it('omits from — but still reads owner() — when sender is not supplied', async () => {
      let calls = 0
      const unsigned = await generate(stubChain({ onCall: () => (calls += 1) }), {
        sender: undefined,
      })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      // the owner read is what bounds newOwner away from the current owner, sender or not
      assert.equal(calls, 1)
    })

    it('rejects a self-transfer with no sender, against the on-chain owner', async () => {
      await assert.rejects(
        () => generate(stubChain(), { newOwner: OWNER, sender: undefined }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferTokenOwnership' &&
          err.context.param === 'newOwner' &&
          err.message.includes(OWNER) &&
          /CannotTransferToSelf/.test(err.message),
      )
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['tokenAddress', 'not-an-address'],
      ['tokenAddress', ZeroAddress],
      ['newOwner', 'not-an-address'],
      ['sender', 'not-an-address'],
    ] as const) {
      it(`rejects ${param} = ${value} before any RPC`, async () => {
        let called = false
        await assert.rejects(
          () => generate(stubChain({ onCall: () => (called = true) }), { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'transferTokenOwnership' &&
            err.context.param === param,
        )
        assert.equal(called, false)
      })
    }
  })

  describe('version dispatch', () => {
    for (const typeAndVersion of ['FactoryBurnMintERC20 1.6.2', 'CrossChainToken 2.0.0'])
      for (const [label, newOwner, Op] of [
        ['a non-zero', NEW_OWNER, BeginDefaultAdminTransfer],
        ['a zero', ZeroAddress, CancelDefaultAdminTransfer],
      ] as const)
        it(`builds exactly what ${Op.name} builds for ${label} newOwner (${typeAndVersion})`, async () => {
          const chain = stubChain({ typeAndVersion })
          const params = { tokenAddress: TOKEN, newAdmin: newOwner, sender: OWNER }
          assert.deepEqual(
            await generate(chain, { newOwner }),
            await new Op().generate(chain, params),
          )
        })

    it('reports errors of the zero-newOwner cancel path under its own name', async () => {
      await assert.rejects(
        () =>
          generate(stubChain({ typeAndVersion: 'CrossChainToken 2.0.0', owner: NOT_THE_OWNER }), {
            newOwner: ZeroAddress,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferTokenOwnership' &&
          err.context.param === 'sender',
      )
    })

    it('surfaces a transient typeAndVersion() failure instead of assuming v1', async () => {
      const chain = stubChain()
      chain.typeAndVersion = () => Promise.reject(makeError('timeout', 'TIMEOUT'))
      await assert.rejects(() => generate(chain), /timeout/)
    })

    it('proceeds for a v1.6.2 FactoryBurnMintERC20', async () => {
      const unsigned = await generate(stubChain({ typeAndVersion: 'FactoryBurnMintERC20 1.6.2' }))
      assert.equal(unsigned.transactions[0]!.data, dataFor(NEW_OWNER))
    })

    it('proceeds for a v1.5.1 token, whose typeAndVersion() reverts', async () => {
      const unsigned = await generate(stubChain({ typeAndVersion: undefined }))
      assert.equal(unsigned.transactions[0]!.data, dataFor(NEW_OWNER))
    })
  })

  describe('pre-transaction validation', () => {
    it('rejects a sender that is not the token owner', async () => {
      await assert.rejects(
        () => generate(stubChain({ owner: NOT_THE_OWNER })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferTokenOwnership' &&
          err.context.param === 'sender' &&
          // names the owner it read, so the caller can see which address it needed
          err.message.includes(NOT_THE_OWNER),
      )
    })
  })

  describe('execute', () => {
    const params = { tokenAddress: TOKEN, newOwner: NEW_OWNER }

    it('signs and submits as the owner, resolving to the tx hash', async () => {
      assert.deepEqual(await op.execute(stubChain(), { ...params, wallet: fakeSigner() }), {
        hash: HASH,
      })
    })

    it('maps an on-chain revert to CCIPExecTxRevertedError', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            ...params,
            wallet: fakeSigner(OWNER, makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError &&
          err.context.operation === 'transferTokenOwnership',
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
        () => op.execute(stubChain(), { ...params, sender: NEW_OWNER, wallet: fakeSigner() }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects a wallet that is not the token owner', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: fakeSigner(NOT_THE_OWNER) }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferTokenOwnership' &&
          err.context.param === 'sender',
      )
    })
  })
})
