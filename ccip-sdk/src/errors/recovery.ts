import type { CCIPErrorCode } from './codes.ts'

/** Recovery hints by error code. */
export const DEFAULT_RECOVERY_HINTS: Partial<Record<CCIPErrorCode, string>> = {
  CHAIN_NOT_FOUND:
    'Verify the chainId, chain selector, or chain name is correct. Check CCIP documentation for supported chains.',
  CHAIN_SELECTOR_NOT_FOUND:
    'Verify the chain selector is valid. Use networkInfo() to look up selectors.',
  CHAIN_FAMILY_UNSUPPORTED: 'Supported families: EVM, Solana, Aptos, Sui.',
  NETWORK_FAMILY_UNSUPPORTED: 'The network family is not supported for this operation.',
  APTOS_NETWORK_UNKNOWN: 'Provide a valid Aptos RPC URL (mainnet or testnet).',

  BLOCK_NOT_FOUND: 'Wait for the block to be finalized and retry.',
  TRANSACTION_NOT_FOUND: 'Verify the transaction hash. The transaction may still be pending.',
  BLOCK_TIME_NOT_FOUND: 'Wait and retry. Block time data may not be available yet.',
  BLOCK_BEFORE_TIMESTAMP_NOT_FOUND: 'No block exists before the specified timestamp.',
  TRANSACTION_NOT_FINALIZED: 'Wait for transaction finality.',

  MESSAGE_INVALID: 'Verify the message format matches the expected CCIP message structure.',
  MESSAGE_DECODE_FAILED: 'Check if it is a valid CCIP message format.',
  MESSAGE_NOT_FOUND_IN_TX: 'No CCIPSendRequested event found. Verify the transaction hash.',
  MESSAGE_ID_NOT_FOUND: 'Wait and retry. The message may still be in transit (5-20 min typical).',
  MESSAGE_BATCH_INCOMPLETE: 'Not all messages in the batch were found.',
  MESSAGE_NOT_IN_BATCH: 'The message is not in the expected batch. Verify the commit report.',
  MESSAGE_CHAIN_MISMATCH: 'The execution report is for a different chain.',

  OFFRAMP_NOT_FOUND: 'No off-ramp found for this lane. Verify the lane is supported.',
  ONRAMP_REQUIRED: 'Provide the onRamp address for this operation.',
  LANE_VERSION_UNSUPPORTED: 'This lane version is not supported.',

  COMMIT_NOT_FOUND: 'Wait for the commit report. DON commit typically takes a few minutes.',
  MERKLE_ROOT_MISMATCH: 'Merkle proof verification failed.',
  MERKLE_TREE_EMPTY: 'Provide at least one leaf hash.',
  MERKLE_PROOF_EMPTY: 'Both leaves and proofs are empty.',
  MERKLE_PROOF_TOO_LARGE: 'Proof exceeds maximum size (256 leaves). Split into smaller batches.',

  VERSION_UNSUPPORTED: 'Supported versions: 1.0, 1.2, 1.5, 1.6.',
  HASHER_VERSION_UNSUPPORTED: 'This hasher version is not supported for the target chain.',
  VERSION_FEATURE_UNAVAILABLE: 'This feature requires CCIP v1.6 or later.',
  VERSION_REQUIRES_LANE: 'Decoding commits from CCIP <= v1.5 requires lane information.',
  LEGACY_TOKEN_POOLS_UNSUPPORTED: 'Legacy token pools (< v1.5) are not supported.',

  EXTRA_ARGS_PARSE_FAILED: 'Verify the format matches the source chain family.',
  EXTRA_ARGS_UNKNOWN: 'Use EVMExtraArgsV1/V2, SVMExtraArgsV1, or SuiExtraArgsV1.',
  EXTRA_ARGS_INVALID_EVM: 'ExtraArgs must be EVMExtraArgsV1 or EVMExtraArgsV2 format.',
  EXTRA_ARGS_INVALID_SVM: 'ExtraArgs must be SVMExtraArgsV1 format for Solana.',
  EXTRA_ARGS_INVALID_SUI: 'ExtraArgs must be SUIExtraArgsV1 format for Sui.',
  EXTRA_ARGS_INVALID_APTOS: 'ExtraArgs must be EVMExtraArgsV1 or EVMExtraArgsV2 format for Aptos.',
  EXTRA_ARGS_SOLANA_EVM_ONLY: 'Solana can only encode EVMExtraArgsV2.',
  EXTRA_ARGS_APTOS_RESTRICTION: 'Aptos can only encode EVMExtraArgsV2 and SVMExtraArgsV1.',

  CONTRACT_TYPE_INVALID: 'The contract at this address is not the expected type.',
  CONTRACT_NOT_ROUTER: 'This address is not a CCIP Router contract.',
  TYPE_VERSION_INVALID: 'Could not parse typeAndVersion from the contract.',
  REGISTRY_TYPE_INVALID: 'The contract is not a TokenAdminRegistry.',

  ADDRESS_INVALID_EVM: 'Invalid EVM address. Must be 20 bytes.',
  ADDRESS_INVALID_APTOS: 'Invalid Aptos address. Must be 32 bytes or less.',

  TOKEN_NOT_IN_REGISTRY: 'Token not found in TokenAdminRegistry.',
  TOKEN_NOT_CONFIGURED: 'Token is not configured in the registry.',
  TOKEN_NOT_REGISTERED: 'Token is not registered in the TokenAdminRegistry.',
  TOKEN_DECIMALS_INSUFFICIENT: 'Destination token has insufficient decimals.',
  TOKEN_INVALID_SPL: 'Invalid SPL token or Token-2022.',
  TOKEN_MINT_NOT_FOUND: 'Token mint not found.',
  TOKEN_AMOUNT_INVALID: 'Token amount must have a valid address and positive amount.',
  TOKEN_POOL_STATE_NOT_FOUND: 'TokenPool state PDA not found.',

  WALLET_NOT_SIGNER: 'Provide a wallet with signing capability (Signer interface).',
  WALLET_INVALID: 'Provide a valid Wallet instance.',

  EXEC_TX_NOT_CONFIRMED: 'Transaction was not confirmed. Check status and retry.',
  EXEC_TX_REVERTED: 'Transaction reverted. Check the receiver contract.',
  EXECUTION_STATE_INVALID: 'Invalid execution state returned from contract.',

  USDC_ATTESTATION_FAILED: 'USDC attestation not ready. Wait and retry (10-30 min typical).',
  LBTC_ATTESTATION_ERROR: 'LBTC attestation fetch failed. Wait and retry.',
  LBTC_ATTESTATION_NOT_FOUND: 'LBTC attestation not found. Verify the payload hash.',
  LBTC_ATTESTATION_NOT_APPROVED: 'LBTC attestation not yet approved. Wait for notarization.',
  CCTP_DECODE_FAILED: 'Could not decode CCTP event.',

  LOG_DATA_INVALID: 'Invalid log data format.',
  LOG_DATA_MISSING: 'Log data is missing or not a string.',
  LOGS_NOT_FOUND: 'No logs found matching the filter criteria.',

  SOLANA_PROGRAM_ADDRESS_REQUIRED: 'Provide a program address for Solana log filtering.',
  SOLANA_TOPICS_INVALID: 'Topics must be strings for Solana event filtering.',
  SOLANA_LOOKUP_TABLE_NOT_FOUND: 'Lookup table account not found. It may not be synced yet.',
  SOLANA_ROUTER_CONFIG_NOT_FOUND: 'Router config PDA not found.',

  APTOS_TX_INVALID: 'Invalid Aptos transaction hash or version.',
  APTOS_TX_TYPE_INVALID: 'Expected a user transaction type.',
  APTOS_ADDRESS_MODULE_REQUIRED: 'Provide an address with module for Aptos log filtering.',

  HTTP_ERROR: 'HTTP request failed. 429 indicates rate limiting.',
  RPC_NOT_FOUND: 'No RPC endpoint found. Configure an RPC URL.',

  DATA_FORMAT_UNSUPPORTED: 'Unsupported data format. Use hex, bytes, or base64.',
  BORSH_TYPE_UNKNOWN: 'Unknown Borsh type in schema.',
  BORSH_METHOD_UNKNOWN: 'Unknown Borsh method.',

  NOT_IMPLEMENTED: 'This feature is not yet implemented.',
  UNKNOWN: 'An unknown error occurred. Check the error details.',
}

/** Returns default recovery hint for error code, or undefined if none. */
export function getDefaultRecovery(code: CCIPErrorCode): string | undefined {
  return DEFAULT_RECOVERY_HINTS[code]
}
