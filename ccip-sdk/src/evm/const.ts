import { parseAbi } from 'abitype'
import {
  type InterfaceAbi,
  AbiCoder,
  EventFragment,
  Fragment,
  Interface,
  isHexString,
} from 'ethers'

import Token_ABI from './abi/BurnMintERC677Token.ts'
import CCIPReceiver_2_0_ABI from './abi/CCIPReceiver_2_0.ts'
import CCTPVerifier_2_0_ABI from './abi/CCTPVerifier_2_0.ts'
import CommitStore_1_2_ABI from './abi/CommitStore_1_2.ts'
import CommitStore_1_5_ABI from './abi/CommitStore_1_5.ts'
import FeeQuoter_1_6_ABI from './abi/FeeQuoter_1_6.ts'
import FeeQuoter_2_0_ABI from './abi/FeeQuoter_2_0.ts'
import TokenPool_1_5_ABI from './abi/LockReleaseTokenPool_1_5.ts'
import TokenPool_1_5_1_ABI from './abi/LockReleaseTokenPool_1_5_1.ts'
import TokenPool_1_6_ABI from './abi/LockReleaseTokenPool_1_6_1.ts'
import EVM2EVMOffRamp_1_2_ABI from './abi/OffRamp_1_2.ts'
import EVM2EVMOffRamp_1_5_ABI from './abi/OffRamp_1_5.ts'
import OffRamp_1_6_ABI from './abi/OffRamp_1_6.ts'
import OffRamp_2_0_ABI from './abi/OffRamp_2_0.ts'
import EVM2EVMOnRamp_1_2_ABI from './abi/OnRamp_1_2.ts'
import EVM2EVMOnRamp_1_5_ABI from './abi/OnRamp_1_5.ts'
import OnRamp_1_6_ABI from './abi/OnRamp_1_6.ts'
import OnRamp_2_0_ABI from './abi/OnRamp_2_0.ts'
import PriceRegistry_1_2_ABI from './abi/PriceRegistry_1_2.ts'
import RMNProxy_ABI from './abi/RMNProxy.ts'
import Router_ABI from './abi/Router.ts'
import TokenAdminRegistry_ABI from './abi/TokenAdminRegistry_1_5.ts'
import TokenPool_2_0_ABI from './abi/TokenPool_2_0.ts'
import USDCTokenPoolProxy_2_0_ABI from './abi/USDCTokenPoolProxy_2_0.ts'
import VersionedVerifierResolver_2_0_ABI from './abi/VersionedVerifierResolver_2_0.ts'
import * as poolErrorAbis from './abi/pool-errors.ts'

export const defaultAbiCoder = AbiCoder.defaultAbiCoder()

const customErrors = [
  'error NoContract()',
  'error NoGasForCallExactCheck()',
  'error NotEnoughGasForCall()',
  'error NotEnoughGas()',
  'error InvalidChain(uint64 chainSelector)',
  'error InvalidAdapter()',
  'error BlacklistableBlacklistedAccount(address)',
  'error WrongAsset(address expected, address received)',
  'error FailedInnerCall()',
  'error SenderNotAllowed(uint64 sourceChainSelector, bytes sender)',
  'error ERC20InsufficientBalance(address from, uint256 fromBalance, uint256 value)',
  // external pool-adjacent errors the destination preflight classifies as transient:
  // oUSDT lockbox shortfall, xERC20 bridge rate limits
  'error InsufficientLockboxBalance(uint256 lockboxBalance, uint256 localAmount)',
  'error NotHighEnoughLimits()',
  'error IXERC20_NotHighEnoughLimits()',
] as const

export const VersionedContractABI = parseAbi(['function typeAndVersion() view returns (string)'])
export const TokenPoolAndProxyABI = parseAbi(['function getPreviousPool() view returns (address)'])

