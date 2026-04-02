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
  CCIPNetworkFamilyUnsupportedError,
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
  CCIPMessageNotVerifiedYetError,
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
  CCIPSuiLogInvalidError,
  CCIPSuiMessageVersionInvalidError,
} from './specialized.ts'

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

// Specialized errors - Address Validation
export { CCIPAddressInvalidError } from './specialized.ts'

// Specialized errors - Source Chain
export { CCIPSourceChainUnsupportedError } from './specialized.ts'

// Specialized errors - CLI & Validation
export { CCIPArgumentInvalidError, CCIPInsufficientBalanceError } from './specialized.ts'

// Specialized errors - Token Deployment
export { CCIPTokenDeployFailedError, CCIPTokenDeployParamsInvalidError } from './specialized.ts'

// Specialized errors - Pool Deployment
export {
  CCIPPoolDeployFailedError,
  CCIPPoolDeployParamsInvalidError,
  CCIPPoolNotInitializedError,
} from './specialized.ts'

// Specialized errors - Propose Admin Role
export {
  CCIPProposeAdminRoleFailedError,
  CCIPProposeAdminRoleParamsInvalidError,
} from './specialized.ts'

// Specialized errors - Accept Admin Role
export { CCIPAcceptAdminRoleParamsInvalidError } from './specialized.ts'
export { CCIPAcceptAdminRoleFailedError } from './specialized.ts'

// Specialized errors - Transfer Admin Role
export {
  CCIPTransferAdminRoleFailedError,
  CCIPTransferAdminRoleParamsInvalidError,
} from './specialized.ts'

// Specialized errors - Apply Chain Updates
export {
  CCIPApplyChainUpdatesFailedError,
  CCIPApplyChainUpdatesParamsInvalidError,
} from './specialized.ts'

// Specialized errors - Append Remote Pool Addresses
export {
  CCIPAppendRemotePoolAddressesFailedError,
  CCIPAppendRemotePoolAddressesParamsInvalidError,
} from './specialized.ts'

// Specialized errors - Delete Chain Config
export {
  CCIPDeleteChainConfigFailedError,
  CCIPDeleteChainConfigParamsInvalidError,
} from './specialized.ts'

// Specialized errors - Remove Remote Pool Addresses
export {
  CCIPRemoveRemotePoolAddressesFailedError,
  CCIPRemoveRemotePoolAddressesParamsInvalidError,
} from './specialized.ts'

// Specialized errors - Set Chain Rate Limiter Config
export {
  CCIPSetRateLimiterConfigFailedError,
  CCIPSetRateLimiterConfigParamsInvalidError,
} from './specialized.ts'

// Specialized errors - Set Rate Limit Admin
export {
  CCIPSetRateLimitAdminFailedError,
  CCIPSetRateLimitAdminParamsInvalidError,
} from './specialized.ts'

// Specialized errors - Create Pool Mint Authority Multisig (Solana-only)
export {
  CCIPCreatePoolMultisigFailedError,
  CCIPCreatePoolMultisigParamsInvalidError,
} from './specialized.ts'

// Specialized errors - Transfer Mint Authority (Solana-only)
export {
  CCIPTransferMintAuthorityFailedError,
  CCIPTransferMintAuthorityParamsInvalidError,
} from './specialized.ts'

// Specialized errors - Grant Mint/Burn Access
export {
  CCIPGrantMintBurnAccessFailedError,
  CCIPGrantMintBurnAccessParamsInvalidError,
} from './specialized.ts'

// Specialized errors - Revoke Mint/Burn Access
export {
  CCIPRevokeMintBurnAccessFailedError,
  CCIPRevokeMintBurnAccessParamsInvalidError,
} from './specialized.ts'

// Specialized errors - Create Pool Token Account (Solana-only)
export {
  CCIPCreatePoolTokenAccountFailedError,
  CCIPCreatePoolTokenAccountParamsInvalidError,
} from './specialized.ts'

// Specialized errors - Create Token Address Lookup Table (Solana-only)
export {
  CCIPCreateTokenAltFailedError,
  CCIPCreateTokenAltParamsInvalidError,
} from './specialized.ts'

// Specialized errors - Set Pool
export { CCIPSetPoolFailedError, CCIPSetPoolParamsInvalidError } from './specialized.ts'

// Specialized errors - Transfer Ownership
export {
  CCIPTransferOwnershipFailedError,
  CCIPTransferOwnershipParamsInvalidError,
} from './specialized.ts'

// Specialized errors - Accept Ownership
export {
  CCIPAcceptOwnershipFailedError,
  CCIPAcceptOwnershipParamsInvalidError,
} from './specialized.ts'

// Specialized errors - Execute Ownership Transfer (Aptos 3rd step)
export {
  CCIPExecuteOwnershipTransferFailedError,
  CCIPExecuteOwnershipTransferParamsInvalidError,
} from './specialized.ts'

// HTTP Status codes (re-exported from root)
export { HttpStatus, isServerError, isTransientHttpStatus } from '../http-status.ts'

// Recovery hints
export { DEFAULT_RECOVERY_HINTS, getDefaultRecovery } from './recovery.ts'

// Utilities
export { assert, formatErrorForLogging, getRetryDelay, shouldRetry } from './utils.ts'
