import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AptosTokenManager } from './index.ts'
import { AptosChain } from '../../aptos/index.ts'

function stubChain(): AptosChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    provider: {},
  } as unknown as AptosChain
}

describe('AptosTokenManager (cct/aptos)', () => {
  it('fromChain exposes flat Aptos CCT operations', () => {
    const chain = stubChain()
    const cct = AptosTokenManager.fromChain(chain)
    assert.equal(cct.chain, chain)
    assert.equal(cct.provider, chain.provider)
    // token / token-pool
    assert.equal(typeof cct.generateUnsignedDeployToken, 'function')
    assert.equal(typeof cct.deployToken, 'function')
    assert.equal(typeof cct.generateUnsignedDeployPool, 'function')
    assert.equal(typeof cct.deployPool, 'function')
    assert.equal(typeof cct.generateUnsignedGrantMintBurnAccess, 'function')
    assert.equal(typeof cct.grantMintBurnAccess, 'function')
    assert.equal(typeof cct.generateUnsignedRevokeMintBurnAccess, 'function')
    assert.equal(typeof cct.revokeMintBurnAccess, 'function')
    // token-admin-registry
    assert.equal(typeof cct.generateUnsignedProposeAdminRole, 'function')
    assert.equal(typeof cct.proposeAdminRole, 'function')
    assert.equal(typeof cct.generateUnsignedAcceptAdminRole, 'function')
    assert.equal(typeof cct.acceptAdminRole, 'function')
    assert.equal(typeof cct.generateUnsignedTransferAdminRole, 'function')
    assert.equal(typeof cct.transferAdminRole, 'function')
    assert.equal(typeof cct.generateUnsignedSetPool, 'function')
    assert.equal(typeof cct.setPool, 'function')
    // pool
    assert.equal(typeof cct.generateUnsignedApplyChainUpdates, 'function')
    assert.equal(typeof cct.applyChainUpdates, 'function')
    assert.equal(typeof cct.generateUnsignedAppendRemotePoolAddresses, 'function')
    assert.equal(typeof cct.appendRemotePoolAddresses, 'function')
    assert.equal(typeof cct.generateUnsignedRemoveRemotePoolAddresses, 'function')
    assert.equal(typeof cct.removeRemotePoolAddresses, 'function')
    assert.equal(typeof cct.generateUnsignedDeleteChainConfig, 'function')
    assert.equal(typeof cct.deleteChainConfig, 'function')
    assert.equal(typeof cct.generateUnsignedSetChainRateLimiterConfig, 'function')
    assert.equal(typeof cct.setChainRateLimiterConfig, 'function')
    assert.equal(typeof cct.generateUnsignedSetRateLimitAdmin, 'function')
    assert.equal(typeof cct.setRateLimitAdmin, 'function')
    assert.equal(typeof cct.generateUnsignedTransferOwnership, 'function')
    assert.equal(typeof cct.transferOwnership, 'function')
    assert.equal(typeof cct.generateUnsignedAcceptOwnership, 'function')
    assert.equal(typeof cct.acceptOwnership, 'function')
    assert.equal(typeof cct.generateUnsignedExecuteOwnershipTransfer, 'function')
    assert.equal(typeof cct.executeOwnershipTransfer, 'function')
    // read
    assert.equal(typeof cct.getMintBurnRoles, 'function')
  })

  it('creates from an Aptos provider', async (t) => {
    const chain = stubChain()
    const provider = {} as unknown as Parameters<typeof AptosTokenManager.fromProvider>[0]
    t.mock.method(AptosChain, 'fromProvider', async (arg: unknown) => {
      assert.equal(arg, provider)
      return chain
    })

    const cct = await AptosTokenManager.fromProvider(provider)

    assert.equal(cct.chain, chain)
  })

  it('creates from an RPC URL', async (t) => {
    const chain = stubChain()
    t.mock.method(AptosChain, 'fromUrl', async (url: string) => {
      assert.equal(url, 'http://localhost:8080')
      return chain
    })

    const cct = await AptosTokenManager.fromUrl('http://localhost:8080')

    assert.equal(cct.chain, chain)
  })
})
