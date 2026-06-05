// Base class
export { type CCIPErrorOptions, CCIPError } from './CCIPError.ts'

// Error codes
export { CCIPErrorCode, TRANSIENT_ERROR_CODES, isTransientError } from './codes.ts'

// Specialized errors - Chain/Network
export { CCIPChainNotFoundError } from './pure.ts'
export {
  CCIPChainFamilyMismatchError,
  CCIPChainFamilyUnsupportedError,
  CCIPMethodUnsupportedError,
  CCIPNetworkFamilyUnsupportedError,
} from './specialized.ts'

// Specialized errors - Block & Transaction
export { CCIPBlockNotFoundError, CCIPTransactionNotFoundError } from './specialized.ts'

// Specialized errors - Logs
export {
  CCIPLogsAddressRequiredError,
  CCIPLogsRequiresStartError,
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
  CCIPMessageNotVerifiedYetError,
  CCIPMessageRetrievalError,
} from './specialized.ts'

// Specialized errors - Lane & Routing
export {
  CCIPLaneNotFoundError,
  CCIPLaneVersionUnsupportedError,
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
export {
  CCIPExtraArgsEncodingUnsupportedError,
  CCIPExtraArgsInvalidError,
  CCIPExtraArgsParseError,
} from './specialized.ts'

// Specialized errors - Token & Registry
export {
  CCIPLegacyTokenPoolsUnsupportedError,
  CCIPRateLimitExceededError,
  CCIPTokenDecimalsInsufficientError,
  CCIPTokenNotConfiguredError,
  CCIPTokenNotFoundError,
  CCIPTokenNotInRegistryError,
  CCIPTokenNotRegisteredError,
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
  CCIPUsdcBurnFeesError,
} from './specialized.ts'

// Specialized errors - Solana-specific
export {
  CCIPBlockTimeNotFoundError,
  CCIPCctpDecodeError,
  CCIPExecutionReportChainMismatchError,
  CCIPExecutionStateInvalidError,
  CCIPExtraArgsLengthInvalidError,
  CCIPLogDataMissingError,
  CCIPSolanaComputeUnitsExceededError,
  CCIPSolanaFeeResultInvalidError,
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
  CCIPAptosAddressModuleRequiredError,
  CCIPAptosExtraArgsV2RequiredError,
  CCIPAptosNetworkUnknownError,
  CCIPAptosRegistryTypeInvalidError,
  CCIPAptosTopicInvalidError,
  CCIPAptosTransactionInvalidError,
  CCIPAptosTransactionTypeInvalidError,
  CCIPAptosTransactionTypeUnexpectedError,
} from './specialized.ts'

// Specialized errors - Sui-specific
export { CCIPSuiMessageVersionInvalidError } from './specialized.ts'

// Specialized errors - Borsh
export { CCIPBorshMethodUnknownError, CCIPBorshTypeUnknownError } from './specialized.ts'

// Specialized errors - HTTP & Data
export {
  CCIPAbortError,
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

// Specialized errors - Finality
export { CCIPFinalityNotAllowedError } from './specialized.ts'

// Specialized errors - Address Validation
export { CCIPAddressInvalidError } from './specialized.ts'

// Specialized errors - Source Chain
export { CCIPSourceChainUnsupportedError } from './specialized.ts'

// Specialized errors - CLI & Validation
export {
  CCIPArgumentInvalidError,
  CCIPInsufficientBalanceError,
  CCIPInteractiveRequiredError,
} from './specialized.ts'

// ---------------------------------------------------------------------------
// Deprecated in v1.7 (2026-05-25) — prefer the generic equivalents above.
// These re-exports will be removed in a future major version.
// ---------------------------------------------------------------------------

/** @deprecated Deprecated in v1.7 (2026-05-25). Use {@link CCIPHasherVersionUnsupportedError} with chain='Sui'. */
export { CCIPSuiHasherVersionUnsupportedError } from './specialized.ts'

/** @deprecated Deprecated in v1.7 (2026-05-25). Use {@link CCIPHasherVersionUnsupportedError} with chain='Aptos'. */
export { CCIPAptosHasherVersionUnsupportedError } from './specialized.ts'

/** @deprecated Deprecated in v1.7 (2026-05-25). Use {@link CCIPLogDataInvalidError} with chain option. */
export { CCIPSuiLogInvalidError } from './specialized.ts'

/** @deprecated Deprecated in v1.7 (2026-05-25). Use {@link CCIPLogDataInvalidError} with chain option. */
export { CCIPAptosLogInvalidError } from './specialized.ts'

/** @deprecated Deprecated in v1.7 (2026-05-25). Use {@link CCIPWalletInvalidError} with className option. */
export { CCIPAptosWalletInvalidError } from './specialized.ts'

/** @deprecated Deprecated in v1.7 (2026-05-25). Use {@link CCIPExtraArgsEncodingUnsupportedError} with chainFamily='SVM'. */
export { CCIPSolanaExtraArgsEncodingError } from './specialized.ts'

/** @deprecated Deprecated in v1.7 (2026-05-25). Use {@link CCIPExtraArgsEncodingUnsupportedError} with chainFamily='Aptos'. */
export { CCIPAptosExtraArgsEncodingError } from './specialized.ts'

/** @deprecated Deprecated in v1.7 (2026-05-25). Use {@link CCIPLaneVersionUnsupportedError}. */
export { CCIPSolanaLaneVersionUnsupportedError } from './specialized.ts'

/** @deprecated Deprecated in v1.7 (2026-05-25). Use {@link CCIPTokenNotRegisteredError}. */
export { CCIPAptosTokenNotRegisteredError } from './specialized.ts'

// HTTP Status codes (re-exported from root)
export { HttpStatus, isServerError, isTransientHttpStatus } from '../http-status.ts'

// Recovery hints
export { DEFAULT_RECOVERY_HINTS, getDefaultRecovery } from './recovery.ts'

// Utilities
export { assert, formatErrorForLogging, getRetryDelay, shouldRetry } from './utils.ts'
