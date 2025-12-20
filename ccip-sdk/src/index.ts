export type {
  Chain,
  ChainGetter,
  ChainStatic,
  LogFilter,
  RateLimiterState,
  TokenInfo,
  TokenPoolRemote,
} from './chain.ts'
export { calculateManualExecProof, discoverOffRamp } from './execution.ts'
export {
  type EVMExtraArgsV1,
  type EVMExtraArgsV2,
  type ExtraArgs,
  type SVMExtraArgsV1,
  type SuiExtraArgsV1,
  decodeExtraArgs,
  encodeExtraArgs,
} from './extra-args.ts'
export { estimateExecGasForRequest } from './gas.ts'
export { decodeMessage, fetchRequestsForSender, sourceToDestTokenAmounts } from './requests.ts'
export {
  type AnyMessage,
  type CCIPCommit,
  type CCIPExecution,
  type CCIPMessage,
  type CCIPRequest,
  type ChainTransaction,
  type CommitReport,
  type ExecutionReceipt,
  type ExecutionReport,
  type Lane,
  type Logger,
  type NetworkInfo,
  type OffchainTokenData,
  type WithLogger,
  CCIPVersion,
  ExecutionState,
} from './types.ts'
export {
  bigIntReplacer,
  bigIntReviver,
  bytesToBuffer,
  decodeAddress,
  getDataBytes,
  isSupportedTxHash,
  networkInfo,
} from './utils.ts'

// errors
export * from './errors/index.ts'

// chains
import { AptosChain } from './aptos/index.ts'
import { EVMChain } from './evm/index.ts'
import { SolanaChain } from './solana/index.ts'
import { SuiChain } from './sui/index.ts'
import { TONChain } from './ton/index.ts'
import { ChainFamily } from './types.ts'
export { AptosChain, ChainFamily, EVMChain, SolanaChain, SuiChain, TONChain }
// use `supportedChains` to override/register derived classes, if needed
export { supportedChains } from './supported-chains.ts'
// import `allSupportedChains` to get them all registered, in tree-shaken environments
export const allSupportedChains = {
  [ChainFamily.EVM]: EVMChain,
  [ChainFamily.Solana]: SolanaChain,
  [ChainFamily.Aptos]: AptosChain,
  [ChainFamily.Sui]: SuiChain,
  [ChainFamily.TON]: TONChain,
}
