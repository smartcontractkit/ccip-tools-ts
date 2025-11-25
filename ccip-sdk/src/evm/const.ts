import { type EventFragment, AbiCoder, Interface } from 'ethers'

import Token_ABI from './abi/BurnMintERC677Token.ts'
import CommitStore_1_2_ABI from './abi/CommitStore_1_2.ts'
import CommitStore_1_5_ABI from './abi/CommitStore_1_5.ts'
import FeeQuoter_ABI from './abi/FeeQuoter_1_6.ts'
import TokenPool_1_5_ABI from './abi/LockReleaseTokenPool_1_5.ts'
import TokenPool_1_5_1_ABI from './abi/LockReleaseTokenPool_1_5_1.ts'
import TokenPool_1_6_ABI from './abi/LockReleaseTokenPool_1_6_1.ts'
import EVM2EVMOffRamp_1_2_ABI from './abi/OffRamp_1_2.ts'
import EVM2EVMOffRamp_1_5_ABI from './abi/OffRamp_1_5.ts'
import OffRamp_1_6_ABI from './abi/OffRamp_1_6.ts'
import EVM2EVMOnRamp_1_2_ABI from './abi/OnRamp_1_2.ts'
import EVM2EVMOnRamp_1_5_ABI from './abi/OnRamp_1_5.ts'
import OnRamp_1_6_ABI from './abi/OnRamp_1_6.ts'
import Router_ABI from './abi/Router.ts'
import TokenAdminRegistry_ABI from './abi/TokenAdminRegistry_1_5.ts'

export const defaultAbiCoder = AbiCoder.defaultAbiCoder()

export const DEFAULT_GAS_LIMIT = 200_000n
export const DEFAULT_APPROVE_GAS_LIMIT = 120_000n

const customErrors = [
  'error NoContract()',
  'error NoGasForCallExactCheck()',
  'error NotEnoughGasForCall()',
] as const

export const interfaces = {
  Router: new Interface(Router_ABI),
  Token: new Interface(Token_ABI),
  TokenAdminRegistry: new Interface(TokenAdminRegistry_ABI),
  FeeQuoter: new Interface(FeeQuoter_ABI),
  TokenPool_v1_5_1: new Interface(TokenPool_1_5_1_ABI),
  TokenPool_v1_5: new Interface(TokenPool_1_5_ABI),
  TokenPool_v1_6: new Interface(TokenPool_1_6_ABI),
  CommitStore_v1_5: new Interface(CommitStore_1_5_ABI),
  CommitStore_v1_2: new Interface(CommitStore_1_2_ABI),
  OffRamp_v1_6: new Interface(OffRamp_1_6_ABI),
  EVM2EVMOffRamp_v1_5: new Interface(EVM2EVMOffRamp_1_5_ABI),
  EVM2EVMOffRamp_v1_2: new Interface(EVM2EVMOffRamp_1_2_ABI),
  OnRamp_v1_6: new Interface(OnRamp_1_6_ABI),
  EVM2EVMOnRamp_v1_5: new Interface(EVM2EVMOnRamp_1_5_ABI),
  EVM2EVMOnRamp_v1_2: new Interface(EVM2EVMOnRamp_1_2_ABI),
  Custom: new Interface(customErrors),
} as const

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
