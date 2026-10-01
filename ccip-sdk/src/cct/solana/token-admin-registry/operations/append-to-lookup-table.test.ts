import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { BorshAccountsCoder } from '@coral-xyz/anchor'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { AddressLookupTableProgram, Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { deriveCcipLookupTableAddresses } from '../../programs/alt.ts'
import { TOKEN_POOL_PROGRAMS, deriveTokenPoolConfigPda } from '../../programs/token-pool.ts'
import { AppendToLookupTable } from './append-to-lookup-table.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const POOL_PROGRAM = Keypair.generate().publicKey.toBase58()
const ROUTER = Keypair.generate().publicKey.toBase58()
const FEE_QUOTER = Keypair.generate().publicKey
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const LOOKUP_TABLE = Keypair.generate().publicKey.toBase58()
const ALT_EXTEND_ADDRESSES_OFFSET = 12 // 4-byte discriminator + 8-byte address vector length
const HASH = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: new PublicKey(AUTHORITY),
  signTransaction: async <T>(tx: T) => tx,
}

/** Pool state for TOKEN whose only meaningful field is its router. */
function poolState(): Buffer {
  const key = PublicKey.default.toBuffer()
  return Buffer.concat([
    BorshAccountsCoder.accountDiscriminator('State'),
    Buffer.from([1]),
    TOKEN_PROGRAM_ID.toBuffer(),
    new PublicKey(TOKEN).toBuffer(),
    Buffer.from([6]),
    ...Array.from({ length: 6 }, () => key),
    new PublicKey(ROUTER).toBuffer(),
    key,
    Buffer.from([0, 0]),
    Buffer.alloc(4),
    key,
  ])
}

type StubChainOptions = {
  addresses?: PublicKey[]
  authority?: string | null
  onGetLookupTable?: () => void
  missingLookupTable?: boolean
  /** Programs holding the pool state of TOKEN. */
  poolPrograms?: PublicKey[]
}

function stubChain({
  addresses = [],
  authority = AUTHORITY,
  onGetLookupTable,
  missingLookupTable = false,
  poolPrograms = [new PublicKey(POOL_PROGRAM)],
}: StubChainOptions = {}): SolanaChain {
  const states = new Map(
    poolPrograms.map((poolProgram) => [
      deriveTokenPoolConfigPda(poolProgram, new PublicKey(TOKEN)).toBase58(),
      { owner: poolProgram, data: poolState() },
    ]),
  )
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      // Every other account, including the mint, is owned by the SPL Token program.
      getAccountInfo: async (address: PublicKey) =>
        states.get(address.toBase58()) ?? { owner: TOKEN_PROGRAM_ID },
      getMultipleAccountsInfo: async (addresses: PublicKey[]) =>
        addresses.map((address) => states.get(address.toBase58()) ?? null),
      getAddressLookupTable: async () => {
        onGetLookupTable?.()
        return {
          value: missingLookupTable
            ? null
            : {
                state: {
                  authority: authority ? new PublicKey(authority) : undefined,
                  addresses,
                },
              },
        }
      },
      simulateTransaction: async () => ({ value: { err: null, logs: [], unitsConsumed: 1 } }),
      getLatestBlockhash: async () => ({
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 1,
      }),
      sendTransaction: async () => HASH,
      confirmTransaction: async () => ({ value: { err: null } }),
    },
    _getRouterConfig: async (router: string) => {
      assert.equal(router, ROUTER)
      return { feeQuoter: FEE_QUOTER }
    },
  } as unknown as SolanaChain
}

function generate(opts = {}, chain = stubChain()) {
  return new AppendToLookupTable().generate(chain, {
    lookupTableAddress: LOOKUP_TABLE,
    payer: PAYER,
    authority: AUTHORITY,
    additionalAddresses: [Keypair.generate().publicKey.toBase58()],
    ...opts,
  })
}

