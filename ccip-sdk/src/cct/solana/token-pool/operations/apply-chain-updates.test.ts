import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import { tokenPoolCoder } from '../../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'
import { resolveTokenPoolProgram } from '../../programs/token-pool.ts'

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
  return {
    ...chain(),
    connection: {
      simulateTransaction: async () => ({ value: { err: null, logs: [], unitsConsumed: 1 } }),
      getLatestBlockhash: async () => ({
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 1,
      }),
      sendTransaction: async () => HASH,
      confirmTransaction: async () => ({ value: { err: null } }),
    },
  } as unknown as SolanaChain
}

function generate(opts = {}) {
  return SolanaTokenManager.fromChain(chain()).generateUnsignedApplyChainUpdates({
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

describe('ApplyChainUpdates (cct/solana)', () => {
  describe('generate', () => {
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
    it('signs, submits, and returns the tx hash', async () => {
      const result = await SolanaTokenManager.fromChain(submitChain()).applyChainUpdates({
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

      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a non-wallet authority for signed configuration', async () => {
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(chain()).applyChainUpdates({
            tokenAddress: TOKEN,
            poolType: 'burn-mint',
            authority: AUTHORITY,
            remoteChainSelectorsToRemove: [],
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
