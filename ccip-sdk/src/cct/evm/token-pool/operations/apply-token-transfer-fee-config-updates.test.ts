import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import { type TokenPoolFamily, TOKEN_POOL_INTERFACES, TokenPoolVersion } from '../contracts.ts'
import {
  type ApplyTokenTransferFeeConfigUpdatesParams,
  ApplyTokenTransferFeeConfigUpdates,
} from './apply-token-transfer-fee-config-updates.ts'

const POOL = '0x' + '11'.repeat(20)
const OWNER = '0x' + '22'.repeat(20)
const FEE_ADMIN = '0x' + '33'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
const CONFIG = {
  destGasOverhead: 100_000,
  destBytesOverhead: 32,
  finalityFeeUSDCents: 10,
  fastFinalityFeeUSDCents: 20,
  finalityTransferFeeBps: 25,
  fastFinalityTransferFeeBps: 50,
  isEnabled: true,
}
const UPDATES = [{ remoteChainSelector: 1n, tokenTransferFeeConfig: CONFIG }]
const DISABLES = [2n]

const REFERENCE = new Interface([
  'function applyTokenTransferFeeConfigUpdates((uint64 remoteChainSelector, (uint32 destGasOverhead, uint32 destBytesOverhead, uint32 finalityFeeUSDCents, uint32 fastFinalityFeeUSDCents, uint16 finalityTransferFeeBps, uint16 fastFinalityTransferFeeBps, bool isEnabled) tokenTransferFeeConfig)[] updates, uint64[] disables)',
])
const DATA = REFERENCE.encodeFunctionData('applyTokenTransferFeeConfigUpdates', [UPDATES, DISABLES])
const POOL_TYPE: Record<TokenPoolFamily, string> = {
  BurnMint: 'BurnMintTokenPool',
  LockRelease: 'LockReleaseTokenPool',
}

