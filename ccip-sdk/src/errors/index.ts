// Base class
export { type CCIPErrorOptions, CCIPError } from './CCIPError.ts'

// Error codes
export { CCIPErrorCode, TRANSIENT_ERROR_CODES, isTransientError } from './codes.ts'

// Specialized errors - Chain/Network
export {
  CCIPChainFamilyMismatchError,
  CCIPChainFamilyUnsupportedError,
  CCIPChainNotFoundError,
  CCIPMethodUnsupportedError,
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
  CCIPMessageIdValidationError,
  CCIPMessageInvalidError,
  CCIPMessageNotFoundInTxError,
  CCIPMessageNotInBatchError,
  CCIPMessageRetrievalError,
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
  CCIPOnchainCommitRequiredError,
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
  CCIPTokenAccountNotFoundError,
  CCIPTokenAmountInvalidError,
  CCIPTokenDataParseError,
  CCIPTokenMintInvalidError,
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
  CCIPAptosTransactionInvalidError,
  CCIPAptosTransactionTypeInvalidError,
  CCIPAptosTransactionTypeUnexpectedError,
  CCIPAptosWalletInvalidError,
} from './specialized.ts'

// Specialized errors - Sui-specific
export {
  CCIPSuiHasherVersionUnsupportedError,
  CCIPSuiLogInvalidError,
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
  CCIPNotImplementedError,
  CCIPRpcNotFoundError,
  CCIPTimeoutError,
  CCIPTypeVersionInvalidError,
} from './specialized.ts'

// Specialized errors - API Client
export { CCIPApiClientNotAvailableError, CCIPUnexpectedPaginationError } from './specialized.ts'

// Specialized errors - Viem Adapter
export { CCIPViemAdapterError } from './specialized.ts'

// Specialized errors - Address Validation
export { CCIPAddressInvalidEvmError } from './specialized.ts'

// Specialized errors - Source Chain
export { CCIPSourceChainUnsupportedError } from './specialized.ts'

// Specialized errors - CLI & Validation
export { CCIPArgumentInvalidError, CCIPInsufficientBalanceError } from './specialized.ts'

// HTTP Status codes (re-exported from root)
export { HttpStatus, isServerError, isTransientHttpStatus } from '../http-status.ts'

// Recovery hints
export { DEFAULT_RECOVERY_HINTS, getDefaultRecovery } from './recovery.ts'

// Utilities
export { assert, formatErrorForLogging, getRetryDelay, shouldRetry } from './utils.ts'
