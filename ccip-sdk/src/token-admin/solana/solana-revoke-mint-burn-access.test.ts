import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type Connection, Keypair } from '@solana/web3.js'

import { SolanaTokenAdmin } from './index.ts'
import { CCIPRevokeMintBurnAccessParamsInvalidError } from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'
import type { RevokeMintBurnAccessParams } from '../types.ts'

// ── Mocks ──

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} }

const dummyNetwork: NetworkInfo = {
  name: 'solana-devnet',
  family: ChainFamily.Solana,
  chainSelector: 1n,
  chainId: 'solana-devnet',
  networkType: NetworkType.Testnet,
}

const mockConnection = {
  getSignaturesForAddress: async () => [],
  getAccountInfo: async () => null,
} as unknown as Connection

function makeAdmin(): SolanaTokenAdmin {
  return new SolanaTokenAdmin(mockConnection, dummyNetwork, {
    logger: silentLogger,
    apiClient: null,
  })
}

const validParams: RevokeMintBurnAccessParams = {
  tokenAddress: Keypair.generate().publicKey.toBase58(),
  authority: Keypair.generate().publicKey.toBase58(),
  role: 'mint',
}

// =============================================================================
// SolanaTokenAdmin — revokeMintBurnAccess
// =============================================================================

describe('SolanaTokenAdmin — revokeMintBurnAccess', () => {
  it('should always throw — Solana does not support role-based revoke', async () => {
    const admin = makeAdmin()
    await assert.rejects(
      () => admin.revokeMintBurnAccess({}, validParams),
      (err: unknown) => {
        assert.ok(err instanceof CCIPRevokeMintBurnAccessParamsInvalidError)
        assert.equal(err.code, 'REVOKE_MINT_BURN_ACCESS_PARAMS_INVALID')
        assert.equal(err.context.param, 'chain')
        assert.ok(err.message.includes('transferMintAuthority'))
        return true
      },
    )
  })

  it('should throw for role: burn as well', async () => {
    const admin = makeAdmin()
    await assert.rejects(
      () => admin.revokeMintBurnAccess({}, { ...validParams, role: 'burn' }),
      (err: unknown) => {
        assert.ok(err instanceof CCIPRevokeMintBurnAccessParamsInvalidError)
        assert.ok(err.message.includes('transferMintAuthority'))
        return true
      },
    )
  })
})
