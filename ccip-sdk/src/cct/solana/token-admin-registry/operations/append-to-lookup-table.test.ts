import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { AddressLookupTableProgram, Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { deriveCcipLookupTableAddresses } from '../../programs/alt.ts'
import { TOKEN_POOL_PROGRAMS } from '../../programs/token-pool.ts'
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

type StubChainOptions = {
  addresses?: PublicKey[]
  authority?: string | null
  onGetLookupTable?: () => void
  missingLookupTable?: boolean
}

function stubChain({
  addresses = [],
  authority = AUTHORITY,
  onGetLookupTable,
  missingLookupTable = false,
}: StubChainOptions = {}): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: async () => ({ owner: TOKEN_PROGRAM_ID }),
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
    getTokenPoolConfig: async () => ({
      token: TOKEN,
      router: ROUTER,
      tokenPoolProgram: POOL_PROGRAM,
    }),
    _getRouterConfig: async () => ({ feeQuoter: FEE_QUOTER }),
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

    it('accepts a canonical pool type', async () => {
      const unsigned = await generate({
        tokenAddress: TOKEN,
        poolType: 'burn-mint',
      })

      assert.equal(unsigned.instructions.length, 1)
      assert.ok(
        unsigned.instructions[0]!.data.includes(
          new PublicKey(TOKEN_POOL_PROGRAMS['burn-mint']).toBuffer(),
        ),
      )
    })

    it('ignores an undefined unused pool reference', async () => {
      const unsigned = await generate({
        tokenAddress: TOKEN,
        poolProgramAddress: POOL_PROGRAM,
        poolType: undefined,
      })

      assert.equal(unsigned.instructions.length, 1)
    })

    it('rejects auto-derived CCIP addresses when the canonical block already exists', async () => {
      const chain = stubChain()
      const ccipAddresses = await deriveCcipLookupTableAddresses(chain, {
        lookupTableAddress: new PublicKey(LOOKUP_TABLE),
        tokenMint: new PublicKey(TOKEN),
        poolProgram: new PublicKey(POOL_PROGRAM),
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

    it('rejects an ambiguous pool reference before the ALT RPC', async () => {
      let getLookupTableCalls = 0

      await assert.rejects(
        new AppendToLookupTable().generate(
          stubChain({ onGetLookupTable: () => getLookupTableCalls++ }),
          {
            lookupTableAddress: LOOKUP_TABLE,
            payer: PAYER,
            tokenAddress: TOKEN,
            poolType: 'burn-mint',
            poolProgramAddress: POOL_PROGRAM,
          } as never,
        ),
        CCTParamsInvalidError,
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

    it('requires at least one address source', async () => {
      await assert.rejects(
        () => generate({ additionalAddresses: [] }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'appendToLookupTable' &&
          err.context.param === 'additionalAddresses',
      )
    })

    it('requires token and pool program together', async () => {
      await assert.rejects(
        () => generate({ tokenAddress: TOKEN }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'appendToLookupTable' &&
          err.context.param === 'tokenAddress',
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
        { hash: HASH },
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
