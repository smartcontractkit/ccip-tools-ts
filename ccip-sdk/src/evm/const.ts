import { parseAbi } from 'abitype'
import { type EventFragment, AbiCoder, Interface } from 'ethers'

import AdvancedPoolHooks_2_0_ABI from './abi/AdvancedPoolHooks_2_0.ts'
import Token_ABI from './abi/BurnMintERC677Token.ts'
import BurnWithFromMintRebasingTokenPool_1_5_0_ABI from './abi/BurnWithFromMintRebasingTokenPool_1_5_0.ts'
import CCIPReceiver_2_0_ABI from './abi/CCIPReceiver_2_0.ts'
import CCTPThroughCCVTokenPool_2_0_ABI from './abi/CCTPThroughCCVTokenPool_2_0.ts'
import CCTPVerifier_2_0_ABI from './abi/CCTPVerifier_2_0.ts'
import CommitStore_1_2_ABI from './abi/CommitStore_1_2.ts'
import CommitStore_1_5_ABI from './abi/CommitStore_1_5.ts'
import CrossChainPoolToken_2_0_ABI from './abi/CrossChainPoolToken_2_0.ts'
import CrossChainToken_2_0_ABI from './abi/CrossChainToken_2_0.ts'
import ERC20LockBox_2_0_ABI from './abi/ERC20LockBox_2_0.ts'
import FactoryBurnMintERC20_1_5_1_ABI from './abi/FactoryBurnMintERC20_1_5_1.ts'
import FastTransferTokenPool_1_6_0_ABI from './abi/FastTransferTokenPool_1_6_0.ts'
import FeeQuoter_1_6_ABI from './abi/FeeQuoter_1_6.ts'
import FeeQuoter_2_0_ABI from './abi/FeeQuoter_2_0.ts'
import TokenPool_1_5_ABI from './abi/LockReleaseTokenPool_1_5.ts'
import TokenPool_1_5_1_ABI from './abi/LockReleaseTokenPool_1_5_1.ts'
import TokenPool_1_6_ABI from './abi/LockReleaseTokenPool_1_6_1.ts'
import LombardTokenPool_2_0_ABI from './abi/LombardTokenPool_2_0.ts'
import EVM2EVMOffRamp_1_2_ABI from './abi/OffRamp_1_2.ts'
import EVM2EVMOffRamp_1_5_ABI from './abi/OffRamp_1_5.ts'
import OffRamp_1_6_ABI from './abi/OffRamp_1_6.ts'
import OffRamp_2_0_ABI from './abi/OffRamp_2_0.ts'
import EVM2EVMOnRamp_1_2_ABI from './abi/OnRamp_1_2.ts'
import EVM2EVMOnRamp_1_5_ABI from './abi/OnRamp_1_5.ts'
import OnRamp_1_6_ABI from './abi/OnRamp_1_6.ts'
import OnRamp_2_0_ABI from './abi/OnRamp_2_0.ts'
import PriceRegistry_1_2_ABI from './abi/PriceRegistry_1_2.ts'
import Router_ABI from './abi/Router.ts'
import SiloedLockReleaseTokenPool_1_6_0_ABI from './abi/SiloedLockReleaseTokenPool_1_6_0.ts'
import SiloedLockReleaseTokenPool_2_0_ABI from './abi/SiloedLockReleaseTokenPool_2_0.ts'
import SiloedUSDCTokenPool_2_0_ABI from './abi/SiloedUSDCTokenPool_2_0.ts'
import TokenAdminRegistry_ABI from './abi/TokenAdminRegistry_1_5.ts'
import TokenPool_2_0_ABI from './abi/TokenPool_2_0.ts'
import USDCTokenPoolProxy_2_0_ABI from './abi/USDCTokenPoolProxy_2_0.ts'
import USDCTokenPool_1_5_1_ABI from './abi/USDCTokenPool_1_5_1.ts'
import VersionedVerifierResolver_2_0_ABI from './abi/VersionedVerifierResolver_2_0.ts'

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
] as const

export const VersionedContractABI = parseAbi(['function typeAndVersion() view returns (string)'])
export const TokenPoolAndProxyABI = parseAbi(['function getPreviousPool() view returns (address)'])

export const interfaces = {
  Router: new Interface(Router_ABI),
  Token: new Interface(Token_ABI),
  TokenAdminRegistry: new Interface(TokenAdminRegistry_ABI),
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
  // pool/token contracts added for error parsing; kept last (before Custom) so they only add
  // coverage for otherwise-unresolved selectors and never shadow an earlier match
  SiloedLockReleaseTokenPool_v2_0: new Interface(SiloedLockReleaseTokenPool_2_0_ABI),
  SiloedUSDCTokenPool_v2_0: new Interface(SiloedUSDCTokenPool_2_0_ABI),
  ERC20LockBox_v2_0: new Interface(ERC20LockBox_2_0_ABI),
  CrossChainToken_v2_0: new Interface(CrossChainToken_2_0_ABI),
  CrossChainPoolToken_v2_0: new Interface(CrossChainPoolToken_2_0_ABI),
  FactoryBurnMintERC20_v1_5_1: new Interface(FactoryBurnMintERC20_1_5_1_ABI),
  FastTransferTokenPool_v1_6_0: new Interface(FastTransferTokenPool_1_6_0_ABI),
  LombardTokenPool_v2_0: new Interface(LombardTokenPool_2_0_ABI),
  USDCTokenPool_v1_5_1: new Interface(USDCTokenPool_1_5_1_ABI),
  SiloedLockReleaseTokenPool_v1_6_0: new Interface(SiloedLockReleaseTokenPool_1_6_0_ABI),
  AdvancedPoolHooks_v2_0: new Interface(AdvancedPoolHooks_2_0_ABI),
  CCTPThroughCCVTokenPool_v2_0: new Interface(CCTPThroughCCVTokenPool_2_0_ABI),
  BurnWithFromMintRebasingTokenPool_v1_5_0: new Interface(
    BurnWithFromMintRebasingTokenPool_1_5_0_ABI,
  ),
  Custom: new Interface(customErrors),
} as const

/**
 * Gets all event fragments matching the given event names.
 * @param events - Event names to match.
 * @returns Map of topic hash to event fragment.
 */
export function getAllFragmentsMatchingEvents(
  events: readonly string[],
): Record<`0x${string}`, EventFragment> {
  const fragments: Record<string, EventFragment> = {}
  for (const iface of Object.values(interfaces)) {
    for (const event of events) {
      const fragment = iface.getEvent(event)
      if (fragment) fragments[fragment.topicHash] ??= fragment
    }
  }
  return fragments
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