describe('AppendToLookupTable (cct/solana)', () => {
  describe('generate', () => {
    it('builds extend ALT instructions', async () => {
      const unsigned = await generate()

      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.mainIndex, 0)
      assert.equal(unsigned.instructions.length, 1)
      assert.equal(
        unsigned.instructions[0]!.programId.toBase58(),
        AddressLookupTableProgram.programId.toBase58(),
      )
    })

    it('chunks additional addresses into multiple extend instructions', async () => {
      const additionalAddresses = Array.from({ length: 31 }, () =>
        Keypair.generate().publicKey.toBase58(),
      )
      const unsigned = await generate({ additionalAddresses })

      assert.equal(unsigned.instructions.length, 2)
    })

    it('appends derived CCIP addresses before manual addresses', async () => {
      const chain = stubChain()
      const manualAddress = Keypair.generate().publicKey
      const ccipAddresses = await deriveCcipLookupTableAddresses(chain, {
        lookupTableAddress: new PublicKey(LOOKUP_TABLE),
        tokenMint: new PublicKey(TOKEN),
        poolProgram: new PublicKey(POOL_PROGRAM),
        router: new PublicKey(ROUTER),
      })
      const unsigned = await generate(
        {
          tokenAddress: TOKEN,
          poolProgramAddress: POOL_PROGRAM,
          additionalAddresses: [manualAddress.toBase58()],
        },
        chain,
      )
      const appendedAddresses = Array.from(
        { length: ccipAddresses.length + 1 },
        (_, i) =>
          new PublicKey(
            unsigned.instructions[0]!.data.subarray(
              ALT_EXTEND_ADDRESSES_OFFSET + i * 32,
              ALT_EXTEND_ADDRESSES_OFFSET + (i + 1) * 32,
            ),
          ),
      )

      assert.deepEqual(
        appendedAddresses.map((address) => address.toBase58()),
        [...ccipAddresses, manualAddress].map((address) => address.toBase58()),
      )
    })

    it('resolves the canonical pool program of the mint', async () => {
      const unsigned = await generate(
        { tokenAddress: TOKEN },
        stubChain({ poolPrograms: [new PublicKey(TOKEN_POOL_PROGRAMS['burn-mint'])] }),
      )

      assert.equal(unsigned.instructions.length, 1)
      assert.ok(
        unsigned.instructions[0]!.data.includes(
          new PublicKey(TOKEN_POOL_PROGRAMS['burn-mint']).toBuffer(),
        ),
      )
    })

    it('treats an explicitly undefined pool program address as omitted', async () => {
      const unsigned = await generate(
        { tokenAddress: TOKEN, poolProgramAddress: undefined },
        stubChain({ poolPrograms: [new PublicKey(TOKEN_POOL_PROGRAMS['lock-release'])] }),
      )

      assert.equal(unsigned.instructions.length, 1)
    })

    it('rejects auto-derived CCIP addresses when the canonical block already exists', async () => {
      const chain = stubChain()
      const ccipAddresses = await deriveCcipLookupTableAddresses(chain, {
        lookupTableAddress: new PublicKey(LOOKUP_TABLE),
        tokenMint: new PublicKey(TOKEN),
        poolProgram: new PublicKey(POOL_PROGRAM),
        router: new PublicKey(ROUTER),
      })

      await assert.rejects(
        () =>
          generate(
            { tokenAddress: TOKEN, poolProgramAddress: POOL_PROGRAM },
            stubChain({ addresses: ccipAddresses }),
          ),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'appendToLookupTable' &&
          err.context.param === 'lookupTableAddress',
      )
    })

    it('rejects a partial canonical CCIP address block', async () => {
      const ccipAddresses = await deriveCcipLookupTableAddresses(stubChain(), {
        lookupTableAddress: new PublicKey(LOOKUP_TABLE),
        tokenMint: new PublicKey(TOKEN),
        poolProgram: new PublicKey(POOL_PROGRAM),
        router: new PublicKey(ROUTER),
      })

      await assert.rejects(
        () =>
          generate(
            { tokenAddress: TOKEN, poolProgramAddress: POOL_PROGRAM },
            stubChain({ addresses: [ccipAddresses[0]!] }),
          ),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'lookupTableAddress',
      )
    })

    it('defaults omitted additional addresses to an empty list', async () => {
      const unsigned = await generate({
        additionalAddresses: undefined,
        tokenAddress: TOKEN,
        poolProgramAddress: POOL_PROGRAM,
      })

      assert.equal(unsigned.instructions.length, 1)
    })

    it('rejects authority mismatch', async () => {
      await assert.rejects(
        () => generate({}, stubChain({ authority: Keypair.generate().publicKey.toBase58() })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'appendToLookupTable' &&
          err.context.param === 'authority',
      )
    })

    it('rejects an ALT with no authority', async () => {
      await assert.rejects(
        () => generate({}, stubChain({ authority: null })),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'authority',
      )
    })

    it('rejects ALTs over 256 addresses', async () => {
      const currentAddresses = Array.from({ length: 256 }, () => Keypair.generate().publicKey)

      await assert.rejects(
        () => generate({}, stubChain({ addresses: currentAddresses })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'appendToLookupTable' &&
          err.context.param === 'additionalAddresses',
      )
    })
  })

  describe('validation', () => {
    it('rejects a missing lookup table', async () => {
      await assert.rejects(
        () => generate({}, stubChain({ missingLookupTable: true })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'lookupTableAddress',
      )
    })

    it('rejects a pool program address without a token before the ALT RPC', async () => {
      let getLookupTableCalls = 0

      await assert.rejects(
        new AppendToLookupTable().generate(
          stubChain({ onGetLookupTable: () => getLookupTableCalls++ }),
          {
            lookupTableAddress: LOOKUP_TABLE,
            payer: PAYER,
            poolProgramAddress: POOL_PROGRAM,
            additionalAddresses: [Keypair.generate().publicKey.toBase58()],
          } as never,
        ),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'tokenAddress',
      )

      assert.equal(getLookupTableCalls, 0)
    })

    it('rejects an invalid pool program address', async () => {
      let getLookupTableCalls = 0

      await assert.rejects(
        new AppendToLookupTable().generate(
          stubChain({ onGetLookupTable: () => getLookupTableCalls++ }),
          {
            lookupTableAddress: LOOKUP_TABLE,
            payer: PAYER,
            tokenAddress: TOKEN,
            poolProgramAddress: 'invalid',
          },
        ),
        CCTParamsInvalidError,
      )

      assert.equal(getLookupTableCalls, 0)
    })

    it('rejects duplicate additional addresses', async () => {
      const address = Keypair.generate().publicKey.toBase58()
      await assert.rejects(
        () => generate({ additionalAddresses: [address, address] }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'additionalAddresses',
      )
    })

    it('requires at least one address source', async () => {
      await assert.rejects(
        () => generate({ additionalAddresses: [] }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'appendToLookupTable' &&
          err.context.param === 'additionalAddresses',
      )
    })

    it('rejects a token whose pool program cannot be resolved', async () => {
      await assert.rejects(
        () => generate({ tokenAddress: TOKEN }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'appendToLookupTable' &&
          err.context.param === 'tokenAddress' &&
          /no canonical burn-mint or lock-release token pool/.test(err.message),
      )
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns the tx hash', async () => {
      assert.deepEqual(
        await new AppendToLookupTable().execute(stubChain(), {
          lookupTableAddress: LOOKUP_TABLE,
          wallet: WALLET,
          additionalAddresses: [Keypair.generate().publicKey.toBase58()],
        }),
        { hash: HASH, hashes: [HASH] },
      )
    })

    it('rejects signed append when authority is not the wallet', async () => {
      await assert.rejects(
        () =>
          new AppendToLookupTable().execute(stubChain(), {
            lookupTableAddress: LOOKUP_TABLE,
            wallet: WALLET,
            authority: PAYER,
            additionalAddresses: [Keypair.generate().publicKey.toBase58()],
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'appendToLookupTable' &&
          err.context.param === 'authority',
      )
    })
  })
})
