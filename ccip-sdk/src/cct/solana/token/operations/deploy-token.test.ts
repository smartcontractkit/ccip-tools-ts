import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { DeployToken } from './deploy-token.ts'

const BLOCKHASH = PublicKey.default.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const METAPLEX_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
const HASH = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}

function stubChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      rpcEndpoint: 'http://localhost:8899',
      getAccountInfo: () => assert.fail('should not RPC before validation'),
      getMinimumBalanceForRentExemption: async () => 123,
      getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 0 }),
    },
  } as unknown as SolanaChain
}

function submitChain(): SolanaChain {
  return Object.assign(stubChain(), {
    connection: {
      rpcEndpoint: 'http://localhost:8899',
      getMinimumBalanceForRentExemption: async () => 123,
      simulateTransaction: async () => ({ value: { err: null, logs: [], unitsConsumed: 1 } }),
      getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 0 }),
      sendTransaction: async () => HASH,
      confirmTransaction: async () => ({ value: { err: null } }),
    },
  })
}

function generate(opts: Record<string, unknown> = {}) {
  return new DeployToken().generate(stubChain(), {
    decimals: 9,
    withMetaplex: false,
    payer: PAYER,
    ...opts,
  })
}

describe('DeployToken (cct/solana)', () => {
  describe('generate', () => {
    it('builds unsigned SPL mint create instructions', async () => {
      const unsigned = await generate()
      const [createAccountIx, initializeMintIx] = unsigned.instructions

      assert.ok(createAccountIx)
      assert.ok(initializeMintIx)
      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.mainIndex, 0)
      assert.match(unsigned.tokenAddress, /^[1-9A-HJ-NP-Za-km-z]+$/)
      assert.equal('seed' in unsigned, false)
      assert.equal(unsigned.metadataAddress, undefined)
      assert.equal(unsigned.instructions.length, 2)
      assert.equal(createAccountIx.programId.toBase58(), SystemProgram.programId.toBase58())
      assert.equal(initializeMintIx.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58())
      assert.equal(initializeMintIx.data[0], 20) // InitializeMint2, not legacy InitializeMint
    })

    it('uses caller seed for reproducible mint address and supports no freeze authority', async () => {
      const a = await generate({ seed: 'mint_seed', freezeAuthority: null })
      const b = await generate({ seed: 'mint_seed' })

      assert.equal(a.tokenAddress, b.tokenAddress)
    })

    it('adds Metaplex metadata when requested', async () => {
      const unsigned = await generate({
        withMetaplex: true,
        name: 'My Token',
        symbol: 'MTK',
      })

      assert.equal(unsigned.instructions.length, 3)
      assert.match(unsigned.metadataAddress!, /^[1-9A-HJ-NP-Za-km-z]+$/)
      assert.equal(unsigned.instructions[2]!.programId.toBase58(), METAPLEX_PROGRAM)
      assert.equal(unsigned.instructions[2]!.data[0], 42) // createV1
    })

    it('uses Token-2022 program for mint and metadata', async () => {
      const unsigned = await generate({
        tokenProgram: 'token-2022',
        withMetaplex: true,
        name: 'My Token',
        symbol: 'MTK',
      })

      assert.equal(unsigned.instructions[1]!.programId.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58())
      assert.ok(
        unsigned.instructions[2]!.keys.some(
          (key) => key.pubkey.toBase58() === TOKEN_2022_PROGRAM_ID.toBase58(),
        ),
      )
    })

    it('adds ATA creation and mintTo instructions for preMint', async () => {
      const unsigned = await generate({
        preMint: 100n,
        preMintRecipient: Keypair.generate().publicKey.toBase58(),
      })

      assert.equal(unsigned.instructions.length, 4)
      assert.equal(unsigned.instructions[3]!.data[0], 7) // MintTo
    })
  })

  describe('validation', () => {
    it('rejects invalid base and pre-mint parameters', async () => {
      for (const [opts, param] of [
        [{ decimals: 256 }, 'decimals'],
        [{ tokenProgram: 'invalid' }, 'tokenProgram'],
        [{ withMetaplex: 'yes' }, 'withMetaplex'],
        [{ seed: '' }, 'seed'],
        [{ mintAuthority: 'invalid' }, 'mintAuthority'],
        [{ freezeAuthority: 'invalid' }, 'freezeAuthority'],
        [{ preMint: 0n }, 'preMint'],
        [{ preMint: 1 }, 'preMint'],
        [{ preMint: 1n }, 'preMintRecipient'],
        [{ preMint: 1n, preMintRecipient: 'invalid' }, 'preMintRecipient'],
      ] as const) {
        await assert.rejects(
          () => generate(opts),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
      }
    })

    it('rejects invalid Metaplex name and URI parameters', async () => {
      for (const [opts, param] of [
        [{ withMetaplex: true, name: '', symbol: 'MTK' }, 'name'],
        [{ withMetaplex: true, name: 'My Token', symbol: 'MTK', uri: 1 }, 'uri'],
      ] as const) {
        await assert.rejects(
          () => generate(opts),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
      }
    })

    it('rejects seeds over 32 UTF-8 bytes', async () => {
      await assert.rejects(
        () => generate({ seed: '🚀'.repeat(9) }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'seed',
      )
    })

    it('validates Metaplex name and symbol by UTF-8 byte length', async () => {
      await assert.rejects(
        () =>
          generate({
            withMetaplex: true,
            name: 'Valid',
            symbol: '🚀🚀🚀',
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'symbol',
      )
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns the mint address', async () => {
      const result = await new DeployToken().execute(submitChain(), {
        wallet: WALLET,
        decimals: 9,
        withMetaplex: false,
      })

      assert.equal(result.hash, HASH)
      assert.match(result.tokenAddress, /^[1-9A-HJ-NP-Za-km-z]+$/)
    })

    it('returns the metadata address when creating Metaplex metadata', async () => {
      const result = await new DeployToken().execute(submitChain(), {
        wallet: WALLET,
        decimals: 9,
        withMetaplex: true,
        name: 'My Token',
        symbol: 'MTK',
      })

      assert.equal(result.hash, HASH)
      assert.match(result.metadataAddress!, /^[1-9A-HJ-NP-Za-km-z]+$/)
    })

    it('rejects execute when preMint needs a non-wallet mintAuthority signer', async () => {
      const wallet = {
        publicKey: Keypair.generate().publicKey,
        signTransaction: async <T>(tx: T) => tx,
      }

      await assert.rejects(
        () =>
          new DeployToken().execute(stubChain(), {
            wallet,
            decimals: 9,
            tokenProgram: 'spl-token',
            withMetaplex: false,
            mintAuthority: Keypair.generate().publicKey.toBase58(),
            preMint: 100n,
            preMintRecipient: Keypair.generate().publicKey.toBase58(),
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'mintAuthority',
      )
    })
  })
})
