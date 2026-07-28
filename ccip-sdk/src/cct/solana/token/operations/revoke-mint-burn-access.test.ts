import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair } from '@solana/web3.js'

import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { RevokeMintBurnAccess } from './revoke-mint-burn-access.ts'

const PAYER = Keypair.generate().publicKey.toBase58()
const TOKEN = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()

function noRpcChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: { getAccountInfo: () => assert.fail('should not RPC — revoke is unsupported') },
  } as unknown as SolanaChain
}

describe('Solana token revokeMintBurnAccess', () => {
  it('is unsupported and always rejects before any RPC', async () => {
    await assert.rejects(
      () =>
        new RevokeMintBurnAccess().generate(noRpcChain(), {
          payer: PAYER,
          tokenAddress: TOKEN,
          authority: AUTHORITY,
          role: 'mint',
        }),
      (error: unknown) => {
        assert.ok(error instanceof CCTParamsInvalidError)
        assert.equal(error.context.operation, 'revokeMintBurnAccess')
        return true
      },
    )
  })
})
