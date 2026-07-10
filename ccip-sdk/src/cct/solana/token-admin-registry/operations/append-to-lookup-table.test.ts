import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { AddressLookupTableProgram, Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const POOL_PROGRAM = Keypair.generate().publicKey.toBase58()
const ROUTER = Keypair.generate().publicKey.toBase58()
const FEE_QUOTER = Keypair.generate().publicKey
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const LOOKUP_TABLE = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}

function stubChain(addresses: PublicKey[] = [], authority = AUTHORITY): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: async () => ({ owner: TOKEN_PROGRAM_ID }),
      getAddressLookupTable: async () => ({
        value: {
          state: {
            authority: new PublicKey(authority),
            addresses,
          },
        },
      }),
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
  return SolanaTokenManager.fromChain(chain).generateUnsignedAppendToLookupTable({
    lookupTableAddress: LOOKUP_TABLE,
    payer: PAYER,
    authority: AUTHORITY,
    additionalAddresses: [Keypair.generate().publicKey.toBase58()],
    ...opts,
  })
}

describe('Solana TokenAdminRegistry appendToLookupTable', () => {
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
    const unsigned = await generate({ tokenAddress: TOKEN, poolProgramAddress: POOL_PROGRAM })

    assert.equal(unsigned.instructions.length, 1)
  })

  it('rejects signed append when authority is not the wallet', async () => {
    await assert.rejects(
      () =>
        SolanaTokenManager.fromChain(stubChain()).appendToLookupTable({
          lookupTableAddress: LOOKUP_TABLE,
          wallet: WALLET,
          authority: AUTHORITY,
          additionalAddresses: [Keypair.generate().publicKey.toBase58()],
        }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'appendToLookupTable' &&
        err.context.param === 'authority',
    )
  })

  it('rejects authority mismatch', async () => {
    await assert.rejects(
      () => generate({}, stubChain([], Keypair.generate().publicKey.toBase58())),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'appendToLookupTable' &&
        err.context.param === 'authority',
    )
  })

  it('rejects ALTs over 256 addresses', async () => {
    const currentAddresses = Array.from({ length: 256 }, () => Keypair.generate().publicKey)

    await assert.rejects(
      () => generate({}, stubChain(currentAddresses)),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'appendToLookupTable' &&
        err.context.param === 'additionalAddresses',
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

  it('requires token and pool program together', async () => {
    await assert.rejects(
      () => generate({ tokenAddress: TOKEN, poolProgramAddress: undefined }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'appendToLookupTable' &&
        err.context.param === 'tokenAddress',
    )
  })
})
