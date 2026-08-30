import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { CCIPChainNotFoundError, CCIPChainRegistrationError } from './errors/pure.ts'
import {
  type ChainRegistration,
  ChainFamily,
  NetworkType,
  clearNetworkInfoCaches,
  networkInfo,
  registerChains,
} from './networks.ts'
import SELECTORS from './selectors.ts'

// the local-anvil devnet from the scratch-mode harness: chainId 2337 is not in the bundled table
const LOCAL_CHAIN_ID = 2337
const LOCAL_SELECTOR = 12922642891491394802n

function unregister(...chainIds: (string | number)[]) {
  for (const id of chainIds) delete SELECTORS[String(id)]
  // a fork re-keys the bundled entry away; put it back so suites stay independent
  SELECTORS['11155111'] = {
    selector: SEPOLIA_SELECTOR,
    name: 'ethereum-testnet-sepolia',
    network_type: NetworkType.Testnet,
    family: ChainFamily.EVM,
  }
  clearNetworkInfoCaches()
}

const SEPOLIA_SELECTOR = 16015286601757825753n

describe('registerChains', () => {
  afterEach(() => unregister(LOCAL_CHAIN_ID, 4242, 'aptos:99', 73571))

  it('resolves a chain that is not in the bundled table, by id, selector and name', () => {
    assert.throws(() => networkInfo(LOCAL_CHAIN_ID), CCIPChainNotFoundError)
    assert.throws(() => networkInfo(LOCAL_SELECTOR), CCIPChainNotFoundError)

    const [info] = registerChains([
      { chainId: LOCAL_CHAIN_ID, chainSelector: LOCAL_SELECTOR, name: 'local-anvil-dst' },
    ])

    assert.deepEqual(info, {
      chainId: LOCAL_CHAIN_ID,
      chainSelector: LOCAL_SELECTOR,
      name: 'local-anvil-dst',
      family: ChainFamily.EVM,
      networkType: NetworkType.Testnet,
    })
    // every resolution form must see it, including the reverse selector -> chainId scan
    assert.equal(networkInfo(LOCAL_CHAIN_ID).chainSelector, LOCAL_SELECTOR)
    assert.equal(networkInfo(LOCAL_SELECTOR).chainId, LOCAL_CHAIN_ID)
    assert.equal(networkInfo(String(LOCAL_SELECTOR)).chainId, LOCAL_CHAIN_ID)
    assert.equal(networkInfo('local-anvil-dst').chainId, LOCAL_CHAIN_ID)
  })

  it('busts the memoized miss recorded before registration', () => {
    assert.throws(() => networkInfo(LOCAL_SELECTOR), CCIPChainNotFoundError)
    registerChains([{ chainId: LOCAL_CHAIN_ID, chainSelector: LOCAL_SELECTOR }])
    assert.equal(networkInfo(LOCAL_SELECTOR).chainId, LOCAL_CHAIN_ID)
  })

  it('defaults name/family/networkType, and accepts non-EVM families', () => {
    const [evm, aptos] = registerChains([
      { chainId: 4242, chainSelector: '4242424242424242424' },
      {
        chainId: 'aptos:99',
        chainSelector: 4242424242424242425n,
        family: ChainFamily.Aptos,
        networkType: NetworkType.Mainnet,
      },
    ])
    assert.equal(evm!.name, 'custom-4242')
    assert.equal(evm!.family, ChainFamily.EVM)
    assert.equal(evm!.networkType, NetworkType.Testnet)
    assert.equal(aptos!.family, ChainFamily.Aptos)
    assert.equal(aptos!.networkType, NetworkType.Mainnet)
    assert.equal(aptos!.chainId, 'aptos:99')
  })

  it('does not perturb bundled chains', () => {
    const sepolia = networkInfo(11155111)
    registerChains([{ chainId: LOCAL_CHAIN_ID, chainSelector: LOCAL_SELECTOR }])
    assert.deepEqual(networkInfo(11155111), sepolia)
    assert.equal(networkInfo(16015286601757825753n).name, 'ethereum-testnet-sepolia')
  })

  it('rejects a selector already owned by another chain', () => {
    assert.throws(
      () => registerChains([{ chainId: LOCAL_CHAIN_ID, chainSelector: 16015286601757825753n }]),
      CCIPChainRegistrationError,
    )
    assert.throws(() => networkInfo(LOCAL_CHAIN_ID), CCIPChainNotFoundError)
  })

  it('rejects a selector already owned by another chain, unless it is an explicit fork', () => {
    assert.throws(
      () => registerChains([{ chainId: 73571, chainSelector: SEPOLIA_SELECTOR }]),
      CCIPChainRegistrationError,
    )
    assert.equal(
      registerChains([{ chainId: 73571, forkOf: 11155111 }])[0]!.chainSelector,
      SEPOLIA_SELECTOR,
    )
  })

  it('rejects invalid entries', () => {
    for (const entry of [
      { chainId: LOCAL_CHAIN_ID, chainSelector: 'not-a-number' },
      { chainId: LOCAL_CHAIN_ID, chainSelector: 0n },
      { chainId: '', chainSelector: LOCAL_SELECTOR },
      { chainId: LOCAL_CHAIN_ID, chainSelector: LOCAL_SELECTOR, family: 'BITCOIN' },
      { chainId: LOCAL_CHAIN_ID, chainSelector: LOCAL_SELECTOR, networkType: 'STAGING' },
    ] as ChainRegistration[]) {
      assert.throws(() => registerChains([entry]), CCIPChainRegistrationError)
    }
  })
})

