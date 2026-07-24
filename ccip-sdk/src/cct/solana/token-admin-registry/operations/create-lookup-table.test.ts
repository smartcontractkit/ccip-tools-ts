import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { AddressLookupTableProgram, Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'
import { TOKEN_POOL_PROGRAMS } from '../../programs/token-pool.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const POOL_PROGRAM = Keypair.generate().publicKey.toBase58()
const ROUTER = Keypair.generate().publicKey.toBase58()
const FEE_QUOTER = Keypair.generate().publicKey
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}

function stubChain(onGetSlot?: () => void): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getSlot: async () => {
        onGetSlot?.()
        return 123
      },
      getAccountInfo: async () => ({ owner: TOKEN_PROGRAM_ID }),
    },
    getTokenPoolConfig: async () => ({
      token: TOKEN,
      router: ROUTER,
      tokenPoolProgram: POOL_PROGRAM,
    }),
    _getRouterConfig: async () => ({ feeQuoter: FEE_QUOTER }),
  } as unknown as SolanaChain
}

function generate(opts = {}) {
  return SolanaTokenManager.fromChain(stubChain()).generateUnsignedCreateLookupTable({
    tokenAddress: TOKEN,
    poolProgramAddress: POOL_PROGRAM,
    payer: PAYER,
    ...opts,
  })
}

describe('CreateLookupTable (cct/solana)', () => {
  describe('generate', () => {
    it('builds create + extend ALT instructions', async () => {
      const unsigned = await generate()

      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.mainIndex, 0)
      assert.equal(unsigned.instructions.length, 2)
      assert.match(unsigned.lookupTableAddress, /^[1-9A-HJ-NP-Za-km-z]+$/)
      assert.equal(
        unsigned.instructions[0]!.programId.toBase58(),
        AddressLookupTableProgram.programId.toBase58(),
      )
      assert.equal(
        unsigned.instructions[1]!.programId.toBase58(),
        AddressLookupTableProgram.programId.toBase58(),
      )
      assert.equal(
        unsigned.instructions[0]!.keys.find((key) => key.pubkey.toBase58() === PAYER)?.isSigner,
        false,
      )
    })

    it('accepts a canonical pool type', async () => {
      const unsigned = await SolanaTokenManager.fromChain(
        stubChain(),
      ).generateUnsignedCreateLookupTable({
        tokenAddress: TOKEN,
        poolType: 'burn-mint',
        payer: PAYER,
      })

      assert.equal(unsigned.instructions.length, 2)
      assert.ok(
        unsigned.instructions[1]!.data.includes(
          new PublicKey(TOKEN_POOL_PROGRAMS['burn-mint']).toBuffer(),
        ),
      )
    })

    it('builds create-only ALT instruction in createEmpty mode', async () => {
      const unsigned = await SolanaTokenManager.fromChain(
        stubChain(),
      ).generateUnsignedCreateLookupTable({
        payer: PAYER,
        authority: AUTHORITY,
        mode: 'createEmpty',
      })

      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.mainIndex, 0)
      assert.equal(unsigned.instructions.length, 1)
      assert.match(unsigned.lookupTableAddress, /^[1-9A-HJ-NP-Za-km-z]+$/)
      assert.equal(
        unsigned.instructions[0]!.programId.toBase58(),
        AddressLookupTableProgram.programId.toBase58(),
      )
      assert.equal(
        unsigned.instructions[0]!.keys.find((key) => key.pubkey.toBase58() === AUTHORITY)?.isSigner,
        false,
      )
    })

    it('defaults createEmpty authority to payer', async () => {
      const unsigned = await SolanaTokenManager.fromChain(
        stubChain(),
      ).generateUnsignedCreateLookupTable({
        payer: PAYER,
        mode: 'createEmpty',
      })

      assert.ok(unsigned.instructions[0]!.keys.some((key) => key.pubkey.toBase58() === PAYER))
    })

    it('chunks additional addresses into multiple extend instructions', async () => {
      const additionalAddresses = Array.from({ length: 21 }, () =>
        Keypair.generate().publicKey.toBase58(),
      )
      const unsigned = await generate({ additionalAddresses })

      assert.equal(unsigned.instructions.length, 3)
    })

    it('uses caller-provided authority', async () => {
      const unsigned = await generate({ authority: AUTHORITY })

      assert.ok(unsigned.instructions[0]!.keys.some((key) => key.pubkey.toBase58() === AUTHORITY))
    })

    it('rejects ALTs over 256 addresses', async () => {
      const additionalAddresses = Array.from({ length: 247 }, () =>
        Keypair.generate().publicKey.toBase58(),
      )

      await assert.rejects(
        () => generate({ additionalAddresses }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'createLookupTable' &&
          err.context.param === 'additionalAddresses',
      )
    })
  })

  describe('validation', () => {
    it('rejects an ambiguous pool reference before the slot RPC', async () => {
      let getSlotCalls = 0

      await assert.rejects(
        SolanaTokenManager.fromChain(
          stubChain(() => getSlotCalls++),
        ).generateUnsignedCreateLookupTable({
          tokenAddress: TOKEN,
          poolType: 'burn-mint',
          poolProgramAddress: POOL_PROGRAM,
          payer: PAYER,
        } as never),
        CCTParamsInvalidError,
      )

      assert.equal(getSlotCalls, 0)
    })
  })

  describe('execute', () => {
    it('rejects signed create+extend when authority is not the wallet', async () => {
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(stubChain()).createLookupTable({
            tokenAddress: TOKEN,
            poolProgramAddress: POOL_PROGRAM,
            wallet: WALLET,
            authority: AUTHORITY,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'createLookupTable' &&
          err.context.param === 'authority',
      )
    })
  })
})
