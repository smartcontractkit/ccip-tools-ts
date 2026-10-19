/**
 * `USDCTokenPoolProxy` test support, NOT part of the SDK's public surface: an independent oracle
 * {@link PROXY_ORACLE} built from signature literals, and {@link stubProxyChain}, which answers
 * `typeAndVersion` and routes `eth_call`s by selector.
 *
 * @packageDocumentation
 */

import { Interface, makeError } from 'ethers'

import type { EVMChain } from '../../../evm/index.ts'
import { parseTypeAndVersion } from '../../../utils.ts'

export const PROXY = '0x' + '44'.repeat(20)

/** The proxy getters the reads call, from `USDCTokenPoolProxy.sol`, not the vendored ABI. */
export const PROXY_ORACLE = new Interface([
  'function getStaticConfig() view returns (address token, address router, address cctpVerifier)',
  'function getPools() view returns ((address cctpV1Pool, address cctpV2Pool, address cctpV2PoolWithCCV, address siloedLockReleasePool))',
  'function getFeeAggregator() view returns (address)',
  'function owner() view returns (address)',
  'function getLockOrBurnMechanism(uint64) view returns (uint8)',
  'function getRemotePools(uint64) view returns (bytes[])',
  'function getRequiredCCVs(address,uint64,uint256,bytes4,bytes,uint8) view returns (address[])',
  'error InvalidLockOrBurnMechanism(uint8 mechanism)',
  'error MustSetPoolForMechanism(uint64 remoteChainSelector, uint8 mechanism)',
  'error NoLockOrBurnMechanismSet(uint64 remoteChainSelector)',
  'error InvalidMessageVersion(bytes4 version)',
])

/** Per-getter answer: the decoded args in, the values to encode out, or a revert to throw. */
export type ProxyAnswer = (args: readonly unknown[]) => readonly unknown[]

/** A stub chain plus the getter names it was called with, in order. */
export type StubProxyChain = { chain: EVMChain; calls: string[]; probed: () => boolean }

/**
 * Builds a chain whose `typeAndVersion` reports `typeAndVersion` and whose `provider.call` decodes
 * calldata against {@link PROXY_ORACLE} and answers from `answers`. A getter with no answer fails
 * the test.
 */
export function stubProxyChain(
  answers: { [fn: string]: ProxyAnswer },
  typeAndVersion = 'USDCTokenPoolProxy 2.0.0',
): StubProxyChain {
  const calls: string[] = []
  let probed = false
  const chain = {
    typeAndVersion: () => {
      probed = true
      return Promise.resolve(parseTypeAndVersion(typeAndVersion))
    },
    provider: {
      call: async ({ data }: { data: string }) => {
        const fn = PROXY_ORACLE.getFunction(data.slice(0, 10))
        if (!fn) throw makeError(`unexpected call ${data.slice(0, 10)}`, 'UNKNOWN_ERROR')
        calls.push(fn.name)
        const answer = answers[fn.name]
        if (!answer) throw makeError(`no answer for ${fn.name}`, 'UNKNOWN_ERROR')
        const result = answer(PROXY_ORACLE.decodeFunctionData(fn, data))
        return PROXY_ORACLE.encodeFunctionResult(fn, result)
      },
    },
  } as unknown as EVMChain
  return { chain, calls, probed: () => probed }
}

/**
 * An answer that reverts with the proxy custom error `name`. Thrown as raw revert data from the
 * provider, so ethers decodes it against the SDK's ABI exactly as it would on chain.
 */
export function revertWith(name: string, args: readonly unknown[]): ProxyAnswer {
  return () => {
    throw makeError('execution reverted', 'CALL_EXCEPTION', {
      action: 'call',
      data: PROXY_ORACLE.encodeErrorResult(name, args),
      reason: null,
      transaction: { to: null, data: '0x' },
      invocation: null,
      revert: null,
    })
  }
}