function stubChain({
  family = 'BurnMint',
  version = TokenPoolVersion.V2_0_0,
  owner = OWNER,
  onCall,
}: {
  family?: TokenPoolFamily
  version?: TokenPoolVersion
  owner?: string
  onCall?: () => void
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES[family][version]
  return {
    network: networkInfo('ethereum-testnet-sepolia-base-1'),
    provider: {
      call: async ({ data }: { data: string }) => {
        onCall?.()
        const selector = data.slice(0, 10)
        if (selector === iface.getFunction('owner')?.selector)
          return iface.encodeFunctionResult('owner', [owner])
        throw makeError('execution reverted', 'CALL_EXCEPTION', {
          action: 'call',
          data: '0x',
          reason: null,
          transaction: { to: null, data },
          invocation: null,
          revert: null,
        })
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      onCall?.()
      return Promise.resolve(parseTypeAndVersion(`${POOL_TYPE[family]} ${version}`))
    },
    nextNonce: async () => 0,
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

const op = new ApplyTokenTransferFeeConfigUpdates()
const generate = (chain: EVMChain, overrides: Record<string, unknown> = {}) =>
  op.generate(chain, {
    poolAddress: POOL,
    updates: UPDATES,
    disables: DISABLES,
    sender: OWNER,
    ...overrides,
  } as ApplyTokenTransferFeeConfigUpdatesParams)

const UNSUPPORTED = [
  TokenPoolVersion.V1_5_0,
  TokenPoolVersion.V1_5_1,
  TokenPoolVersion.V1_6_1,
] as const

describe('ApplyTokenTransferFeeConfigUpdates (cct/evm)', () => {
  describe('generate', () => {
    for (const family of ['BurnMint', 'LockRelease'] as const) {
      it(`encodes updates and disables for a ${family} 2.0.0 pool`, async () => {
        const unsigned = await generate(stubChain({ family }))
        const tx = unsigned.transactions[0]!
        assert.equal(unsigned.family, ChainFamily.EVM)
        assert.equal(tx.to, POOL)
        assert.equal(tx.from, OWNER)
        assert.equal(tx.data, DATA)
      })
    }

    it('rejects the delegated fee admin', async () => {
      await assert.rejects(
        () => generate(stubChain(), { sender: FEE_ADMIN }),
        (error: unknown) =>
          error instanceof CCTParamsInvalidError && error.context.param === 'sender',
      )
    })

    it('omits from and skips role reads without sender', async () => {
      let calls = 0
      const unsigned = await generate(stubChain({ onCall: () => calls++ }), {
        sender: undefined,
      })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.equal(calls, 1)
    })

    it('defaults an omitted list to empty', async () => {
      const updatesOnly = await generate(stubChain(), { disables: undefined })
      assert.equal(
        updatesOnly.transactions[0]!.data,
        REFERENCE.encodeFunctionData('applyTokenTransferFeeConfigUpdates', [UPDATES, []]),
      )
      const disablesOnly = await generate(stubChain(), { updates: undefined })
      assert.equal(
        disablesOnly.transactions[0]!.data,
        REFERENCE.encodeFunctionData('applyTokenTransferFeeConfigUpdates', [[], DISABLES]),
      )
    })
  })

  describe('validation', () => {
    for (const [overrides, param] of [
      [{ poolAddress: ZeroAddress }, 'poolAddress'],
      [{ updates: [], disables: [] }, 'updates'],
      [
        {
          updates: [{ remoteChainSelector: 0n, tokenTransferFeeConfig: CONFIG }],
        },
        'updates[0].remoteChainSelector',
      ],
      [
        {
          updates: [
            {
              remoteChainSelector: 1n,
              tokenTransferFeeConfig: {
                ...CONFIG,
                finalityTransferFeeBps: 10000,
              },
            },
          ],
        },
        'updates[0].tokenTransferFeeConfig.finalityTransferFeeBps',
      ],
      [
        {
          updates: [
            {
              remoteChainSelector: 1n,
              tokenTransferFeeConfig: { ...CONFIG, destGasOverhead: 0 },
            },
          ],
        },
        'updates[0].tokenTransferFeeConfig.destGasOverhead',
      ],
      [
        {
          updates: [
            {
              remoteChainSelector: 1n,
              tokenTransferFeeConfig: { ...CONFIG, isEnabled: false },
            },
          ],
        },
        'updates[0].tokenTransferFeeConfig.isEnabled',
      ],
      [{ disables: [1n] }, 'disables[0]'],
      [{ disables: [2n, 2n] }, 'disables[1]'],
      [{ sender: 'bad' }, 'sender'],
    ] as const) {
      it(`rejects ${param} before any RPC`, async () => {
        let calls = 0
        await assert.rejects(
          () => generate(stubChain({ onCall: () => calls++ }), overrides),
          (error: unknown) =>
            error instanceof CCTParamsInvalidError && error.context.param === param,
        )
        assert.equal(calls, 0)
      })
    }
  })

  describe('version and role checks', () => {
    for (const version of UNSUPPORTED) {
      it(`rejects ${version}`, async () => {
        await assert.rejects(
          () => generate(stubChain({ version })),
          (error: unknown) =>
            error instanceof CCTOperationUnsupportedError && error.context.version === version,
        )
      })
    }

    it('rejects a sender that is neither owner', async () => {
      await assert.rejects(
        () => generate(stubChain(), { sender: '0x' + '44'.repeat(20) }),
        (error: unknown) =>
          error instanceof CCTParamsInvalidError && error.context.param === 'sender',
      )
    })
  })

  describe('execute', () => {
    const params = { poolAddress: POOL, updates: UPDATES, disables: DISABLES }

    it('signs and submits as the owner', async () => {
      assert.deepEqual(await op.execute(stubChain(), { ...params, wallet: fakeSigner(OWNER) }), {
        hash: HASH,
      })
    })

    it('maps on-chain reverts', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            ...params,
            wallet: fakeSigner(OWNER, makeError('reverted', 'CALL_EXCEPTION')),
          }),
        CCIPExecTxRevertedError,
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: {} }),
        CCIPWalletInvalidError,
      )
    })
  })
})