describe('registerChains — forks', () => {
  afterEach(() => unregister(73571))

  it('re-keys a known chain to the fork chain id, keeping its selector, name and family', () => {
    const [fork] = registerChains([{ chainId: 73571, forkOf: 'ethereum-testnet-sepolia' }])
    assert.deepEqual(fork, {
      chainId: 73571,
      chainSelector: SEPOLIA_SELECTOR,
      name: 'ethereum-testnet-sepolia',
      family: ChainFamily.EVM,
      networkType: NetworkType.Testnet,
    })
    // all three resolution forms agree on the fork — a message decoded from the fork carries the
    // ORIGINAL selector, so this is what makes it resolve back to the fork's RPC
    assert.equal(networkInfo(73571).chainSelector, SEPOLIA_SELECTOR)
    assert.equal(networkInfo(SEPOLIA_SELECTOR).chainId, 73571)
    assert.equal(networkInfo('ethereum-testnet-sepolia').chainId, 73571)
    // the forked chain id no longer resolves: a selector identifies exactly one chain
    assert.throws(() => networkInfo(11155111), CCIPChainNotFoundError)
  })

  it('accepts the forked chain by id, selector or name, and an optional name override', () => {
    for (const forkOf of [11155111, SEPOLIA_SELECTOR, 'ethereum-testnet-sepolia'] as const) {
      const [fork] = registerChains([{ chainId: 73571, forkOf }])
      assert.equal(fork!.chainSelector, SEPOLIA_SELECTOR)
      unregister(73571)
    }
    const [named] = registerChains([{ chainId: 73571, forkOf: 11155111, name: 'tenderly-sepolia' }])
    assert.equal(named!.name, 'tenderly-sepolia')
    assert.equal(networkInfo('tenderly-sepolia').chainSelector, SEPOLIA_SELECTOR)
  })

  it('rejects an unknown forked chain', () => {
    assert.throws(
      () => registerChains([{ chainId: 73571, forkOf: 'no-such-chain' }]),
      CCIPChainRegistrationError,
    )
  })

  it('refuses to give a fork a mainnet chain id', () => {
    assert.throws(
      () => registerChains([{ chainId: 1, forkOf: 'ethereum-testnet-sepolia' }]),
      CCIPChainRegistrationError,
    )
    assert.equal(networkInfo(1).name, 'ethereum-mainnet')
  })

  it('takes over a bundled local chain id (hardhat node --fork keeps 31337)', () => {
    assert.equal(networkInfo(31337).name, 'anvil-devnet') // bundled, wrong selector for a fork
    const [fork] = registerChains([{ chainId: 31337, forkOf: 'ethereum-testnet-sepolia' }])
    assert.equal(fork!.chainSelector, SEPOLIA_SELECTOR)
    assert.equal(networkInfo(SEPOLIA_SELECTOR).chainId, 31337)
    // restore the displaced bundled entry
    SELECTORS['31337'] = {
      selector: 7759470850252068959n,
      name: 'anvil-devnet',
      network_type: NetworkType.Testnet,
      family: ChainFamily.EVM,
    }
    unregister()
  })
})
