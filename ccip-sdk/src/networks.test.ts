import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { CCIPChainNotFoundError } from './errors/pure.ts'
import { ChainFamily, NetworkType, networkInfo } from './networks.ts'
import SELECTORS from './selectors.ts'

// the local-anvil devnet from the scratch-mode harness: chainId 2337 is not in the bundled table
const LOCAL_CHAIN_ID = 2337
const LOCAL_SELECTOR = 12922642891491394802n
const SEPOLIA_SELECTOR = 16015286601757825753n
// a Tenderly Virtual Environment's recommended id for a Sepolia fork (> 2^32: not an array index)
const FORK_CHAIN_ID = 735711155111

// tests write into the shared table: restore it after each one
const bundled = { ...SELECTORS }
function restoreSelectors() {
  for (const id of Object.keys(SELECTORS)) if (!Object.hasOwn(bundled, id)) delete SELECTORS[id]
  Object.assign(SELECTORS, bundled)
}

describe('networkInfo over a mutated SELECTORS table', () => {
  afterEach(restoreSelectors)

  it('resolves an added chain by id, selector and name', () => {
    assert.throws(() => networkInfo(LOCAL_CHAIN_ID), CCIPChainNotFoundError)
    assert.throws(() => networkInfo(LOCAL_SELECTOR), CCIPChainNotFoundError)

    SELECTORS[LOCAL_CHAIN_ID] = {
      selector: LOCAL_SELECTOR,
      name: 'local-anvil-dst',
      family: ChainFamily.EVM,
      network_type: NetworkType.Testnet,
    }

    assert.deepEqual(networkInfo(LOCAL_CHAIN_ID), {
      chainId: LOCAL_CHAIN_ID,
      chainSelector: LOCAL_SELECTOR,
      name: 'local-anvil-dst',
      family: ChainFamily.EVM,
      networkType: NetworkType.Testnet,
    })
    assert.equal(networkInfo(LOCAL_SELECTOR).chainId, LOCAL_CHAIN_ID)
    assert.equal(networkInfo(String(LOCAL_SELECTOR)).chainId, LOCAL_CHAIN_ID)
    assert.equal(networkInfo(BigInt(LOCAL_CHAIN_ID)).chainId, LOCAL_CHAIN_ID)
    assert.equal(networkInfo('local-anvil-dst').chainId, LOCAL_CHAIN_ID)
  })

  it('sees an entry replaced after it was resolved (no stale cache)', () => {
    const before = networkInfo(1337)
    assert.equal(networkInfo(before.chainSelector).chainId, 1337)

    SELECTORS[1337] = { ...SELECTORS[1337]!, selector: LOCAL_SELECTOR }

    assert.equal(networkInfo(1337).chainSelector, LOCAL_SELECTOR)
    assert.equal(networkInfo(LOCAL_SELECTOR).chainId, 1337)
    assert.throws(() => networkInfo(before.chainSelector), CCIPChainNotFoundError)
  })

  it('sees an entry edited in place', () => {
    const entry: (typeof SELECTORS)[string] = {
      selector: LOCAL_SELECTOR,
      name: 'local-anvil-dst',
      family: ChainFamily.EVM,
      network_type: NetworkType.Testnet,
    }
    SELECTORS[LOCAL_CHAIN_ID] = entry
    assert.equal(networkInfo(LOCAL_CHAIN_ID).networkType, NetworkType.Testnet)
    entry.network_type = NetworkType.Mainnet // same object: only a field changes
    assert.equal(networkInfo(LOCAL_CHAIN_ID).networkType, NetworkType.Mainnet)
  })

  it('sees a removed entry', () => {
    networkInfo(SEPOLIA_SELECTOR)
    delete SELECTORS[11155111]
    assert.throws(() => networkInfo(11155111), CCIPChainNotFoundError)
    assert.throws(() => networkInfo(SEPOLIA_SELECTOR), CCIPChainNotFoundError)
    assert.throws(() => networkInfo('ethereum-testnet-sepolia'), CCIPChainNotFoundError)
  })

  it('returns the same object for an unchanged entry, however it is resolved', () => {
    const sepolia = networkInfo(11155111)
    assert.equal(networkInfo(1), networkInfo(1))
    assert.equal(networkInfo(SEPOLIA_SELECTOR), sepolia)
    assert.equal(networkInfo('ethereum-testnet-sepolia'), sepolia)
    assert.equal(networkInfo('11155111'), sepolia)
  })

  it('resolves a name without a hyphen', () => {
    SELECTORS[LOCAL_CHAIN_ID] = {
      selector: LOCAL_SELECTOR,
      name: 'localdst',
      family: ChainFamily.EVM,
      network_type: NetworkType.Testnet,
    }
    assert.equal(networkInfo('localdst').chainId, LOCAL_CHAIN_ID)
  })

  it('resolves non-numeric chain ids before names', () => {
    assert.equal(networkInfo('aptos:1').name, 'aptos-mainnet')
    assert.equal(networkInfo('canton:TestNet').name, 'canton-testnet')
    assert.equal(networkInfo('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG').name, 'solana-devnet')
  })

  it('does not resolve Object.prototype keys as chains', () => {
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty'])
      assert.throws(() => networkInfo(key), CCIPChainNotFoundError, key)
  })

  it('re-keys a moved entry (a fork served under another chain id)', () => {
    SELECTORS[FORK_CHAIN_ID] = SELECTORS[11155111]!
    delete SELECTORS[11155111]

    // a message decoded on the fork carries Sepolia's selector: it must resolve to the fork's id
    assert.equal(networkInfo(SEPOLIA_SELECTOR).chainId, FORK_CHAIN_ID)
    assert.equal(networkInfo('ethereum-testnet-sepolia').chainId, FORK_CHAIN_ID)
    assert.equal(networkInfo(FORK_CHAIN_ID).chainSelector, SEPOLIA_SELECTOR)
    assert.throws(() => networkInfo(11155111), CCIPChainNotFoundError)
  })
})
