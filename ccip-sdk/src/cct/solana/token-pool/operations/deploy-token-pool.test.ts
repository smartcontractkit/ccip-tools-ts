import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import { deriveTokenPoolSignerPda, resolveTokenPoolProgram } from '../../index.ts'
import { deriveTokenPoolConfigPda } from '../../programs/token-pool.ts'
import { DeployTokenPool } from './deploy-token-pool.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const BURN_MINT_POOL_PROGRAM = '41FGToCmdaWa1dgZLKFAjvmx6e6AjVTX7SVRibvsMGVB'
const LOCK_RELEASE_POOL_PROGRAM = '8eqh8wppT9c5rw4ERqNCffvU6cNFJWff9WmkcYtmGiqC'
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const HASH = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}

function stubChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {},
  } as unknown as SolanaChain
}

function generate(opts = {}) {
  return new DeployTokenPool().generate(stubChain(), {
    tokenAddress: TOKEN,
    poolType: 'burn-mint',
    payer: PAYER,
    authority: AUTHORITY,
    ...opts,
  })
}

describe('DeployTokenPool (cct/solana)', () => {
  describe('generate', () => {
    it('builds unsigned initialize pool instruction', async () => {
      const unsigned = await generate()

      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.mainIndex, 0)
      assert.equal(unsigned.instructions.length, 1)
      assert.equal(unsigned.instructions[0]!.programId.toBase58(), BURN_MINT_POOL_PROGRAM)
      assert.equal(
        unsigned.poolAddress,
        deriveTokenPoolConfigPda(
          new PublicKey(BURN_MINT_POOL_PROGRAM),
          new PublicKey(TOKEN),
        ).toBase58(),
      )
      assert.equal(
        unsigned.poolSignerAddress,
        deriveTokenPoolSignerPda(
          resolveTokenPoolProgram('burn-mint'),
          new PublicKey(TOKEN),
        ).toBase58(),
      )
    })

    it('adds configure allowlist instruction when provided', async () => {
      const unsigned = await generate({
        allowlist: [Keypair.generate().publicKey.toBase58()],
      })

      assert.equal(unsigned.instructions.length, 2)
      assert.equal(unsigned.instructions[1]!.programId.toBase58(), BURN_MINT_POOL_PROGRAM)
    })

    it('creates the pool signer ATA when requested', async () => {
      const chain = Object.assign(stubChain(), {
        connection: { getAccountInfo: async () => ({ owner: TOKEN_PROGRAM_ID }) },
      })
      const unsigned = await new DeployTokenPool().generate(chain, {
        tokenAddress: TOKEN,
        poolType: 'burn-mint',
        payer: PAYER,
        authority: AUTHORITY,
        createPoolSignerATA: true,
      })
      const poolSigner = deriveTokenPoolSignerPda(
        resolveTokenPoolProgram('burn-mint'),
        new PublicKey(TOKEN),
      )
      const ata = getAssociatedTokenAddressSync(
        new PublicKey(TOKEN),
        poolSigner,
        true,
        TOKEN_PROGRAM_ID,
      )
      const createATA = unsigned.instructions[1]!

      assert.equal(unsigned.instructions.length, 2)
      assert.equal(createATA.programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58())
      assert.equal(createATA.data[0], 1) // CreateIdempotent
      assert.equal(createATA.keys[1]!.pubkey.toBase58(), ata.toBase58())
      assert.equal(createATA.keys[2]!.pubkey.toBase58(), poolSigner.toBase58())
    })

    it('uses canonical lock-release pool program', async () => {
      const unsigned = await generate({ poolType: 'lock-release' })

      assert.equal(unsigned.instructions[0]!.programId.toBase58(), LOCK_RELEASE_POOL_PROGRAM)
    })

    it('uses poolProgramAddress for the program and derived PDAs', async () => {
      const poolProgram = Keypair.generate().publicKey
      const chain = Object.assign(stubChain(), {
        connection: { getAccountInfo: async () => ({ owner: TOKEN_PROGRAM_ID }) },
        typeAndVersion: async () => ['LockReleaseTokenPool', '1.6.0'],
      })
      const unsigned = await new DeployTokenPool().generate(chain, {
        tokenAddress: TOKEN,
        poolType: 'lock-release',
        poolProgramAddress: poolProgram.toBase58(),
        payer: PAYER,
        authority: AUTHORITY,
        createPoolSignerATA: true,
        allowlist: [Keypair.generate().publicKey.toBase58()],
      })
      const poolSigner = deriveTokenPoolSignerPda(poolProgram, new PublicKey(TOKEN))

      assert.equal(unsigned.instructions[0]!.programId.toBase58(), poolProgram.toBase58())
      assert.equal(unsigned.instructions[2]!.programId.toBase58(), poolProgram.toBase58())
      assert.equal(
        unsigned.poolAddress,
        deriveTokenPoolConfigPda(poolProgram, new PublicKey(TOKEN)).toBase58(),
      )
      assert.equal(unsigned.poolSignerAddress, poolSigner.toBase58())
      assert.equal(unsigned.instructions[1]!.keys[2]!.pubkey.toBase58(), poolSigner.toBase58())
    })

    it('defaults authority to payer', async () => {
      const unsigned = await generate({ authority: undefined })

      assert.ok(unsigned.instructions[0]!.keys.some((key) => key.pubkey.toBase58() === PAYER))
    })
  })

  describe('mintAuthorityMultisig', () => {
    const multisig = Keypair.generate().publicKey.toBase58()
    const chainAt = (version: string) =>
      Object.assign(stubChain(), { typeAndVersion: async () => ['burnmintTokenPool', version] })

    it('initializes by multisig on a 2.0 pool program', async () => {
      const unsigned = await new DeployTokenPool().generate(chainAt('2.0.0'), {
        tokenAddress: TOKEN,
        poolType: 'burn-mint',
        payer: PAYER,
        authority: AUTHORITY,
        mintAuthorityMultisig: multisig,
        allowlist: [PAYER],
      })
      const [initialize, allowlist] = unsigned.instructions

      assert.equal(unsigned.mainIndex, 0)
      // `initialize_by_multisig`, from the program's IDL
      assert.deepEqual([...initialize!.data], [170, 42, 240, 9, 144, 13, 204, 211])
      assert.equal(initialize!.keys.length, 8)
      assert.equal(initialize!.keys[2]!.pubkey.toBase58(), AUTHORITY)
      assert.equal(initialize!.keys[7]!.pubkey.toBase58(), multisig)
      assert.equal(allowlist!.programId.toBase58(), BURN_MINT_POOL_PROGRAM)
    })

    it('rejects pool programs before CCIP 2.0 and invalid multisig addresses', async () => {
      const params = {
        tokenAddress: TOKEN,
        poolType: 'burn-mint',
        payer: PAYER,
        mintAuthorityMultisig: multisig,
      } as const
      await assert.rejects(
        () => new DeployTokenPool().generate(chainAt('1.6.2'), params),
        CCTOperationUnsupportedError,
      )
      await assert.rejects(
        () =>
          new DeployTokenPool().generate(chainAt('2.0.0'), {
            ...params,
            mintAuthorityMultisig: 'not-a-key',
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'mintAuthorityMultisig',
      )
    })
  })

  describe('validation', () => {
    it('rejects a non-array allowlist', async () => {
      await assert.rejects(
        () => generate({ allowlist: 'not-an-array' }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'allowlist',
      )
    })

    it('rejects a non-boolean createPoolSignerATA', async () => {
      await assert.rejects(
        () => generate({ createPoolSignerATA: 'yes' }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'createPoolSignerATA',
      )
    })

    it('rejects invalid pool types', async () => {
      await assert.rejects(
        () => generate({ poolType: 'custom' }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'deployTokenPool' &&
          err.context.param === 'poolType',
      )
    })

    it('rejects an invalid poolProgramAddress', async () => {
      await assert.rejects(
        () => generate({ poolProgramAddress: 'not-a-pubkey' }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'deployTokenPool' &&
          err.context.param === 'poolProgramAddress',
      )
    })

    it('rejects a poolProgramAddress whose program reports the other pool type', async () => {
      const chain = Object.assign(stubChain(), {
        typeAndVersion: async () => ['BurnMintTokenPool', '1.6.0'],
      })
      await assert.rejects(
        () =>
          new DeployTokenPool().generate(chain, {
            tokenAddress: TOKEN,
            poolType: 'lock-release',
            poolProgramAddress: Keypair.generate().publicKey.toBase58(),
            payer: PAYER,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'deployTokenPool' &&
          err.context.param === 'poolProgramAddress',
      )
    })

    it('rejects an empty authority', async () => {
      await assert.rejects(
        () => generate({ authority: '' }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'deployTokenPool' &&
          err.context.param === 'authority',
      )
    })

    it('rejects duplicate allowlist addresses', async () => {
      const address = Keypair.generate().publicKey.toBase58()
      await assert.rejects(
        () => generate({ allowlist: [address, address] }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'allowlist[1]',
      )
    })

    it('rejects invalid allowlist addresses', async () => {
      await assert.rejects(
        () => generate({ allowlist: ['not-a-pubkey'] }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'deployTokenPool' &&
          err.context.param === 'allowlist[0]',
      )
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns pool addresses', async () => {
      const result = await new DeployTokenPool().execute(
        Object.assign(stubChain(), {
          connection: {
            simulateTransaction: async () => ({ value: { err: null, logs: [], unitsConsumed: 1 } }),
            getLatestBlockhash: async () => ({
              blockhash: PublicKey.default.toBase58(),
              lastValidBlockHeight: 1,
            }),
            sendTransaction: async () => HASH,
            confirmTransaction: async () => ({ value: { err: null } }),
          },
        }),
        {
          tokenAddress: TOKEN,
          poolType: 'burn-mint',
          wallet: { ...WALLET, publicKey: new PublicKey(PAYER) },
        },
      )

      assert.equal(result.hash, HASH)
      assert.ok(result.poolAddress)
      assert.ok(result.poolSignerAddress)
    })

    it('rejects signed deploy when authority is not the wallet', async () => {
      await assert.rejects(
        () =>
          new DeployTokenPool().execute(stubChain(), {
            tokenAddress: TOKEN,
            poolType: 'burn-mint',
            wallet: WALLET,
            authority: AUTHORITY,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'deployTokenPool' &&
          err.context.param === 'authority',
      )
    })
  })
})
