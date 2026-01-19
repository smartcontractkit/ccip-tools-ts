import type { CCIPErrorCode } from './codes.ts'

/** Recovery hints by error code. */
export const DEFAULT_RECOVERY_HINTS: Partial<Record<CCIPErrorCode, string>> = {
  CHAIN_NOT_FOUND:
    'Verify the chainId, chain selector, or chain name is correct. Check CCIP documentation for supported chains.',
  CHAIN_SELECTOR_NOT_FOUND:
    'Verify the chain selector is valid. Use networkInfo() to look up selectors.',
  CHAIN_FAMILY_UNSUPPORTED: 'Supported families: EVM, Solana, Aptos, Sui, TON.',
  CHAIN_FAMILY_MISMATCH:
    'Use the correct Chain class for this chain family (e.g., EVMChain for EVM, SolanaChain for Solana).',
  NETWORK_FAMILY_UNSUPPORTED:
    'This operation only supports specific chain families. Check the method documentation for supported chain families.',
  APTOS_NETWORK_UNKNOWN: 'Provide a valid Aptos RPC URL (mainnet or testnet).',

  BLOCK_NOT_FOUND: 'Wait for the block to be finalized and retry.',
  TRANSACTION_NOT_FOUND: 'Verify the transaction hash. The transaction may still be pending.',
  BLOCK_TIME_NOT_FOUND: 'Wait and retry. Block time data may not be available yet.',
  BLOCK_BEFORE_TIMESTAMP_NOT_FOUND: 'No block exists before the specified timestamp.',
  TRANSACTION_NOT_FINALIZED: 'Wait for transaction finality.',

  MESSAGE_INVALID: 'Verify the message format matches the expected CCIP message structure.',
  MESSAGE_DECODE_FAILED:
    'Ensure the data is a valid CCIPSendRequested event log. Check the transaction on the source chain explorer.',
  MESSAGE_CCIP_DECODE_FAILED:
    'Ensure the log data is from a CCIPSendRequested event. Verify the source chain and transaction hash.',
  MESSAGE_NOT_FOUND_IN_TX: 'No CCIPSendRequested event found. Verify the transaction hash.',
  MESSAGE_ID_NOT_FOUND: 'Wait and retry. The message may still be in transit (5-20 min typical).',
  MESSAGE_ID_INVALID:
    'Verify the message ID format. Must be a valid 32-byte hex string (0x-prefixed, 64 hex chars).',
  MESSAGE_BATCH_INCOMPLETE: 'Not all messages in the batch were found.',
  MESSAGE_NOT_IN_BATCH: 'The message is not in the expected batch. Verify the commit report.',
  MESSAGE_CHAIN_MISMATCH:
    'Verify you are using the correct destination chain. Check that sourceChainSelector and destChainSelector match your lane.',
  MESSAGE_RETRIEVAL_FAILED:
    'Both API and RPC failed to retrieve the message. Verify the transaction hash is correct and the transaction is confirmed. Check RPC and network connectivity.',
  MESSAGE_VERSION_INVALID:
    'Ensure the source chain onRamp uses CCIP v1.6. Older message versions are not compatible with this destination.',

  OFFRAMP_NOT_FOUND:
    'Check that this source-destination lane is supported. Verify lane availability: https://docs.chain.link/ccip/directory',
  ONRAMP_REQUIRED: 'Provide the onRamp address for this operation.',
  LANE_VERSION_UNSUPPORTED:
    'Upgrade to a supported lane version. Check version compatibility: https://docs.chain.link/ccip/directory',
  LANE_NOT_FOUND:
    'This lane may not exist or is not yet supported by CCIP. Check the CCIP Directory for supported lanes: https://docs.chain.link/ccip/directory',

  COMMIT_NOT_FOUND: 'Wait for the commit report. DON commit typically takes a few minutes.',
  MERKLE_ROOT_MISMATCH:
    'The computed merkle root does not match the committed root. Ensure all messages in the batch are included and ordered correctly.',
  MERKLE_TREE_EMPTY: 'Provide at least one leaf hash.',
  MERKLE_PROOF_EMPTY: 'Both leaves and proofs are empty.',
  MERKLE_PROOF_TOO_LARGE: 'Proof exceeds maximum size (256 leaves). Split into smaller batches.',
  MERKLE_HASHES_TOO_LARGE: 'Total hashes exceed the maximum merkle tree size.',
  MERKLE_FLAGS_MISMATCH:
    'Check that proofFlagBits matches the number of leaves and proofs. This indicates corrupted proof data.',
  MERKLE_PROOF_FLAGS_MISMATCH:
    'Verify the proof data integrity. The proofFlagBits must align with the proofs array length.',
  MERKLE_PROOF_INCOMPLETE:
    'Check that the proof array matches the expected structure. Extra unused proofs indicate malformed data.',
  MERKLE_INTERNAL_ERROR:
    'This is an internal SDK error. Please report this issue with the full error context.',

  VERSION_UNSUPPORTED: 'Supported versions: 1.0, 1.2, 1.5, 1.6.',
  HASHER_VERSION_UNSUPPORTED:
    'Use a supported CCIP version for this chain. Check the lane configuration for compatible versions.',
  VERSION_FEATURE_UNAVAILABLE: 'This feature requires CCIP v1.6 or later.',
  VERSION_REQUIRES_LANE: 'Decoding commits from CCIP <= v1.5 requires lane information.',
  LEGACY_TOKEN_POOLS_UNSUPPORTED: 'Legacy token pools (< v1.5) are not supported.',

  EXTRA_ARGS_PARSE_FAILED: 'Verify the format matches the source chain family.',
  EXTRA_ARGS_UNKNOWN: 'Use EVMExtraArgsV1/V2, SVMExtraArgsV1, or SuiExtraArgsV1.',
  EXTRA_ARGS_INVALID_EVM: 'ExtraArgs must be EVMExtraArgsV1 or EVMExtraArgsV2 format.',
  EXTRA_ARGS_INVALID_SVM: 'ExtraArgs must be SVMExtraArgsV1 format for Solana.',
  EXTRA_ARGS_INVALID_SUI: 'ExtraArgs must be SUIExtraArgsV1 format for Sui.',
  EXTRA_ARGS_INVALID_APTOS: 'ExtraArgs must be EVMExtraArgsV1 or EVMExtraArgsV2 format for Aptos.',
  EXTRA_ARGS_INVALID_TON: 'ExtraArgs must be EVMExtraArgsV2 (GenericExtraArgsV2) format for TON.',
  EXTRA_ARGS_SOLANA_EVM_ONLY: 'Solana can only encode EVMExtraArgsV2.',
  EXTRA_ARGS_APTOS_RESTRICTION: 'Aptos can only encode EVMExtraArgsV2 and SVMExtraArgsV1.',
  EXTRA_ARGS_APTOS_V2_REQUIRED: 'Aptos requires EVMExtraArgsV2 format for this operation.',
  EXTRA_ARGS_LENGTH_INVALID:
    'Provide EVMExtraArgsV2 with valid gasLimit and allowOutOfOrderExecution fields.',

  CONTRACT_TYPE_INVALID:
    'Verify the contract address. Use the correct address for the expected contract type (Router, OnRamp, OffRamp).',
  CONTRACT_NOT_ROUTER:
    'Provide the CCIP Router address. Find it at: https://docs.chain.link/ccip/directory',
  TYPE_VERSION_INVALID:
    'The contract does not expose typeAndVersion(). Verify this is a valid CCIP contract.',
  REGISTRY_TYPE_INVALID: 'The contract is not a TokenAdminRegistry.',

  ADDRESS_INVALID_EVM: 'Invalid EVM address. Must be 20 bytes.',
  ADDRESS_INVALID_APTOS: 'Invalid Aptos address. Must be 32 bytes or less.',

  TOKEN_NOT_FOUND: 'Token not found in supported tokens list. Verify the token address or symbol.',
  TOKEN_NOT_IN_REGISTRY: 'Token not found in TokenAdminRegistry.',
  TOKEN_NOT_CONFIGURED: 'Token is not configured in the registry.',
  TOKEN_NOT_REGISTERED: 'Token is not registered in the TokenAdminRegistry.',
  TOKEN_DECIMALS_INSUFFICIENT: 'Destination token has insufficient decimals.',
  TOKEN_INVALID_SPL: 'Invalid SPL token or Token-2022.',
  TOKEN_DATA_PARSE_FAILED:
    'Ensure the token address is valid and the token contract is deployed on this chain.',
  TOKEN_MINT_NOT_FOUND: 'Token mint not found.',
  TOKEN_AMOUNT_INVALID: 'Token amount must have a valid address and positive amount.',
  TOKEN_POOL_STATE_NOT_FOUND: 'TokenPool state PDA not found.',
  TOKEN_POOL_INFO_NOT_FOUND:
    'Check that the token pool is deployed and configured for this lane. Verify supported tokens: https://docs.chain.link/ccip/directory',

  WALLET_NOT_SIGNER: 'Provide a wallet with signing capability (Signer interface).',
  WALLET_INVALID: 'Provide a valid Wallet instance.',

  EXEC_TX_NOT_CONFIRMED: 'Transaction was not confirmed. Check status and retry.',
  EXEC_TX_REVERTED: 'Transaction reverted. Check the receiver contract.',
  EXECUTION_STATE_INVALID: 'Invalid execution state returned from contract.',
  RECEIPT_NOT_FOUND: 'Receipt not found in transaction logs. Wait and retry.',

  USDC_ATTESTATION_FAILED: 'USDC attestation not ready. Wait and retry (10-30 min typical).',
  LBTC_ATTESTATION_ERROR: 'LBTC attestation fetch failed. Wait and retry.',
  LBTC_ATTESTATION_NOT_FOUND: 'LBTC attestation not found. Verify the payload hash.',
  LBTC_ATTESTATION_NOT_APPROVED: 'LBTC attestation not yet approved. Wait for notarization.',
  CCTP_DECODE_FAILED:
    'Ensure the transaction contains a valid CCTP MessageSent event. Verify this is a USDC transfer.',
  CCTP_MULTIPLE_EVENTS: 'Multiple CCTP events found. Expected only one per transaction.',

  LOG_DATA_INVALID: 'Ensure the log data is a valid hex string from a transaction receipt.',
  LOG_DATA_MISSING: 'Log data is missing or not a string.',
  LOG_APTOS_INVALID:
    'Ensure the event is from a valid Aptos CCIP transaction. Check the transaction on Aptos explorer.',
  LOGS_NOT_FOUND: 'No logs found matching the filter criteria.',
  LOG_TOPICS_NOT_FOUND:
    'Check that the event signature matches. Ensure you are filtering the correct contract address.',
  LOG_EVENT_HANDLER_UNKNOWN:
    'This event type is not recognized. Ensure you are using a supported CCIP event topic.',
  LOGS_WATCH_REQUIRES_FINALITY:
    'Logs watch requires endBlock to be a `finalized`, `latest` or finality block depth (negative).',
  LOGS_WATCH_REQUIRES_START: 'Logs watch requires either startBlock or startTime (forward mode).',
  LOGS_ADDRESS_REQUIRED: 'Provide address for logs filtering.',
  TOPICS_INVALID: 'Topics must be strings for event filtering.',

  SOLANA_LOOKUP_TABLE_NOT_FOUND: 'Lookup table account not found. It may not be synced yet.',
  SOLANA_ROUTER_CONFIG_NOT_FOUND: 'Router config PDA not found.',
  SOLANA_FEE_RESULT_INVALID: 'Invalid fee result from router. Check the router configuration.',
  SOLANA_REF_ADDRESSES_NOT_FOUND: 'Reference addresses account not found. Wait and retry.',
  SOLANA_OFFRAMP_EVENTS_NOT_FOUND: 'OffRamp events not found. Wait and retry.',
  SOLANA_SOURCE_CHAIN_UNSUPPORTED: 'This source chain is not supported for Solana destinations.',
  SOLANA_COMPUTE_UNITS_EXCEEDED:
    'Simulation exceeds compute units limit. Increase the limit or simplify the transaction.',

  APTOS_TX_INVALID:
    'Provide a valid Aptos transaction hash (0x-prefixed 64 hex chars) or version number.',
  APTOS_TX_TYPE_INVALID:
    'Only user transactions are supported. System or block metadata transactions cannot be processed.',
  APTOS_TX_TYPE_UNEXPECTED:
    'Check that the transaction is a standard user transaction, not a script or module deployment.',
  APTOS_ADDRESS_MODULE_REQUIRED: 'Provide an address with module for Aptos log filtering.',
  APTOS_TOPIC_INVALID: 'Provide a valid event topic string for Aptos filtering.',
  APTOS_HASHER_VERSION_UNSUPPORTED: 'This hasher version is not supported for Aptos.',

  HTTP_ERROR: 'HTTP request failed. 429 indicates rate limiting.',
  RPC_NOT_FOUND: 'No RPC endpoint found. Configure an RPC URL.',
  TIMEOUT:
    'Request timed out. Check network connectivity and try again. Consider increasing timeoutMs if the server is slow.',

  VIEM_ADAPTER_ERROR:
    'Check that your viem client has both account and chain defined. For WalletClient, use createWalletClient({ chain, account, ... }).',

  API_CLIENT_NOT_AVAILABLE:
    'The API client was explicitly disabled. To use API features like getLaneLatency(), create the Chain without apiClient: null or provide a CCIPAPIClient instance.',
  API_UNEXPECTED_PAGINATION:
    'The transaction contains an unexpectedly large number of CCIP messages (over 100). This is unusual and may indicate an issue with the transaction or API response.',

  DATA_FORMAT_UNSUPPORTED: 'Unsupported data format. Use hex, bytes, or base64.',
  DATA_PARSE_FAILED: 'Could not parse the provided data. Verify the format.',
  BORSH_TYPE_UNKNOWN: 'Unknown Borsh type in schema.',
  BORSH_METHOD_UNKNOWN: 'Unknown Borsh method.',

  ARGUMENT_INVALID: 'Check the command-line argument format and requirements.',

  NOT_IMPLEMENTED: 'This feature is not yet implemented.',
  UNKNOWN: 'An unknown error occurred. Check the error details.',
}

/** Returns default recovery hint for error code, or undefined if none. */
export function getDefaultRecovery(code: CCIPErrorCode): string | undefined {
  return DEFAULT_RECOVERY_HINTS[code]
}
