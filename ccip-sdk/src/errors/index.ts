// Base class
export { type CCIPErrorOptions, CCIPError } from './CCIPError.ts'

// Error codes
export { CCIPErrorCode, TRANSIENT_ERROR_CODES, isTransientError } from './codes.ts'

// Specialized errors - Chain/Network
export {
  CCIPChainFamilyMismatchError,
  CCIPChainFamilyUnsupportedError,
  CCIPChainNotFoundError,
} from './specialized.ts'

// Specialized errors - Block & Transaction
export { CCIPBlockNotFoundError, CCIPTransactionNotFoundError } from './specialized.ts'

// Specialized errors - Logs
export {
  CCIPLogsAddressRequiredError,
  CCIPLogsWatchRequiresFinalityError,
  CCIPLogsWatchRequiresStartError,
} from './specialized.ts'

// Specialized errors - CCIP Message
export {
  CCIPMessageBatchIncompleteError,
  CCIPMessageIdNotFoundError,
  CCIPMessageInvalidError,
  CCIPMessageNotFoundInTxError,
  CCIPMessageNotInBatchError,
} from './specialized.ts'

// Specialized errors - Lane & Routing
export {
  CCIPLaneNotFoundError,
  CCIPOffRampNotFoundError,
  CCIPOnRampRequiredError,
} from './specialized.ts'

// Specialized errors - Commit & Merkle
export {
  CCIPCommitNotFoundError,
  CCIPMerkleFlagsMismatchError,
  CCIPMerkleHashesTooLargeError,
  CCIPMerkleInternalError,
  CCIPMerkleProofEmptyError,
  CCIPMerkleProofFlagsMismatchError,
  CCIPMerkleProofIncompleteError,
  CCIPMerkleProofTooLargeError,
  CCIPMerkleRootMismatchError,
  CCIPMerkleTreeEmptyError,
} from './specialized.ts'

// Specialized errors - Version
export {
  CCIPHasherVersionUnsupportedError,
  CCIPVersionFeatureUnavailableError,
  CCIPVersionRequiresLaneError,
  CCIPVersionUnsupportedError,
} from './specialized.ts'

// Specialized errors - ExtraArgs
export { CCIPExtraArgsInvalidError, CCIPExtraArgsParseError } from './specialized.ts'

// Specialized errors - Token & Registry
export {
  CCIPLegacyTokenPoolsUnsupportedError,
  CCIPTokenDecimalsInsufficientError,
  CCIPTokenNotConfiguredError,
  CCIPTokenNotFoundError,
  CCIPTokenNotInRegistryError,
} from './specialized.ts'

// Specialized errors - Contract Type
export { CCIPContractNotRouterError, CCIPContractTypeInvalidError } from './specialized.ts'

// Specialized errors - Wallet & Signer
export { CCIPWalletInvalidError, CCIPWalletNotSignerError } from './specialized.ts'

// Specialized errors - Execution
export {
  CCIPExecTxNotConfirmedError,
  CCIPExecTxRevertedError,
  CCIPReceiptNotFoundError,
} from './specialized.ts'

// Specialized errors - Attestation (USDC/LBTC)
export {
  CCIPLbtcAttestationError,
  CCIPLbtcAttestationNotApprovedError,
  CCIPLbtcAttestationNotFoundError,
  CCIPUsdcAttestationError,
} from './specialized.ts'

// Specialized errors - Solana-specific
export {
  CCIPBlockTimeNotFoundError,
  CCIPCctpDecodeError,
  CCIPCctpMultipleEventsError,
  CCIPExecutionReportChainMismatchError,
  CCIPExecutionStateInvalidError,
  CCIPExtraArgsLengthInvalidError,
  CCIPLogDataMissingError,
  CCIPSolanaComputeUnitsExceededError,
  CCIPSolanaExtraArgsEncodingError,
  CCIPSolanaFeeResultInvalidError,
  CCIPSolanaLaneVersionUnsupportedError,
  CCIPSolanaLookupTableNotFoundError,
  CCIPSolanaOffRampEventsNotFoundError,
  CCIPSolanaRefAddressesNotFoundError,
  CCIPSolanaRouterConfigNotFoundError,
  CCIPSplTokenInvalidError,
  CCIPTokenAmountInvalidError,
  CCIPTokenDataParseError,
  CCIPTokenMintNotFoundError,
  CCIPTokenPoolChainConfigNotFoundError,
  CCIPTokenPoolInfoNotFoundError,
  CCIPTokenPoolStateNotFoundError,
  CCIPTopicsInvalidError,
  CCIPTransactionNotFinalizedError,
} from './specialized.ts'

// Specialized errors - Aptos-specific
export {
  CCIPAptosAddressInvalidError,
  CCIPAptosAddressModuleRequiredError,
  CCIPAptosExtraArgsEncodingError,
  CCIPAptosExtraArgsV2RequiredError,
  CCIPAptosHasherVersionUnsupportedError,
  CCIPAptosLogInvalidError,
  CCIPAptosNetworkUnknownError,
  CCIPAptosRegistryTypeInvalidError,
  CCIPAptosTokenNotRegisteredError,
  CCIPAptosTopicInvalidError,
  CCIPAptosTransactionInvalidError,
  CCIPAptosTransactionTypeInvalidError,
  CCIPAptosTransactionTypeUnexpectedError,
  CCIPAptosWalletInvalidError,
} from './specialized.ts'

// Specialized errors - Sui-specific
export {
  CCIPSuiHasherVersionUnsupportedError,
  CCIPSuiMessageVersionInvalidError,
} from './specialized.ts'

// Specialized errors - Borsh
export { CCIPBorshMethodUnknownError, CCIPBorshTypeUnknownError } from './specialized.ts'

// Specialized errors - HTTP & Data
export {
  CCIPBlockBeforeTimestampNotFoundError,
  CCIPDataFormatUnsupportedError,
  CCIPDataParseError,
  CCIPHttpError,
  CCIPLogDataInvalidError,
  CCIPLogTopicsNotFoundError,
  CCIPLogsNotFoundError,
  CCIPMessageDecodeError,
  CCIPNetworkFamilyUnsupportedError,
  CCIPNotImplementedError,
  CCIPRpcNotFoundError,
  CCIPTypeVersionInvalidError,
} from './specialized.ts'

// Specialized errors - API Client
export { CCIPApiClientNotAvailableError } from './specialized.ts'

// Specialized errors - Viem Adapter
export { CCIPViemAdapterError } from './specialized.ts'

// Specialized errors - Address Validation
export { CCIPAddressInvalidEvmError } from './specialized.ts'

// Specialized errors - Source Chain
export { CCIPSourceChainUnsupportedError } from './specialized.ts'

// Specialized errors - CLI & Validation
export { CCIPArgumentInvalidError } from './specialized.ts'

// HTTP Status codes (re-exported from root)
export { HttpStatus, isServerError, isTransientHttpStatus } from '../http-status.ts'

// Recovery hints
export { DEFAULT_RECOVERY_HINTS, getDefaultRecovery } from './recovery.ts'

// Utilities
export { assert, formatErrorForLogging, getRetryDelay, shouldRetry } from './utils.ts'
