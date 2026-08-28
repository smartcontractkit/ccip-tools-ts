import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import { tokenPoolCoder } from '../../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'
import { deriveTokenPoolConfigPda, resolveTokenPoolProgram } from '../../programs/token-pool.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const ALLOWED = Keypair.generate().publicKey.toBase58()
const SECOND_ALLOWED = Keypair.generate().publicKey.toBase58()
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

function submitChain(): SolanaChain {
  return Object.assign(stubChain(), {
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
  return SolanaTokenManager.fromChain(stubChain()).generateUnsignedConfigureAllowlist({
    tokenAddress: TOKEN,
    poolType: 'burn-mint',
    payer: PAYER,
    authority: AUTHORITY,
    add: [ALLOWED],
    enabled: true,
    ...opts,
  })
}

describe('ConfigureAllowlist (cct/solana)', () => {
  describe('generate', () => {
    it('builds an unsigned configure allowlist instruction', async () => {
      const unsigned = await generate()
      const [instruction] = unsigned.instructions
      const poolProgram = resolveTokenPoolProgram('burn-mint')

      assert.ok(instruction)
      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.mainIndex, 0)
      assert.equal(instruction.programId.toBase58(), poolProgram.toBase58())
      assert.deepEqual(
        instruction.keys.map(({ pubkey, isSigner, isWritable }) => ({
          pubkey: pubkey.toBase58(),
          isSigner,
          isWritable,
        })),
        [
          {
            pubkey: deriveTokenPoolConfigPda(poolProgram, new PublicKey(TOKEN)).toBase58(),
            isSigner: false,
            isWritable: true,
          },
          { pubkey: TOKEN, isSigner: false, isWritable: false },
          { pubkey: AUTHORITY, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId.toBase58(), isSigner: false, isWritable: false },
        ],
      )
    })

    it('encodes multiple addresses and overwrites enforcement', async () => {
      const unsigned = await generate({ add: [ALLOWED, SECOND_ALLOWED], enabled: false })
      const decoded = tokenPoolCoder.instruction.decode(unsigned.instructions[0]!.data)

      assert.ok(decoded)
      assert.equal(decoded.name, 'configureAllowList')
      assert.deepEqual(
        (decoded.data as { add: PublicKey[] }).add.map((address) => address.toBase58()),
        [ALLOWED, SECOND_ALLOWED],
      )
      assert.equal((decoded.data as { enabled: boolean }).enabled, false)
    })

    it('encodes a toggle without addresses', async () => {
      const unsigned = await generate({ add: [], enabled: false })
      const decoded = tokenPoolCoder.instruction.decode(unsigned.instructions[0]!.data)

      assert.ok(decoded)
      assert.equal(decoded.name, 'configureAllowList')
      assert.deepEqual((decoded.data as { add: PublicKey[] }).add, [])
      assert.equal((decoded.data as { enabled: boolean }).enabled, false)
    })

    it('uses a compatible custom pool program', async () => {
      const poolProgramAddress = Keypair.generate().publicKey.toBase58()
      const unsigned = await SolanaTokenManager.fromChain(
        stubChain(),
      ).generateUnsignedConfigureAllowlist({
        tokenAddress: TOKEN,
        poolProgramAddress,
        payer: PAYER,
        authority: AUTHORITY,
        add: [ALLOWED],
        enabled: true,
      })

      assert.equal(unsigned.instructions[0]?.programId.toBase58(), poolProgramAddress)
    })
  })

  describe('validation', () => {
    it('rejects invalid pool program references', async () => {
      await assert.rejects(
        () => generate({ poolType: 'custom' }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'configureAllowlist' &&
          err.context.param === 'poolType',
      )
    })

    it('rejects non-array addresses to add', async () => {
      await assert.rejects(
        () => generate({ add: 'not-an-array' }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'configureAllowlist' &&
          err.context.param === 'add',
      )
    })

    it('rejects invalid addresses to add', async () => {
      await assert.rejects(
        () => generate({ add: ['not-a-pubkey'] }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'configureAllowlist' &&
          err.context.param === 'add[0]',
      )
    })

    it('rejects duplicate addresses to add', async () => {
      await assert.rejects(
        () => generate({ add: [ALLOWED, ALLOWED] }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'configureAllowlist' &&
          err.context.param === 'add',
      )
    })

    it('rejects non-boolean enabled values', async () => {
      await assert.rejects(
        () => generate({ enabled: 'true' }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'configureAllowlist' &&
          err.context.param === 'enabled',
      )
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns the tx hash', async () => {
      const result = await SolanaTokenManager.fromChain(submitChain()).configureAllowlist({
        tokenAddress: TOKEN,
        poolType: 'burn-mint',
        add: [ALLOWED],
        enabled: true,
        wallet: WALLET,
      })

      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a non-wallet authority for signed configuration', async () => {
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(stubChain()).configureAllowlist({
            tokenAddress: TOKEN,
            poolType: 'burn-mint',
            authority: AUTHORITY,
            add: [ALLOWED],
            enabled: true,
            wallet: WALLET,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'configureAllowlist' &&
          err.context.param === 'authority',
      )
    })
  })
})
