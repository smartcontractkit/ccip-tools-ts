import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

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
const REMOTE_POOLS = ['0x1234567890abcdef1234567890abcdef12345678', '0xaabbccdd']
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

function generate(opts = {}) {
  return SolanaTokenManager.fromChain(chain()).generateUnsignedAppendRemotePoolAddresses({
    tokenAddress: TOKEN,
    poolType: 'burn-mint',
    payer: PAYER,
    authority: AUTHORITY,
    remoteChainSelector: SELECTOR,
    remotePoolAddresses: REMOTE_POOLS,
    ...opts,
  })
}

describe('AppendRemotePoolAddresses (cct/solana)', () => {
  describe('generate', () => {
    it('builds the append-remote-pool-addresses instruction', async () => {
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
          { pubkey: SystemProgram.programId.toBase58(), isSigner: false, isWritable: false },
        ],
      )
      assert.ok(decoded)
      assert.equal(decoded.name, 'appendRemotePoolAddresses')
      const data = decoded.data as {
        remoteChainSelector: { toString(): string }
        mint: PublicKey
        addresses: { address: Buffer }[]
      }
      assert.equal(data.remoteChainSelector.toString(), SELECTOR.toString())
      assert.equal(data.mint.toBase58(), TOKEN)
      assert.deepEqual(
        data.addresses.map(({ address }) => address),
        REMOTE_POOLS.map((address) => Buffer.from(address.slice(2), 'hex')),
      )
    })

    it('uses a compatible custom pool program', async () => {
      const poolProgramAddress = Keypair.generate().publicKey.toBase58()
      const unsigned = await generate({ poolType: undefined, poolProgramAddress })

      assert.equal(unsigned.instructions[0]?.programId.toBase58(), poolProgramAddress)
    })
  })

  describe('validation', () => {
    it('rejects invalid remote pool addresses', async () => {
      for (const [opts, param] of [
        [{ remoteChainSelector: 1 }, 'remoteChainSelector'],
        [{ remoteChainSelector: -1n }, 'remoteChainSelector'],
        [{ remoteChainSelector: 1n << 64n }, 'remoteChainSelector'],
        [{ remotePoolAddresses: [] }, 'remotePoolAddresses'],
        [{ remotePoolAddresses: [''] }, 'remotePoolAddresses[0]'],
        [{ remotePoolAddresses: ['0x123'] }, 'remotePoolAddresses[0]'],
        [{ remotePoolAddresses: ['0xaabbccdd', 'aabbccdd'] }, 'remotePoolAddresses[1]'],
        [{ remotePoolAddresses: '0x12' }, 'remotePoolAddresses'],
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
      const result = await SolanaTokenManager.fromChain(submitChain()).appendRemotePoolAddresses({
        tokenAddress: TOKEN,
        poolType: 'burn-mint',
        remoteChainSelector: SELECTOR,
        remotePoolAddresses: REMOTE_POOLS,
        wallet: WALLET,
      })

      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a non-wallet authority for signed appending', async () => {
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(chain()).appendRemotePoolAddresses({
            tokenAddress: TOKEN,
            poolType: 'burn-mint',
            authority: AUTHORITY,
            remoteChainSelector: SELECTOR,
            remotePoolAddresses: REMOTE_POOLS,
            wallet: WALLET,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'appendRemotePoolAddresses' &&
          err.context.param === 'authority',
      )
    })
  })
})
