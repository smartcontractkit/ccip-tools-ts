import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Connection } from '@solana/web3.js'

import { type TokenAuthorityType, SolanaTokenManager, TOKEN_AUTHORITY_TYPES } from './index.ts'
import type {
  GetTokenPoolStateParams,
  GetTokenPoolStateResult,
} from './token-pool/operations/index.ts'
import { SolanaChain } from '../../solana/index.ts'

function stubChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {},
  } as unknown as SolanaChain
}

describe('SolanaTokenManager (cct/solana)', () => {
  it('fromChain exposes flat Solana CCT operations', () => {
    const chain = stubChain()
    const cct = SolanaTokenManager.fromChain(chain)
    assert.equal(cct.chain, chain)
    assert.equal(cct.provider, chain.connection)
    // Token operations
    assert.equal(typeof cct.generateUnsignedDeployToken, 'function')
    assert.equal(typeof cct.deployToken, 'function')
    assert.equal(typeof cct.generateUnsignedApproveToken, 'function')
    assert.equal(typeof cct.approveToken, 'function')
    assert.equal(typeof cct.generateUnsignedCreateTokenAccount, 'function')
    assert.equal(typeof cct.createTokenAccount, 'function')
    assert.equal(typeof cct.generateUnsignedMintTokens, 'function')
    assert.equal(typeof cct.mintTokens, 'function')
    assert.equal(typeof cct.generateUnsignedSetTokenAuthority, 'function')
    assert.equal(typeof cct.setTokenAuthority, 'function')

    // Token admin registry operations
    assert.equal(typeof cct.generateUnsignedAcceptAdmin, 'function')
    assert.equal(typeof cct.acceptAdmin, 'function')
    assert.equal(typeof cct.generateUnsignedCreateLookupTable, 'function')
    assert.equal(typeof cct.createLookupTable, 'function')
    assert.equal(typeof cct.generateUnsignedAppendToLookupTable, 'function')
    assert.equal(typeof cct.appendToLookupTable, 'function')
    assert.equal(typeof cct.generateUnsignedRegisterAdmin, 'function')
    assert.equal(typeof cct.registerAdmin, 'function')
    assert.equal(typeof cct.generateUnsignedSetPool, 'function')
    assert.equal(typeof cct.setPool, 'function')
    assert.equal(typeof cct.generateUnsignedTransferAdmin, 'function')
    assert.equal(typeof cct.transferAdmin, 'function')
    assert.equal(typeof cct.getTokenAdminRegistry, 'function')
    assert.equal(typeof cct.getSupportedTokens, 'function')

    // Token pool operations
    assert.equal(typeof cct.generateUnsignedAppendRemotePoolAddresses, 'function')
    assert.equal(typeof cct.appendRemotePoolAddresses, 'function')
    assert.equal(typeof cct.generateUnsignedApplyChainUpdates, 'function')
    assert.equal(typeof cct.applyChainUpdates, 'function')
    assert.equal(typeof cct.generateUnsignedConfigureAllowlist, 'function')
    assert.equal(typeof cct.configureAllowlist, 'function')
    assert.equal(typeof cct.generateUnsignedCreateTokenMultisig, 'function')
    assert.equal(typeof cct.createTokenMultisig, 'function')
    assert.equal(typeof cct.generateUnsignedDeployTokenPool, 'function')
    assert.equal(typeof cct.deployTokenPool, 'function')
    assert.equal(typeof cct.generateUnsignedDeleteChainRemoteConfig, 'function')
    assert.equal(typeof cct.deleteChainRemoteConfig, 'function')
    assert.equal(typeof cct.generateUnsignedSetCanAcceptLiquidity, 'function')
    assert.equal(typeof cct.setCanAcceptLiquidity, 'function')
    assert.equal(typeof cct.generateUnsignedSetChainRateLimit, 'function')
    assert.equal(typeof cct.setChainRateLimit, 'function')
    assert.equal(typeof cct.generateUnsignedSetRateLimitAdmin, 'function')
    assert.equal(typeof cct.setRateLimitAdmin, 'function')
    assert.equal(typeof cct.generateUnsignedSetRebalancer, 'function')
    assert.equal(typeof cct.setRebalancer, 'function')
    assert.equal(typeof cct.generateUnsignedTransferOwnership, 'function')
    assert.equal(typeof cct.transferOwnership, 'function')
    assert.equal(typeof cct.generateUnsignedAcceptOwnership, 'function')
    assert.equal(typeof cct.acceptOwnership, 'function')
    assert.equal(typeof cct.generateUnsignedEditChainRemoteConfig, 'function')
    assert.equal(typeof cct.editChainRemoteConfig, 'function')
    assert.equal(typeof cct.generateUnsignedRemoveFromAllowlist, 'function')
    assert.equal(typeof cct.removeFromAllowlist, 'function')
    assert.equal(typeof cct.getTokenPoolRemotes, 'function')
    assert.equal(typeof cct.getTokenPoolState, 'function')
  })

  it('exports public token authority constants', () => {
    const authorityType: TokenAuthorityType = TOKEN_AUTHORITY_TYPES.MINT

    assert.equal(authorityType, 'mint')
    assert.equal(TOKEN_AUTHORITY_TYPES.FREEZE, 'freeze')
  })

  it('creates from a connection provider', async (t) => {
    const chain = stubChain()
    const connection = new Connection('http://localhost:8899')
    t.mock.method(SolanaChain, 'fromConnection', async (provider: Connection) => {
      assert.equal(provider, connection)
      return chain
    })

    const cct = await SolanaTokenManager.fromProvider(connection)

    assert.equal(cct.chain, chain)
  })

  it('creates from an RPC URL', async (t) => {
    const chain = stubChain()
    t.mock.method(SolanaChain, 'fromUrl', async (url: string) => {
      assert.equal(url, 'http://localhost:8899')
      return chain
    })

    const cct = await SolanaTokenManager.fromUrl('http://localhost:8899')

    assert.equal(cct.chain, chain)
  })

  it('getTokenPoolState accepts params whose pool program is not known statically', () => {
    const cct = SolanaTokenManager.fromChain(stubChain())
    // A parameter is not narrowed to one PoolProgramRef arm the way a const literal is, so this
    // only compiles while a `GetTokenPoolStateParams` overload is declared: TypeScript never
    // exposes the implementation signature to callers.
    const read = (opts: GetTokenPoolStateParams): Promise<GetTokenPoolStateResult> =>
      cct.getTokenPoolState(opts)

    assert.equal(typeof read, 'function')
  })
})
