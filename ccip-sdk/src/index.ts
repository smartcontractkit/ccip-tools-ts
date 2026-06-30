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
  CantonConfig,
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
  TokenPrice,
  TokenTransferFee,
  TokenTransferFeeConfig,
  TokenTransferFeeOpts,
  TotalFeesEstimate,
} from './chain.ts'
export { DEFAULT_API_RETRY_CONFIG, LaneFeature } from './chain.ts'
export { calculateManualExecProof, discoverOffRamp } from './execution.ts'
export { type FetchVerificationsOpts, fetchVerifications } from './commits.ts'
export {
  type EVMExtraArgsV1,
  type EVMExtraArgsV2,
  type ExtraArgs,
  type FinalityAllowed,
  type FinalityRequested,
  type GenericExtraArgsV3,
  type SVMExtraArgsV1,
  type SuiExtraArgsV1,
  decodeExtraArgs,
  decodeFinalityAllowed,
  decodeFinalityRequested,
  encodeExtraArgs,
  encodeFinality,
} from './extra-args.ts'
export { estimateReceiveExecution, sourceToDestTokenAddresses } from './gas.ts'
export { CCTP_FINALITY_FAST, CCTP_FINALITY_STANDARD, getOffchainTokenData } from './offchain.ts'
export { decodeMessage, getMessagesInRange } from './requests.ts'
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
  signalToPromise,
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
  DeployVerificationTarget,
  EVMFactoryDeployPoolParams,
  EVMFactoryDeployTokenAndPoolParams,
  ExecuteOwnershipTransferParams,
  FactoryDeployPoolResult,
  FactoryDeployTokenAndPoolResult,
  GrantMintBurnAccessParams,
  MintBurnRole,
  OwnershipResult,
  ProvideLiquidityParams,
  ProvideLiquidityResult,
  RateLimiterConfig,
  RemoteChainConfig,
  RemoveRemotePoolAddressesParams,
  RemoveRemotePoolAddressesResult,
  RevokeMintBurnAccessParams,
  RevokeMintBurnAccessResult,
  SetAllowedFinalityConfigParams,
  SetAllowedFinalityConfigResult,
  SetChainRateLimiterConfigParams,
  SetFeeAdminParams,
  SetFeeAdminResult,
  SetRateLimitAdminParams,
  SetTokenTransferFeeConfigParams,
  SetTokenTransferFeeConfigResult,
  TokenTransferFeeConfigUpdate,
  TransferOwnershipParams,
} from './token-admin/types.ts'

// chains
import { AptosChain } from './aptos/index.ts'
export type { UnsignedAptosTx } from './aptos/index.ts'
import { CantonChain } from './canton/index.ts'
import { EVMChain } from './evm/index.ts'
export { type NetworkInfo, ChainFamily, NetworkType, networkInfo } from './networks.ts'
import SELECTORS from './selectors.ts'
export { SELECTORS }
export type { UnsignedEVMTx } from './evm/index.ts'
import { SolanaChain } from './solana/index.ts'
export type { UnsignedSolanaTx } from './solana/index.ts'
import { SuiChain } from './sui/index.ts'
export type { UnsignedSuiTx } from './sui/index.ts'
import { TONChain } from './ton/index.ts'
export type { UnsignedTONTx } from './ton/index.ts'
export type {
  CantonWallet,
  PartySignatures,
  TransactionSigner,
  UnsignedCantonTx,
} from './canton/index.ts'
export { AptosChain, CantonChain, EVMChain, SolanaChain, SuiChain, TONChain }
// use `supportedChains` to override/register derived classes, if needed
export { supportedChains } from './supported-chains.ts'
