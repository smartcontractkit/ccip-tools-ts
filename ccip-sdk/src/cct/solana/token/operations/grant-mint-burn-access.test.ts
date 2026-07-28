import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AuthorityType, TOKEN_PROGRAM_ID, createSetAuthorityInstruction } from '@solana/spl-token'
import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { GrantMintBurnAccess } from './grant-mint-burn-access.ts'

const MINT = Keypair.generate().publicKey
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()

function stubChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: async (key: PublicKey) =>
        key.equals(MINT) ? { owner: TOKEN_PROGRAM_ID } : null,
    },
  } as unknown as SolanaChain
}

function noRpcChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: { getAccountInfo: () => assert.fail('should not RPC before validation') },
  } as unknown as SolanaChain
}

describe('Solana token grantMintBurnAccess', () => {
  it('transfers mint authority to the grantee (matches setAuthority)', async () => {
    const unsigned = await new GrantMintBurnAccess().generate(stubChain(), {
      payer: PAYER,
      tokenAddress: MINT.toBase58(),
      authority: AUTHORITY,
    })

    assert.equal(unsigned.family, ChainFamily.Solana)
    assert.equal(unsigned.instructions.length, 1)

    const ref = createSetAuthorityInstruction(
      MINT,
      new PublicKey(PAYER),
      AuthorityType.MintTokens,
      new PublicKey(AUTHORITY),
      [],
      TOKEN_PROGRAM_ID,
    )
    assert.equal(unsigned.instructions[0]!.data.toString('hex'), ref.data.toString('hex'))
    assert.deepEqual(
      unsigned.instructions[0]!.keys.map((k) => k.pubkey.toBase58()),
      ref.keys.map((k) => k.pubkey.toBase58()),
    )
  })

  it('accepts role mint and mintAndBurn', async () => {
    for (const role of ['mint', 'mintAndBurn'] as const) {
      const unsigned = await new GrantMintBurnAccess().generate(stubChain(), {
        payer: PAYER,
        tokenAddress: MINT.toBase58(),
        authority: AUTHORITY,
        role,
      })
      assert.equal(unsigned.instructions.length, 1)
    }
  })

  it("rejects role 'burn' before any RPC", async () => {
    await assert.rejects(
      () =>
        new GrantMintBurnAccess().generate(noRpcChain(), {
          payer: PAYER,
          tokenAddress: MINT.toBase58(),
          authority: AUTHORITY,
          role: 'burn',
        }),
      CCTParamsInvalidError,
    )
  })

  it('rejects an invalid tokenAddress before any RPC', async () => {
    await assert.rejects(
      () =>
        new GrantMintBurnAccess().generate(noRpcChain(), {
          payer: PAYER,
          tokenAddress: 'not-a-key',
          authority: AUTHORITY,
        }),
      CCTParamsInvalidError,
    )
  })
})
