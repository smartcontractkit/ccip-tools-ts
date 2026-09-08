import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey } from '@solana/web3.js'

import { CCIPError } from '../../../../errors/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { tokenPoolCoder } from '../../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { resolveTokenPoolProgram } from '../../programs/token-pool.ts'
import { ApplyChainUpdates } from './apply-chain-updates.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const SELECTOR = 5009297550715157269n
const HASH = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}

function chain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {},
  } as unknown as SolanaChain
}

function submitChain(): SolanaChain {
  return Object.assign(chain(), {
    connection: {
      simulateTransaction: async () => ({ value: { err: null, logs: [], unitsConsumed: 1 } }),
      getLatestBlockhash: async () => ({
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 1,
      }),
      sendTransaction: async () => HASH,
      confirmTransaction: async () => ({ value: { err: null } }),
    },
  })
}

function batchChains() {
  return [3n, 4n, 5n].map((remoteChainSelector, i) => ({
    remoteChainSelector,
    remoteTokenAddress: `0x${(i + 1).toString(16).padStart(40, '0')}`,
    remotePoolAddresses: [`0x${(i + 11).toString(16).padStart(40, '0')}`],
    remoteTokenDecimals: 6 + i,
    inboundRateLimiterConfig: { enabled: false as const },
    outboundRateLimiterConfig: { enabled: true as const, capacity: 100n, rate: 10n },
  }))
}

function generateBatches(opts = {}) {
  return new ApplyChainUpdates().generateBatch(chain(), {
    tokenAddress: TOKEN,
    poolType: 'burn-mint',
    payer: PAYER,
    authority: AUTHORITY,
    remoteChainSelectorsToRemove: [SELECTOR],
    chainsToAdd: [
      {
        remoteChainSelector: SELECTOR,
        remoteTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
        remotePoolAddresses: ['0x1234567890abcdef1234567890abcdef12345678'],
        remoteTokenDecimals: 18,
        inboundRateLimiterConfig: { enabled: false },
        outboundRateLimiterConfig: { enabled: true, capacity: 100n, rate: 10n },
      },
    ],
    ...opts,
  })
}

async function generate(opts = {}) {
  const [unsigned] = await generateBatches(opts)
  return unsigned!
}

