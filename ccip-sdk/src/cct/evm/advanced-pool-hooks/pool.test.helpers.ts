/**
 * Test helpers for the hooks ops, which resolve their target from a v2.0.0 pool:
 * {@link withPool} wraps a hooks-only chain stub with the pool reads `resolveAdvancedPoolHooks`
 * makes first, so each op test keeps stubbing only the hooks contract it actually exercises.
 */

import { Interface, getAddress, makeError } from 'ethers'

import type { EVMChain } from '../../../evm/index.ts'
import { parseTypeAndVersion } from '../../../utils.ts'

/** The pool every hooks-op test resolves its hooks through. */
export const POOL = getAddress('0x' + 'f0'.repeat(20))

/** Fresh pool-side getter interface for the stub — never the SDK's cached one. */
const POOL_IFACE = new Interface(['function getAdvancedPoolHooks() view returns (address)'])
const GET_ADVANCED_POOL_HOOKS = POOL_IFACE.getFunction('getAdvancedPoolHooks')!.selector

/** What {@link POOL} reports to {@link withPool}'s stub. */
export type PoolStub = {
  /** The pool's `getAdvancedPoolHooks()` result; the zero address means none bound. */
  hooks: string
  /** The pool's `typeAndVersion`; defaults to `BurnMintTokenPool 2.0.0`. */
  typeAndVersion?: string
  /** Records each pool read as `fn:address`, so tests can assert read order and absence. */
  onCall?: (call: string) => void
}

/** The plain-object shape every hooks test stub has, under its `EVMChain` cast. */
type ChainStub = {
  typeAndVersion: (address: string) => Promise<unknown>
  provider: { call: (tx: { to: string; data: string }) => Promise<string> }
}

/**
 * Wraps `chain` so {@link POOL} answers `typeAndVersion` and `getAdvancedPoolHooks()`; every read
 * of any other address is forwarded to `chain` unchanged. Any other call to the pool reverts,
 * since hooks ops must never read the pool beyond resolving its binding.
 */
export function withPool(
  chain: EVMChain,
  { hooks, typeAndVersion = 'BurnMintTokenPool 2.0.0', onCall }: PoolStub,
): EVMChain {
  const stub = chain as unknown as ChainStub
  const isPool = (address: string) => getAddress(address) === POOL
  return {
    ...stub,
    typeAndVersion: (address: string) => {
      if (!isPool(address)) return stub.typeAndVersion(address)
      onCall?.(`typeAndVersion:${POOL}`)
      return Promise.resolve(parseTypeAndVersion(typeAndVersion))
    },
    provider: {
      ...stub.provider,
      call: (tx: { to: string; data: string }) => {
        if (!isPool(tx.to)) return stub.provider.call(tx)
        onCall?.(`getAdvancedPoolHooks:${POOL}`)
        if (!tx.data.startsWith(GET_ADVANCED_POOL_HOOKS))
          return Promise.reject(makeError('execution reverted', 'CALL_EXCEPTION'))
        return Promise.resolve(POOL_IFACE.encodeFunctionResult('getAdvancedPoolHooks', [hooks]))
      },
    },
  } as unknown as EVMChain
}