export const interfaces = {
  Router: new Interface(Router_ABI),
  Token: new Interface(Token_ABI),
  TokenAdminRegistry: new Interface(TokenAdminRegistry_ABI),
  RMNProxy: new Interface(RMNProxy_ABI),
  FeeQuoter_v1_6: new Interface(FeeQuoter_1_6_ABI),
  FeeQuoter_v2_0: new Interface(FeeQuoter_2_0_ABI),
  TokenPool_v2_0: new Interface(TokenPool_2_0_ABI),
  TokenPool_v1_6: new Interface(TokenPool_1_6_ABI),
  TokenPool_v1_5_1: new Interface(TokenPool_1_5_1_ABI),
  TokenPool_v1_5: new Interface(TokenPool_1_5_ABI),
  TokenPoolAndProxy: new Interface(TokenPoolAndProxyABI),
  CommitStore_v1_5: new Interface(CommitStore_1_5_ABI),
  CommitStore_v1_2: new Interface(CommitStore_1_2_ABI),
  Receiver_v2_0: new Interface(CCIPReceiver_2_0_ABI),
  OffRamp_v2_0: new Interface(OffRamp_2_0_ABI),
  OffRamp_v1_6: new Interface(OffRamp_1_6_ABI),
  EVM2EVMOffRamp_v1_5: new Interface(EVM2EVMOffRamp_1_5_ABI),
  EVM2EVMOffRamp_v1_2: new Interface(EVM2EVMOffRamp_1_2_ABI),
  OnRamp_v2_0: new Interface(OnRamp_2_0_ABI),
  OnRamp_v1_6: new Interface(OnRamp_1_6_ABI),
  EVM2EVMOnRamp_v1_5: new Interface(EVM2EVMOnRamp_1_5_ABI),
  EVM2EVMOnRamp_v1_2: new Interface(EVM2EVMOnRamp_1_2_ABI),
  PriceRegistry_v1_2: new Interface(PriceRegistry_1_2_ABI),
  USDCTokenPoolProxy_v2_0: new Interface(USDCTokenPoolProxy_2_0_ABI),
  CCTPVerifier_v2_0: new Interface(CCTPVerifier_2_0_ABI),
  VersionedVerifierResolver_v2_0: new Interface(VersionedVerifierResolver_2_0_ABI),
  Custom: new Interface(customErrors),
} as const

/**
 * Gets all event fragments matching the given event names, signatures, or topic hashes.
 *
 * Supports the same keys as `Interface.getEvent` — bare names, full signatures, and
 * topic hashes — but where `getEvent` throws on an ambiguous bare name (e.g.
 * `ConfigSet` exists in many ABIs with different signatures), collects every matching
 * signature instead.
 * @param events - Event names, signatures, or topic hashes to match.
 * @returns Map of topic hash to event fragment.
 */
export function getAllFragmentsMatchingEvents(
  events: readonly string[],
): Record<`0x${string}`, EventFragment> {
  const fragments: Record<string, EventFragment> = {}
  for (const key of events) {
    for (const iface of Object.values(interfaces)) {
      for (const fragment of iface.fragments) {
        if (!Fragment.isEvent(fragment)) continue
        if (matchesEventKey(fragment, key)) fragments[fragment.topicHash] ??= fragment
      }
    }
  }
  return fragments
}

/** Whether an event fragment matches an `Interface.getEvent` key: a topic hash, bare
 * name, or signature. */
function matchesEventKey(fragment: EventFragment, key: string): boolean {
  if (isHexString(key)) return fragment.topicHash === key.toLowerCase()
  if (!key.includes('(')) return fragment.name === key
  // Full signature: parse and compare canonical (sighash) format, like `getEvent`.
  return fragment.format() === EventFragment.from(key).format()
}

export const requestsFragments = getAllFragmentsMatchingEvents([
  'CCIPSendRequested',
  'CCIPMessageSent',
])
export const commitsFragments = getAllFragmentsMatchingEvents([
  'ReportAccepted',
  'CommitReportAccepted',
])
export const receiptsFragments = getAllFragmentsMatchingEvents(['ExecutionStateChanged'])

/**
 * Error-only Interfaces of the specialized pool/token contracts (USDC/CCTP, Lombard, siloed,
 * fast-transfer, hooks…), consulted by `parseWithFragment` only after the main {@link interfaces}
 * scan misses — they add revert-decoding coverage without eagerly bundling the full ABIs.
 * Built lazily on first use.
 */
export function getPoolErrorInterfaces(): Readonly<Record<string, Interface>> {
  return (poolErrorInterfaces ??= Object.fromEntries(
    Object.entries(poolErrorAbis).map(([name, abi]) => [
      name.replace(/_errors$/, ''),
      new Interface(abi as InterfaceAbi),
    ]),
  ))
}
let poolErrorInterfaces: Record<string, Interface> | undefined
