import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import { tokenPoolCoder } from '../../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'
import {
  deriveTokenPoolChainConfigPda,
  deriveTokenPoolConfigPda,
  resolveTokenPoolProgram,
} from '../../programs/token-pool.ts'

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
  return SolanaTokenManager.fromChain(chain()).generateUnsignedSetChainRateLimit({
    tokenAddress: TOKEN,
    poolType: 'burn-mint',
    payer: PAYER,
    authority: AUTHORITY,
    remoteChainSelector: SELECTOR,
    inbound: { enabled: true, capacity: 100n, rate: 10n },
    outbound: { enabled: true, capacity: 200n, rate: 20n },
    ...opts,
  })
}

describe('SetChainRateLimit (cct/solana)', () => {
  describe('generate', () => {
    it('builds the set-chain-rate-limit instruction', async () => {
      const unsigned = await generate()
      const [instruction] = unsigned.instructions
      const poolProgram = resolveTokenPoolProgram('burn-mint')
      const decoded = tokenPoolCoder.instruction.decode(instruction!.data)

      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.mainIndex, 0)
      assert.equal(instruction!.programId.toBase58(), poolProgram.toBase58())
      assert.deepEqual(
        instruction!.keys.map(({ pubkey, isSigner, isWritable }) => ({
          pubkey: pubkey.toBase58(),
          isSigner,
          isWritable,
        })),
        [
          {
            pubkey: deriveTokenPoolConfigPda(poolProgram, new PublicKey(TOKEN)).toBase58(),
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: deriveTokenPoolChainConfigPda(
              poolProgram,
              SELECTOR,
              new PublicKey(TOKEN),
            ).toBase58(),
            isSigner: false,
            isWritable: true,
          },
          { pubkey: AUTHORITY, isSigner: true, isWritable: true },
        ],
      )
      assert.ok(decoded)
      assert.equal(decoded.name, 'setChainRateLimit')
      const data = decoded.data as {
        remoteChainSelector: { toString(): string }
        mint: PublicKey
        inbound: {
          enabled: boolean
          capacity: { toString(): string }
          rate: { toString(): string }
        }
        outbound: {
          enabled: boolean
          capacity: { toString(): string }
          rate: { toString(): string }
        }
      }
      assert.equal(data.remoteChainSelector.toString(), SELECTOR.toString())
      assert.equal(data.mint.toBase58(), TOKEN)
      assert.equal(data.inbound.enabled, true)
      assert.equal(data.inbound.capacity.toString(), '100')
      assert.equal(data.inbound.rate.toString(), '10')
      assert.equal(data.outbound.enabled, true)
      assert.equal(data.outbound.capacity.toString(), '200')
      assert.equal(data.outbound.rate.toString(), '20')
    })

    it('supports zero selectors and rate limits', async () => {
      await assert.doesNotReject(() =>
        generate({
          remoteChainSelector: 0n,
          inbound: { enabled: false, capacity: 0n, rate: 0n },
          outbound: { enabled: false, capacity: 0n, rate: 0n },
        }),
      )
    })

    it('uses a compatible custom pool program', async () => {
      const poolProgramAddress = Keypair.generate().publicKey.toBase58()
      const unsigned = await generate({ poolType: undefined, poolProgramAddress })

      assert.equal(unsigned.instructions[0]?.programId.toBase58(), poolProgramAddress)
    })
  })

  describe('validation', () => {
    it('rejects invalid rate-limit values', async () => {
      for (const [opts, param] of [
        [{ remoteChainSelector: 1 }, 'remoteChainSelector'],
        [{ inbound: { enabled: true, capacity: -1n, rate: 1n } }, 'inbound.capacity'],
        [{ outbound: { enabled: true, capacity: 1n, rate: 1n << 64n } }, 'outbound.rate'],
        [{ inbound: { enabled: true, capacity: 1n, rate: 2n } }, 'inbound.rate'],
        [{ outbound: { enabled: false, capacity: 1n, rate: 0n } }, 'outbound'],
        [{ inbound: { enabled: 'true', capacity: 1n, rate: 1n } }, 'inbound.enabled'],
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
      const result = await SolanaTokenManager.fromChain(submitChain()).setChainRateLimit({
        tokenAddress: TOKEN,
        poolType: 'burn-mint',
        remoteChainSelector: SELECTOR,
        inbound: { enabled: true, capacity: 100n, rate: 10n },
        outbound: { enabled: true, capacity: 200n, rate: 20n },
        wallet: WALLET,
      })

      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a non-wallet authority for signed configuration', async () => {
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(chain()).setChainRateLimit({
            tokenAddress: TOKEN,
            poolType: 'burn-mint',
            authority: AUTHORITY,
            remoteChainSelector: SELECTOR,
            inbound: { enabled: true, capacity: 100n, rate: 10n },
            outbound: { enabled: true, capacity: 200n, rate: 20n },
            wallet: WALLET,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setChainRateLimit' &&
          err.context.param === 'authority',
      )
    })
  })
})
