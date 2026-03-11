/**
 * \@chainlink/ccip-sdk - SDK for interacting with Chainlink CCIP (Cross-Chain Interoperability Protocol).
 *
 * This package provides tools for sending cross-chain messages, tracking message status,
 * and executing manual message delivery across supported blockchain networks.
 *
 * @packageDocumentation
 */

export type {
  APICCIPRequestMetadata,
  APIErrorResponse,
  CCIPAPIClientContext,
  LaneLatencyResponse,
  MessageSearchFilters,
  MessageSearchPage,
  MessageSearchResult,
} from './api/index.ts'
export {
  CCIPAPIClient,
  DEFAULT_API_BASE_URL,
  SDK_VERSION,
  SDK_VERSION_HEADER,
} from './api/index.ts'

export type {
  ApiRetryConfig,
  Chain,
  ChainContext,
  ChainGetter,
  ChainStatic,
  GetBalanceOpts,
  LaneFeatures,
  LogFilter,
  RateLimiterState,
  RegistryTokenConfig,
  TokenInfo,
  TokenPoolConfig,
  TokenPoolRemote,
} from './chain.ts'
export { DEFAULT_API_RETRY_CONFIG, LaneFeature } from './chain.ts'
export { calculateManualExecProof, discoverOffRamp } from './execution.ts'
export {
  type EVMExtraArgsV1,
  type EVMExtraArgsV2,
  type ExtraArgs,
  type GenericExtraArgsV3,
  type SVMExtraArgsV1,
  type SuiExtraArgsV1,
  decodeExtraArgs,
  encodeExtraArgs,
} from './extra-args.ts'
export { estimateReceiveExecution } from './gas.ts'
export { getOffchainTokenData } from './offchain.ts'
export { decodeMessage, getMessagesForSender, sourceToDestTokenAddresses } from './requests.ts'
export {
  type CCIPExecution,
  type CCIPMessage,
  type CCIPRequest,
  type CCIPVerifications,
  type ChainLog,
  type ChainTransaction,
  type CommitReport,
  type ExecutionInput,
  type ExecutionReceipt,
  type Lane,
  type Logger,
  type MessageInput,
  type NetworkInfo,
  type OffchainTokenData,
  type WithLogger,
  CCIPVersion,
  ExecutionState,
  IntentStatus,
  MessageStatus,
} from './types.ts'
export type { WithRetryConfig } from './utils.ts'
export {
  bigIntReplacer,
  bigIntReviver,
  bytesToBuffer,
  decodeAddress,
  getDataBytes,
  isSupportedTxHash,
  networkInfo,
  withRetry,
} from './utils.ts'
export {
  type CCIPExplorerLinks,
  type ExplorerLinkType,
  CCIP_EXPLORER_BASE_URL,
  getCCIPExplorerLinks,
  getCCIPExplorerUrl,
} from './explorer.ts'

// errors
export * from './errors/index.ts'

// token-admin shared types
export type {
  AcceptOwnershipParams,
  AppendRemotePoolAddressesParams,
  AppendRemotePoolAddressesResult,
  ApplyChainUpdatesParams,
  ChainRateLimiterConfig,
  DeleteChainConfigParams,
  DeleteChainConfigResult,
  ExecuteOwnershipTransferParams,
  GrantMintBurnAccessParams,
  MintBurnRole,
  OwnershipResult,
  RateLimiterConfig,
  RemoteChainConfig,
  RemoveRemotePoolAddressesParams,
  RemoveRemotePoolAddressesResult,
  RevokeMintBurnAccessParams,
  RevokeMintBurnAccessResult,
  SetChainRateLimiterConfigParams,
  SetRateLimitAdminParams,
  TransferOwnershipParams,
} from './token-admin/types.ts'

// chains
import { AptosChain } from './aptos/index.ts'
export type { UnsignedAptosTx } from './aptos/index.ts'
import { EVMChain } from './evm/index.ts'
export type { UnsignedEVMTx } from './evm/index.ts'
import { SolanaChain } from './solana/index.ts'
export type { UnsignedSolanaTx } from './solana/index.ts'
import { SuiChain } from './sui/index.ts'
export type { UnsignedSuiTx } from './sui/index.ts'
import { TONChain } from './ton/index.ts'
export type { UnsignedTONTx } from './ton/index.ts'
import { ChainFamily, NetworkType } from './types.ts'
export { AptosChain, ChainFamily, EVMChain, NetworkType, SolanaChain, SuiChain, TONChain }
// use `supportedChains` to override/register derived classes, if needed
export { supportedChains } from './supported-chains.ts'
