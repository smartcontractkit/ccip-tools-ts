import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

// registers the EVM chain family, for the lanes whose remote is EVM
import '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { tokenPoolCoder } from '../../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import {
  deriveTokenPoolChainConfigPda,
  deriveTokenPoolConfigPda,
  resolveTokenPoolProgram,
} from '../../programs/token-pool.ts'
import { AppendRemotePoolAddresses } from './append-remote-pool-addresses.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const SELECTOR = 5009297550715157269n // ethereum-mainnet
const REMOTE_POOLS = ['0x1234567890abcdef1234567890abcdef12345678', '0x' + 'ab'.repeat(20)]
const HASH = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}

/** Only the canonical burn-mint pool exists for TOKEN; it is probed before lock-release. */
const POOL_CONNECTION = {
  getMultipleAccountsInfo: async () => [{}, null],
  // Holds the pool state of any overriding pool program.
  getAccountInfo: async () => ({}),
}

function chain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: { ...POOL_CONNECTION },
  } as unknown as SolanaChain
}

function submitChain(): SolanaChain {
  return Object.assign(chain(), {
    connection: {
      ...POOL_CONNECTION,
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
  return new AppendRemotePoolAddresses().generate(chain(), {
    tokenAddress: TOKEN,
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

    it('stores an EVM remote pool given padded to 32 bytes at its native 20', async () => {
      const unsigned = await generate({
        remotePoolAddresses: ['0x' + '00'.repeat(12) + REMOTE_POOLS[0]!.slice(2)],
      })
      const decoded = tokenPoolCoder.instruction.decode(unsigned.instructions[0]!.data)
      const { addresses } = decoded!.data as { addresses: { address: Buffer }[] }
      assert.deepEqual(
        addresses.map(({ address }) => address),
        [Buffer.from(REMOTE_POOLS[0]!.slice(2), 'hex')],
      )
    })

    it('uses a compatible custom pool program', async () => {
      const poolProgramAddress = Keypair.generate().publicKey.toBase58()
      const unsigned = await generate({ poolProgramAddress })

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
        [{ remotePoolAddresses: ['0xzz'] }, 'remotePoolAddresses[0]'],
        // decodes to the zero address
        [{ remotePoolAddresses: ['0x'] }, 'remotePoolAddresses[0]'],
        // a Solana address on an EVM lane
        [{ remotePoolAddresses: [TOKEN] }, 'remotePoolAddresses[0]'],
        // two spellings of one address
        [
          { remotePoolAddresses: [REMOTE_POOLS[0], REMOTE_POOLS[0]!.slice(2).toUpperCase()] },
          'remotePoolAddresses[1]',
        ],
        // a selector the SDK does not know, so the address format is unknown
        [{ remoteChainSelector: 2n ** 63n }, 'remotePoolAddresses[0]'],
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
      const result = await new AppendRemotePoolAddresses().execute(submitChain(), {
        tokenAddress: TOKEN,
        remoteChainSelector: SELECTOR,
        remotePoolAddresses: REMOTE_POOLS,
        wallet: WALLET,
      })

      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a non-wallet authority for signed appending', async () => {
      await assert.rejects(
        () =>
          new AppendRemotePoolAddresses().execute(chain(), {
            tokenAddress: TOKEN,
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