describe('ApplyChainUpdates (cct/solana)', () => {
  describe('generate', () => {
    it('requires the batch API', async () => {
      assert.throws(
        () => new ApplyChainUpdates().generate(chain(), {} as never),
        (error: unknown) => CCIPError.isCCIPError(error) && error.code === 'METHOD_UNSUPPORTED',
      )
      assert.throws(
        () => new ApplyChainUpdates().execute(chain(), {} as never),
        (error: unknown) => CCIPError.isCCIPError(error) && error.code === 'METHOD_UNSUPPORTED',
      )
    })

    it('builds a single unsigned transaction internally', async () => {
      const operation = new ApplyChainUpdates()
      const params = {
        tokenAddress: TOKEN,
        poolType: 'burn-mint' as const,
        payer: PAYER,
        authority: AUTHORITY,
        remoteChainSelectorsToRemove: [SELECTOR],
        chainsToAdd: [],
      }
      const unsigned = await (operation as any).buildUnsigned(
        chain(),
        (operation as any).prepare(params),
      )

      assert.equal(unsigned.instructions.length, 1)
    })

    it('builds delete, initialize, edit, and rate-limit instructions', async () => {
      const unsigned = await generate()
      const poolProgram = resolveTokenPoolProgram('burn-mint')

      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.mainIndex, 0)
      assert.ok(unsigned.instructions.every(({ programId }) => programId.equals(poolProgram)))
      assert.deepEqual(
        unsigned.instructions.map(
          (instruction) => tokenPoolCoder.instruction.decode(instruction.data)!.name,
        ),
        [
          'deleteChainConfig',
          'initChainRemoteConfig',
          'editChainRemoteConfig',
          'setChainRateLimit',
        ],
      )
    })

    it('builds delete, then per-chain init, edit, and rate-limit instructions for multiple chains', async () => {
      const batches = await generateBatches({
        remoteChainSelectorsToRemove: [1n, 2n],
        chainsToAdd: [
          {
            remoteChainSelector: 3n,
            remoteTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
            remotePoolAddresses: ['0x1234567890abcdef1234567890abcdef12345678'],
            remoteTokenDecimals: 18,
            inboundRateLimiterConfig: { enabled: false },
            outboundRateLimiterConfig: { enabled: true, capacity: 100n, rate: 10n },
          },
          {
            remoteChainSelector: 4n,
            remoteTokenAddress: '0xaabbccddeeff00112233445566778899aabbccdd',
            remotePoolAddresses: [],
            remoteTokenDecimals: 6,
            inboundRateLimiterConfig: { enabled: true, capacity: 200n, rate: 20n },
            outboundRateLimiterConfig: { enabled: false },
          },
          {
            remoteChainSelector: 5n,
            remoteTokenAddress: '0x11223344556677889900aabbccddeeff00112233',
            remotePoolAddresses: ['0x1234', '0xabcd'],
            remoteTokenDecimals: 8,
            inboundRateLimiterConfig: { enabled: true, capacity: 5_000n, rate: 50n },
            outboundRateLimiterConfig: { enabled: false },
          },
        ],
      })

      assert.deepEqual(
        batches.flatMap((batch) =>
          batch.instructions.map(
            (instruction) => tokenPoolCoder.instruction.decode(instruction.data)!.name,
          ),
        ),
        [
          'deleteChainConfig',
          'deleteChainConfig',
          'initChainRemoteConfig',
          'editChainRemoteConfig',
          'setChainRateLimit',
          'initChainRemoteConfig',
          'editChainRemoteConfig',
          'setChainRateLimit',
          'initChainRemoteConfig',
          'editChainRemoteConfig',
          'setChainRateLimit',
        ],
      )
    })

    it('packs large updates without splitting a chain instruction group', async () => {
      const batches = await new ApplyChainUpdates().generateBatch(chain(), {
        tokenAddress: TOKEN,
        poolType: 'burn-mint',
        payer: PAYER,
        authority: AUTHORITY,
        remoteChainSelectorsToRemove: [],
        chainsToAdd: batchChains(),
      })

      assert.equal(batches.length, 2)
      assert.deepEqual(
        batches.flatMap((batch) =>
          batch.instructions.map(
            (instruction) => tokenPoolCoder.instruction.decode(instruction.data)!.name,
          ),
        ),
        [
          'initChainRemoteConfig',
          'editChainRemoteConfig',
          'setChainRateLimit',
          'initChainRemoteConfig',
          'editChainRemoteConfig',
          'setChainRateLimit',
          'initChainRemoteConfig',
          'editChainRemoteConfig',
          'setChainRateLimit',
        ],
      )
      assert.ok(batches.every((batch) => batch.instructions.length % 3 === 0))
    })

    it('rejects a chain update that cannot fit one transaction', async () => {
      await assert.rejects(
        () =>
          new ApplyChainUpdates().generateBatch(chain(), {
            tokenAddress: TOKEN,
            poolType: 'burn-mint',
            payer: PAYER,
            authority: AUTHORITY,
            remoteChainSelectorsToRemove: [],
            chainsToAdd: [
              {
                ...batchChains()[0]!,
                remotePoolAddresses: Array.from(
                  { length: 30 },
                  (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`,
                ),
              },
            ],
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'chainsToAdd' &&
          err.message.includes('chain selector 0x3 (30 remote pool addresses)'),
      )
    })

    it('sets disabled rate-limit configs like EVM applyChainUpdates', async () => {
      const unsigned = await generate({
        remoteChainSelectorsToRemove: [],
        chainsToAdd: [
          {
            remoteChainSelector: SELECTOR,
            remoteTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
            remotePoolAddresses: ['0x1234567890abcdef1234567890abcdef12345678'],
            remoteTokenDecimals: 18,
            inboundRateLimiterConfig: { enabled: false },
            outboundRateLimiterConfig: { enabled: false },
          },
        ],
      })

      const decoded = tokenPoolCoder.instruction.decode(unsigned.instructions[2]!.data)

      assert.equal(unsigned.instructions.length, 3)
      assert.ok(decoded)
      assert.equal(decoded.name, 'setChainRateLimit')
    })

    it('uses a compatible custom pool program', async () => {
      const poolProgramAddress = Keypair.generate().publicKey.toBase58()
      const unsigned = await generate({ poolType: undefined, poolProgramAddress })

      assert.ok(
        unsigned.instructions.every(({ programId }) => programId.toBase58() === poolProgramAddress),
      )
    })
  })

  describe('validation', () => {
    it('rejects invalid chain updates', async () => {
      for (const [opts, param] of [
        [{ remoteChainSelectorsToRemove: null }, 'remoteChainSelectorsToRemove'],
        [{ remoteChainSelectorsToRemove: [-1n] }, 'remoteChainSelector'],
        [{ chainsToAdd: null }, 'chainsToAdd'],
        [{ chainsToAdd: [], remoteChainSelectorsToRemove: [] }, 'chainsToAdd'],
        [{ chainsToAdd: [null] }, 'chainsToAdd[0]'],
        [
          {
            chainsToAdd: [
              {
                remoteChainSelector: SELECTOR,
                remoteTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
                remotePoolAddresses: [],
                remoteTokenDecimals: 256,
                inboundRateLimiterConfig: { enabled: false },
                outboundRateLimiterConfig: { enabled: false },
              },
            ],
          },
          'remoteTokenDecimals',
        ],
        [
          {
            chainsToAdd: [
              {
                remoteChainSelector: SELECTOR,
                remoteTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
                remotePoolAddresses: null,
                remoteTokenDecimals: 18,
                inboundRateLimiterConfig: { enabled: false },
                outboundRateLimiterConfig: { enabled: false },
              },
            ],
          },
          'remotePoolAddresses',
        ],
        [
          {
            chainsToAdd: [
              {
                remoteChainSelector: SELECTOR,
                remoteTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
                remotePoolAddresses: ['0x'],
                remoteTokenDecimals: 18,
                inboundRateLimiterConfig: { enabled: false },
                outboundRateLimiterConfig: { enabled: false },
              },
            ],
          },
          'chainsToAdd[0].remotePoolAddresses[0]',
        ],
        [
          {
            chainsToAdd: [
              {
                remoteChainSelector: SELECTOR,
                remoteTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
                remotePoolAddresses: ['0x1234', '0x1234'],
                remoteTokenDecimals: 18,
                inboundRateLimiterConfig: { enabled: false },
                outboundRateLimiterConfig: { enabled: false },
              },
            ],
          },
          'chainsToAdd[0].remotePoolAddresses[1]',
        ],
        [
          {
            chainsToAdd: [
              {
                remoteChainSelector: SELECTOR,
                remoteTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
                remotePoolAddresses: [],
                remoteTokenDecimals: 18,
                inboundRateLimiterConfig: { enabled: false, capacity: 1n, rate: 0n },
                outboundRateLimiterConfig: { enabled: false },
              },
            ],
          },
          'inbound',
        ],
      ] as const) {
        await assert.rejects(
          () => generate(opts),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
      }
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns all tx hashes', async () => {
      const result = await new ApplyChainUpdates().executeBatch(submitChain(), {
        tokenAddress: TOKEN,
        poolType: 'burn-mint',
        remoteChainSelectorsToRemove: [SELECTOR],
        chainsToAdd: [
          {
            remoteChainSelector: SELECTOR,
            remoteTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
            remotePoolAddresses: ['0x1234567890abcdef1234567890abcdef12345678'],
            remoteTokenDecimals: 18,
            inboundRateLimiterConfig: { enabled: false },
            outboundRateLimiterConfig: { enabled: true, capacity: 100n, rate: 10n },
          },
        ],
        wallet: WALLET,
      })

      assert.deepEqual(result, { hashes: [HASH], chainSelectors: [[`0x${SELECTOR.toString(16)}`]] })
    })

    it('submits every safely packed batch and returns all hashes', async () => {
      const result = await new ApplyChainUpdates().executeBatch(submitChain(), {
        tokenAddress: TOKEN,
        poolType: 'burn-mint',
        remoteChainSelectorsToRemove: [],
        chainsToAdd: batchChains(),
        wallet: WALLET,
      })

      assert.deepEqual(result, { hashes: [HASH, HASH], chainSelectors: [['0x3', '0x4'], ['0x5']] })
    })

    it('attaches committed hashes when a later batch fails', async () => {
      let simulations = 0
      const failedChain = submitChain()
      failedChain.connection.simulateTransaction = (async () => {
        simulations++
        return {
          value: { err: simulations >= 2 ? { custom: 1 } : null, logs: [], unitsConsumed: 1 },
        }
      }) as never

      await assert.rejects(
        () =>
          new ApplyChainUpdates().executeBatch(failedChain, {
            tokenAddress: TOKEN,
            poolType: 'burn-mint',
            remoteChainSelectorsToRemove: [],
            chainsToAdd: batchChains(),
            wallet: WALLET,
          }),
        (error: unknown) =>
          CCIPError.isCCIPError(error) &&
          error.context.committedHashes instanceof Array &&
          error.context.committedHashes[0] === HASH &&
          error.context.committedChainSelectors instanceof Array &&
          error.context.committedChainSelectors[0]?.join() === '0x3,0x4' &&
          error.context.failedBatchIndex === 1 &&
          error.context.totalBatches === 2,
      )
    })

    it('rejects a non-wallet authority for signed configuration', async () => {
      await assert.rejects(
        () =>
          new ApplyChainUpdates().executeBatch(chain(), {
            tokenAddress: TOKEN,
            poolType: 'burn-mint',
            authority: AUTHORITY,
            remoteChainSelectorsToRemove: [SELECTOR],
            chainsToAdd: [],
            wallet: WALLET,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'applyChainUpdates' &&
          err.context.param === 'authority',
      )
    })
  })
})
