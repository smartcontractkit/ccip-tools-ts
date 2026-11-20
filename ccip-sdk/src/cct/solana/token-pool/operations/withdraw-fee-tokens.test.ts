import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { describe, it } from 'node:test'

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { type PublicKey, Keypair } from '@solana/web3.js'

import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import {
  deriveTokenPoolConfigPda,
  deriveTokenPoolFeeVaultPda,
  resolveTokenPoolProgram,
} from '../../programs/token-pool.ts'
import { WithdrawFeeTokens } from './withdraw-fee-tokens.ts'

const MINT = Keypair.generate().publicKey
const FEE_MINT = Keypair.generate().publicKey
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const RECIPIENT = Keypair.generate().publicKey
const POOL_PROGRAM = resolveTokenPoolProgram('burn-mint')
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}
// From the program's IDL, checked independently of the SDK's sighash
const DISCRIMINATOR = [130, 83, 245, 243, 236, 40, 197, 229]

function chain(version = '2.0.0'): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getMultipleAccountsInfo: async () => [{}],
      getAccountInfo: async (key: PublicKey) =>
        key.equals(FEE_MINT) ? { owner: TOKEN_PROGRAM_ID, data: Buffer.alloc(82) } : {},
    },
    typeAndVersion: async () => ['burnmintTokenPool', version],
  } as unknown as SolanaChain
}

const params = {
  tokenAddress: MINT.toBase58(),
  feeTokenAddress: FEE_MINT.toBase58(),
  recipient: RECIPIENT.toBase58(),
  payer: PAYER,
  authority: AUTHORITY,
}

describe('WithdrawFeeTokens (cct/solana)', () => {
  it('creates the recipient token account and withdraws from the fee vault', async () => {
    const { instructions, mainIndex } = await new WithdrawFeeTokens().generate(chain(), params)
    const [createAta, withdraw] = instructions
    const feeVault = deriveTokenPoolFeeVaultPda(POOL_PROGRAM, MINT)
    const recipientAta = getAssociatedTokenAddressSync(FEE_MINT, RECIPIENT, true)

    assert.equal(mainIndex, 1)
    assert.ok(createAta!.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID))
    assert.ok(createAta!.keys[1]!.pubkey.equals(recipientAta))
    assert.ok(withdraw!.programId.equals(POOL_PROGRAM))
    // discriminator, then `None`: withdraw the whole balance
    assert.deepEqual([...withdraw!.data], [...DISCRIMINATOR, 0])
    assert.deepEqual(
      withdraw!.keys.map(({ pubkey, isSigner, isWritable }) => [
        pubkey.toBase58(),
        isSigner,
        isWritable,
      ]),
      [
        [deriveTokenPoolConfigPda(POOL_PROGRAM, MINT).toBase58(), false, false],
        [MINT.toBase58(), false, false],
        [feeVault.toBase58(), false, false],
        [getAssociatedTokenAddressSync(FEE_MINT, feeVault, true).toBase58(), false, true],
        [recipientAta.toBase58(), false, true],
        [FEE_MINT.toBase58(), false, false],
        [TOKEN_PROGRAM_ID.toBase58(), false, false],
        [AUTHORITY, true, false],
      ],
    )
  })

  it('encodes a partial amount', async () => {
    const { instructions } = await new WithdrawFeeTokens().generate(chain(), {
      ...params,
      amount: 1_000n,
    })
    const amount = Buffer.alloc(8)
    amount.writeBigUInt64LE(1_000n)
    assert.deepEqual([...instructions[1]!.data], [...DISCRIMINATOR, 1, ...amount])
  })

  it('rejects invalid params and pools before CCIP 2.0', async () => {
    for (const [opts, param] of [
      [{ amount: 0n }, 'amount'],
      [{ amount: 1n << 64n }, 'amount'],
      [{ recipient: 'not-a-key' }, 'recipient'],
      [{ feeTokenAddress: undefined }, 'feeTokenAddress'],
    ] as const) {
      await assert.rejects(
        () => new WithdrawFeeTokens().generate(chain(), { ...params, ...opts } as never),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
      )
    }
    await assert.rejects(
      () => new WithdrawFeeTokens().generate(chain('1.6.2'), params),
      CCTOperationUnsupportedError,
    )
  })

  it('rejects a non-wallet authority for signed execution', async () => {
    await assert.rejects(
      () => new WithdrawFeeTokens().execute(chain(), { ...params, wallet: WALLET }),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'authority',
    )
  })
})
