import { type CCIPErrorOptions, CCIPError } from './CCIPError.ts'
import { CCIPErrorCode } from './codes.ts'

// Chain/Network

/** Thrown when chain not found by chainId, selector, or name. */
export class CCIPChainNotFoundError extends CCIPError {
  override readonly name = 'CCIPChainNotFoundError'
  /** Creates a chain not found error. */
  constructor(chainIdOrSelector: string | number | bigint, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.CHAIN_NOT_FOUND, `Chain not found: ${chainIdOrSelector}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, chainIdOrSelector },
    })
  }
}

/** Thrown when chain family is not supported. */
export class CCIPChainFamilyUnsupportedError extends CCIPError {
  override readonly name = 'CCIPChainFamilyUnsupportedError'
  /** Creates a chain family unsupported error. */
  constructor(family: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.CHAIN_FAMILY_UNSUPPORTED, `Unsupported chain family: ${family}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, family },
    })
  }
}

// Block & Transaction

/** Thrown when block not found. Transient: block may not be indexed yet. */
export class CCIPBlockNotFoundError extends CCIPError {
  override readonly name = 'CCIPBlockNotFoundError'
  /** Creates a block not found error. */
  constructor(block: number | bigint | string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.BLOCK_NOT_FOUND, `Block not found: ${block}`, {
      ...options,
      isTransient: true,
      retryAfterMs: 12000,
      context: { ...options?.context, block },
    })
  }
}

/** Thrown when transaction not found. Transient: tx may be pending. */
export class CCIPTransactionNotFoundError extends CCIPError {
  override readonly name = 'CCIPTransactionNotFoundError'
  /** Creates a transaction not found error. */
  constructor(hash: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.TRANSACTION_NOT_FOUND, `Transaction not found: ${hash}`, {
      ...options,
      isTransient: true,
      retryAfterMs: 5000,
      context: { ...options?.context, hash },
    })
  }
}

// CCIP Message

/** Thrown when message format is invalid. */
export class CCIPMessageInvalidError extends CCIPError {
  override readonly name = 'CCIPMessageInvalidError'
  /** Creates a message invalid error. */
  constructor(data: unknown, options?: CCIPErrorOptions) {
    const dataStr = typeof data === 'object' && data !== null ? JSON.stringify(data) : String(data)
    super(CCIPErrorCode.MESSAGE_INVALID, `Invalid CCIP message format: ${dataStr}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, data },
    })
  }
}

/** Thrown when no CCIPSendRequested event in tx. Transient: tx may not be indexed. */
export class CCIPMessageNotFoundInTxError extends CCIPError {
  override readonly name = 'CCIPMessageNotFoundInTxError'
  /** Creates a message not found in transaction error. */
  constructor(txHash: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.MESSAGE_NOT_FOUND_IN_TX,
      `Could not find any CCIPSendRequested message in tx: ${txHash}`,
      {
        ...options,
        isTransient: true,
        retryAfterMs: 30000,
        context: { ...options?.context, txHash },
      },
    )
  }
}

/** Thrown when message with messageId not found. Transient: message may be in transit. */
export class CCIPMessageIdNotFoundError extends CCIPError {
  override readonly name = 'CCIPMessageIdNotFoundError'
  /** Creates a message ID not found error. */
  constructor(messageId: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.MESSAGE_ID_NOT_FOUND,
      `Could not find a CCIPSendRequested message with messageId: ${messageId}`,
      {
        ...options,
        isTransient: true,
        retryAfterMs: 30000,
        context: { ...options?.context, messageId },
      },
    )
  }
}

/** Thrown when not all messages in batch were found. Transient: may still be indexing. */
export class CCIPMessageBatchIncompleteError extends CCIPError {
  override readonly name = 'CCIPMessageBatchIncompleteError'
  /** Creates a message batch incomplete error. */
  constructor(
    seqNumRange: { min: bigint; max: bigint },
    foundSeqNums: bigint[],
    options?: CCIPErrorOptions,
  ) {
    super(
      CCIPErrorCode.MESSAGE_BATCH_INCOMPLETE,
      `Could not find all messages in batch [${seqNumRange.min}..${seqNumRange.max}], got=[${foundSeqNums.join(',')}]`,
      {
        ...options,
        isTransient: true,
        retryAfterMs: 30000,
        context: { ...options?.context, seqNumRange, foundSeqNums },
      },
    )
  }
}

/** Thrown when message not in expected batch. */
export class CCIPMessageNotInBatchError extends CCIPError {
  override readonly name = 'CCIPMessageNotInBatchError'
  /** Creates a message not in batch error. */
  constructor(
    messageId: string,
    seqNumRange: { min: bigint; max: bigint },
    options?: CCIPErrorOptions,
  ) {
    super(
      CCIPErrorCode.MESSAGE_NOT_IN_BATCH,
      `Could not find ${messageId} in batch seqNums=[${seqNumRange.min}..${seqNumRange.max}]`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, messageId, seqNumRange },
      },
    )
  }
}

// Lane & Routing

/** Thrown when no offRamp found for lane. */
export class CCIPOffRampNotFoundError extends CCIPError {
  override readonly name = 'CCIPOffRampNotFoundError'
  /** Creates an offRamp not found error. */
  constructor(onRamp: string, destNetwork: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.OFFRAMP_NOT_FOUND,
      `No matching offRamp found for "${onRamp}" on "${destNetwork}"`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, onRamp, destNetwork },
      },
    )
  }
}

/** Thrown when onRamp required but not provided. */
export class CCIPOnRampRequiredError extends CCIPError {
  override readonly name = 'CCIPOnRampRequiredError'
  /** Creates an onRamp required error. */
  constructor(options?: CCIPErrorOptions) {
    super(CCIPErrorCode.ONRAMP_REQUIRED, 'onRamp address is required for this operation', {
      ...options,
      isTransient: false,
    })
  }
}

// Commit & Merkle

/** Thrown when commit report not found. Transient: DON may not have committed yet. */
export class CCIPCommitNotFoundError extends CCIPError {
  override readonly name = 'CCIPCommitNotFoundError'
  /** Creates a commit not found error. */
  constructor(startBlock: number | string, sequenceNumber: bigint, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.COMMIT_NOT_FOUND,
      `Could not find commit after ${startBlock} for sequenceNumber=${sequenceNumber}`,
      {
        ...options,
        isTransient: true,
        retryAfterMs: 60000,
        context: { ...options?.context, startBlock, sequenceNumber },
      },
    )
  }
}

/** Thrown when merkle root verification fails. */
export class CCIPMerkleRootMismatchError extends CCIPError {
  override readonly name = 'CCIPMerkleRootMismatchError'
  /** Creates a merkle root mismatch error. */
  constructor(expected: string, got: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.MERKLE_ROOT_MISMATCH,
      `Merkle root created from send events doesn't match ReportAccepted merkle root: expected=${expected}, got=${got}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, expected, got },
      },
    )
  }
}

/** Thrown when attempting to create tree without leaves. */
export class CCIPMerkleTreeEmptyError extends CCIPError {
  override readonly name = 'CCIPMerkleTreeEmptyError'
  /** Creates a merkle tree empty error. */
  constructor(options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.MERKLE_TREE_EMPTY,
      'Cannot construct merkle tree: no leaf hashes provided',
      {
        ...options,
        isTransient: false,
      },
    )
  }
}

// Version

/** Thrown when CCIP version not supported. */
export class CCIPVersionUnsupportedError extends CCIPError {
  override readonly name = 'CCIPVersionUnsupportedError'
  /** Creates a version unsupported error. */
  constructor(version: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.VERSION_UNSUPPORTED, `Unsupported version: ${version}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, version },
    })
  }
}

/** Thrown when hasher version not supported for chain. */
export class CCIPHasherVersionUnsupportedError extends CCIPError {
  override readonly name = 'CCIPHasherVersionUnsupportedError'
  /** Creates a hasher version unsupported error. */
  constructor(chain: string, version: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.HASHER_VERSION_UNSUPPORTED,
      `Unsupported hasher version for ${chain}: ${version}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, chain, version },
      },
    )
  }
}

// ExtraArgs

/** Thrown when extraArgs cannot be parsed. */
export class CCIPExtraArgsParseError extends CCIPError {
  override readonly name = 'CCIPExtraArgsParseError'
  /** Creates an extraArgs parse error. */
  constructor(from: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.EXTRA_ARGS_PARSE_FAILED, `Could not parse extraArgs from "${from}"`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, from },
    })
  }
}

/**
 * Thrown when extraArgs format invalid for chain family.
 *
 * @param chainFamily - Display name for the chain family (user-facing, differs from ChainFamily enum)
 * @param extraArgs - The actual invalid extraArgs value (for debugging)
 */
export class CCIPExtraArgsInvalidError extends CCIPError {
  override readonly name = 'CCIPExtraArgsInvalidError'
  /** Creates an extraArgs invalid error. */
  constructor(
    chainFamily: 'EVM' | 'SVM' | 'Sui' | 'Aptos' | 'TON',
    extraArgs?: string,
    options?: CCIPErrorOptions,
  ) {
    const ERROR_CODE_MAP = {
      EVM: CCIPErrorCode.EXTRA_ARGS_INVALID_EVM,
      SVM: CCIPErrorCode.EXTRA_ARGS_INVALID_SVM,
      Sui: CCIPErrorCode.EXTRA_ARGS_INVALID_SUI,
      Aptos: CCIPErrorCode.EXTRA_ARGS_INVALID_APTOS,
      TON: CCIPErrorCode.EXTRA_ARGS_INVALID_TON,
    } as const
    const code = ERROR_CODE_MAP[chainFamily]
    const message = extraArgs
      ? `Invalid extraArgs "${extraArgs}" for ${chainFamily}`
      : `Invalid extraArgs for ${chainFamily}`
    super(code, message, {
      ...options,
      isTransient: false,
      context: { ...options?.context, chainFamily, extraArgs },
    })
  }
}

// Token & Registry

/** Thrown when token not found in registry. */
export class CCIPTokenNotInRegistryError extends CCIPError {
  override readonly name = 'CCIPTokenNotInRegistryError'
  /** Creates a token not in registry error. */
  constructor(token: string, registry: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.TOKEN_NOT_IN_REGISTRY, `Token=${token} not found in registry=${registry}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, token, registry },
    })
  }
}

/** Thrown when token not configured in registry. */
export class CCIPTokenNotConfiguredError extends CCIPError {
  override readonly name = 'CCIPTokenNotConfiguredError'
  /** Creates a token not configured error. */
  constructor(token: string, registry: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.TOKEN_NOT_CONFIGURED,
      `Token ${token} is not configured in registry ${registry}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, token, registry },
      },
    )
  }
}

/** Thrown when destination token decimals insufficient. */
export class CCIPTokenDecimalsInsufficientError extends CCIPError {
  override readonly name = 'CCIPTokenDecimalsInsufficientError'
  /** Creates a token decimals insufficient error. */
  constructor(
    token: string,
    destDecimals: number,
    destChain: string,
    amount: string,
    options?: CCIPErrorOptions,
  ) {
    super(
      CCIPErrorCode.TOKEN_DECIMALS_INSUFFICIENT,
      `not enough decimals=${destDecimals} for token=${token} on dest=${destChain} to express ${amount}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, token, destDecimals, destChain, amount },
      },
    )
  }
}

// Contract Type

/** Thrown when contract type is not as expected. */
export class CCIPContractTypeInvalidError extends CCIPError {
  override readonly name = 'CCIPContractTypeInvalidError'
  /** Creates a contract type invalid error. */
  constructor(
    address: string,
    actualType: string,
    expectedTypes: string[],
    options?: CCIPErrorOptions,
  ) {
    super(
      CCIPErrorCode.CONTRACT_TYPE_INVALID,
      `Not a ${expectedTypes.join(', ')}: ${address} is "${actualType}"`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, address, actualType, expectedTypes },
      },
    )
  }
}

// Wallet & Signer

/** Thrown when wallet must be Signer but isn't. */
export class CCIPWalletNotSignerError extends CCIPError {
  override readonly name = 'CCIPWalletNotSignerError'
  /** Creates a wallet not signer error. */
  constructor(wallet: unknown, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.WALLET_NOT_SIGNER, `Wallet must be a Signer, got=${typeof wallet}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, walletType: typeof wallet },
    })
  }
}

// Execution

/** Thrown when exec tx not confirmed. Transient: may need more time. */
export class CCIPExecTxNotConfirmedError extends CCIPError {
  override readonly name = 'CCIPExecTxNotConfirmedError'
  /** Creates an exec transaction not confirmed error. */
  constructor(txHash: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.EXEC_TX_NOT_CONFIRMED, `Could not confirm exec tx: ${txHash}`, {
      ...options,
      isTransient: true,
      retryAfterMs: 5000,
      context: { ...options?.context, txHash },
    })
  }
}

/** Thrown when exec tx reverted. */
export class CCIPExecTxRevertedError extends CCIPError {
  override readonly name = 'CCIPExecTxRevertedError'
  /** Creates an exec transaction reverted error. */
  constructor(txHash: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.EXEC_TX_REVERTED, `Exec transaction reverted: ${txHash}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, txHash },
    })
  }
}

// Attestation (USDC/LBTC)

/** Thrown when USDC attestation fetch fails. Transient: attestation may not be ready. */
export class CCIPUsdcAttestationError extends CCIPError {
  override readonly name = 'CCIPUsdcAttestationError'
  /** Creates a USDC attestation error. */
  constructor(messageHash: string, response: unknown, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.USDC_ATTESTATION_FAILED,
      `Could not fetch USDC attestation for hash: ${messageHash}`,
      {
        ...options,
        isTransient: true,
        retryAfterMs: 10000,
        context: { ...options?.context, messageHash, response },
      },
    )
  }
}

/** Thrown when LBTC attestation fetch fails. Transient: attestation may not be ready. */
export class CCIPLbtcAttestationError extends CCIPError {
  override readonly name = 'CCIPLbtcAttestationError'
  /** Creates an LBTC attestation error. */
  constructor(response: unknown, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.LBTC_ATTESTATION_ERROR,
      `Error while fetching LBTC attestation. Response: ${JSON.stringify(response)}`,
      {
        ...options,
        isTransient: true,
        retryAfterMs: 10000,
        context: { ...options?.context, response },
      },
    )
  }
}

/** Thrown when LBTC attestation not found for payload hash. Transient: may not be processed yet. */
export class CCIPLbtcAttestationNotFoundError extends CCIPError {
  override readonly name = 'CCIPLbtcAttestationNotFoundError'
  /** Creates an LBTC attestation not found error. */
  constructor(payloadHash: string, response: unknown, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.LBTC_ATTESTATION_NOT_FOUND,
      `Could not find LBTC attestation for hash: ${payloadHash}`,
      {
        ...options,
        isTransient: true,
        retryAfterMs: 30000,
        context: { ...options?.context, payloadHash, response },
      },
    )
  }
}

/** Thrown when LBTC attestation is not yet approved. Transient: may be pending notarization. */
export class CCIPLbtcAttestationNotApprovedError extends CCIPError {
  override readonly name = 'CCIPLbtcAttestationNotApprovedError'
  /** Creates an LBTC attestation not approved error. */
  constructor(payloadHash: string, attestation: unknown, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.LBTC_ATTESTATION_NOT_APPROVED,
      `LBTC attestation not yet approved for hash: ${payloadHash}`,
      {
        ...options,
        isTransient: true,
        retryAfterMs: 30000,
        context: { ...options?.context, payloadHash, attestation },
      },
    )
  }
}

// Solana

/** Thrown when program address required for Solana log filtering. */
export class CCIPSolanaProgramAddressRequiredError extends CCIPError {
  override readonly name = 'CCIPSolanaProgramAddressRequiredError'
  /** Creates a Solana program address required error. */
  constructor(options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.SOLANA_PROGRAM_ADDRESS_REQUIRED,
      'Program address is required for Solana log filtering',
      {
        ...options,
        isTransient: false,
      },
    )
  }
}

/** Thrown when lookup table not found. Transient: may not be synced yet. */
export class CCIPSolanaLookupTableNotFoundError extends CCIPError {
  override readonly name = 'CCIPSolanaLookupTableNotFoundError'
  /** Creates a Solana lookup table not found error. */
  constructor(address: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.SOLANA_LOOKUP_TABLE_NOT_FOUND,
      `Lookup table account not found: ${address}`,
      {
        ...options,
        isTransient: true,
        retryAfterMs: 5000,
        context: { ...options?.context, address },
      },
    )
  }
}

// Aptos

/** Thrown for invalid Aptos transaction hash or version. */
export class CCIPAptosTransactionInvalidError extends CCIPError {
  override readonly name = 'CCIPAptosTransactionInvalidError'
  /** Creates an Aptos transaction invalid error. */
  constructor(hashOrVersion: string | number, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.APTOS_TX_INVALID, `Invalid transaction hash or version: ${hashOrVersion}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, hashOrVersion },
    })
  }
}

// HTTP & Data

/** Thrown for HTTP errors. Transient if 429 or 5xx. */
export class CCIPHttpError extends CCIPError {
  override readonly name = 'CCIPHttpError'
  /** Creates an HTTP error. */
  constructor(status: number, statusText: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.HTTP_ERROR, `HTTP ${status}: ${statusText}`, {
      ...options,
      isTransient: status === 429 || status >= 500,
      context: { ...options?.context, status, statusText },
    })
  }
}

/** Thrown for not implemented features. */
export class CCIPNotImplementedError extends CCIPError {
  override readonly name = 'CCIPNotImplementedError'
  /** Creates a not implemented error. */
  constructor(feature?: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.NOT_IMPLEMENTED,
      feature ? `Not implemented: ${feature}` : 'Not implemented',
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, feature },
      },
    )
  }
}

// Data Format & Parsing

/** Thrown when data format is not supported. */
export class CCIPDataFormatUnsupportedError extends CCIPError {
  override readonly name = 'CCIPDataFormatUnsupportedError'
  /** Creates a data format unsupported error. */
  constructor(data: unknown, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.DATA_FORMAT_UNSUPPORTED, `Unsupported data format: ${String(data)}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, data },
    })
  }
}

/** Thrown when typeAndVersion string cannot be parsed. */
export class CCIPTypeVersionInvalidError extends CCIPError {
  override readonly name = 'CCIPTypeVersionInvalidError'
  /** Creates a type version invalid error. */
  constructor(typeAndVersion: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.TYPE_VERSION_INVALID, `Invalid typeAndVersion: "${typeAndVersion}"`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, typeAndVersion },
    })
  }
}

/** Thrown when no block found before timestamp. */
export class CCIPBlockBeforeTimestampNotFoundError extends CCIPError {
  override readonly name = 'CCIPBlockBeforeTimestampNotFoundError'
  /** Creates a block before timestamp not found error. */
  constructor(timestamp: number, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.BLOCK_BEFORE_TIMESTAMP_NOT_FOUND,
      `Could not find a block prior to timestamp=${timestamp}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, timestamp },
      },
    )
  }
}

/** Thrown when message decoding fails. */
export class CCIPMessageDecodeError extends CCIPError {
  override readonly name = 'CCIPMessageDecodeError'
  /** Creates a message decode error. */
  constructor(reason?: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.MESSAGE_DECODE_FAILED,
      reason ? `Failed to decode message: ${reason}` : 'Failed to decode message',
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, reason },
      },
    )
  }
}

/** Thrown when network family is not supported for an operation. */
export class CCIPNetworkFamilyUnsupportedError extends CCIPError {
  override readonly name = 'CCIPNetworkFamilyUnsupportedError'
  /** Creates a network family unsupported error. */
  constructor(family: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.NETWORK_FAMILY_UNSUPPORTED, `Unsupported network family: ${family}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, family },
    })
  }
}

/** Thrown when RPC endpoint not found. */
export class CCIPRpcNotFoundError extends CCIPError {
  override readonly name = 'CCIPRpcNotFoundError'
  /** Creates an RPC not found error. */
  constructor(chainId: string | number, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.RPC_NOT_FOUND, `No RPC found for chainId=${chainId}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, chainId },
    })
  }
}

/** Thrown when logs not found for filter criteria. */
export class CCIPLogsNotFoundError extends CCIPError {
  override readonly name = 'CCIPLogsNotFoundError'
  /** Creates a logs not found error. */
  constructor(filter?: unknown, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.LOGS_NOT_FOUND, 'No logs found matching the filter criteria', {
      ...options,
      isTransient: true,
      retryAfterMs: 5000,
      context: { ...options?.context, filter },
    })
  }
}

/** Thrown when log topics not found. */
export class CCIPLogTopicsNotFoundError extends CCIPError {
  override readonly name = 'CCIPLogTopicsNotFoundError'
  /** Creates a log topics not found error. */
  constructor(topics: unknown, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.LOG_TOPICS_NOT_FOUND, `Could not find matching topics: ${String(topics)}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, topics },
    })
  }
}

/** Thrown when trying to `watch` logs but giving a fixed `endBlock` */
export class CCIPLogsWatchRequiresFinalityError extends CCIPError {
  override readonly name = 'CCIPLogsWatchRequiresFinalityError'
  /** Creates a block not found error. */
  constructor(endBlock?: number | string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.LOGS_WATCH_REQUIRES_FINALITY,
      `Watch mode requires finality config for endBlock (latest, finalized or block depth=negative)`,
      { ...options, isTransient: false, context: { ...options?.context, endBlock } },
    )
  }
}

/** Thrown when trying to `watch` logs but giving a fixed `endBlock` */
export class CCIPLogsWatchRequiresStartError extends CCIPError {
  override readonly name = 'CCIPLogsWatchRequiresStartError'
  /** Creates a block not found error. */
  constructor(
    { startBlock, startTime }: { startBlock?: number; startTime?: number },
    options?: CCIPErrorOptions,
  ) {
    super(CCIPErrorCode.LOGS_WATCH_REQUIRES_START, `Watch mode requires startBlock or startTime`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, startBlock, startTime },
    })
  }
}

// Chain Family

/** Thrown when network family does not match expected for a Chain constructor. */
export class CCIPChainFamilyMismatchError extends CCIPError {
  override readonly name = 'CCIPChainFamilyMismatchError'
  /** Creates a chain family mismatch error. */
  constructor(chainName: string, expected: string, actual: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.CHAIN_FAMILY_MISMATCH,
      `Invalid network family for ${chainName}: expected ${expected}, got ${actual}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, chainName, expected, actual },
      },
    )
  }
}

// Token Pool

/** Thrown when legacy (pre-1.5) token pools are not supported. */
export class CCIPLegacyTokenPoolsUnsupportedError extends CCIPError {
  override readonly name = 'CCIPLegacyTokenPoolsUnsupportedError'
  /** Creates a legacy token pools unsupported error. */
  constructor(options?: CCIPErrorOptions) {
    super(CCIPErrorCode.LEGACY_TOKEN_POOLS_UNSUPPORTED, 'Legacy <1.5 token pools not supported', {
      ...options,
      isTransient: false,
    })
  }
}

// Merkle Validation

/** Thrown when merkle proof is empty. */
export class CCIPMerkleProofEmptyError extends CCIPError {
  override readonly name = 'CCIPMerkleProofEmptyError'
  /** Creates a merkle proof empty error. */
  constructor(options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.MERKLE_PROOF_EMPTY,
      'Cannot verify merkle proof: leaves and proofs are empty',
      {
        ...options,
        isTransient: false,
      },
    )
  }
}

/** Thrown when merkle leaves or proofs exceed max limit. */
export class CCIPMerkleProofTooLargeError extends CCIPError {
  override readonly name = 'CCIPMerkleProofTooLargeError'
  /** Creates a merkle proof too large error. */
  constructor(limit: number, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.MERKLE_PROOF_TOO_LARGE, `Leaves or proofs exceed limit of ${limit}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, limit },
    })
  }
}

/** Thrown when total hashes exceed max merkle tree size. */
export class CCIPMerkleHashesTooLargeError extends CCIPError {
  override readonly name = 'CCIPMerkleHashesTooLargeError'
  /** Creates a merkle hashes too large error. */
  constructor(totalHashes: number, limit: number, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.MERKLE_HASHES_TOO_LARGE,
      `Total hashes ${totalHashes} exceeds limit ${limit}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, totalHashes, limit },
      },
    )
  }
}

/** Thrown when source flags count does not match expected total. */
export class CCIPMerkleFlagsMismatchError extends CCIPError {
  override readonly name = 'CCIPMerkleFlagsMismatchError'
  /** Creates a merkle flags mismatch error. */
  constructor(totalHashes: number, flagsLength: number, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.MERKLE_FLAGS_MISMATCH,
      `Hashes ${totalHashes} != sourceFlags ${flagsLength}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, totalHashes, flagsLength },
      },
    )
  }
}

/** Thrown when proof source flags count does not match proof hashes. */
export class CCIPMerkleProofFlagsMismatchError extends CCIPError {
  override readonly name = 'CCIPMerkleProofFlagsMismatchError'
  /** Creates a merkle proof flags mismatch error. */
  constructor(sourceProofCount: number, proofsLength: number, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.MERKLE_PROOF_FLAGS_MISMATCH,
      `Proof source flags ${sourceProofCount} != proof hashes ${proofsLength}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, sourceProofCount, proofsLength },
      },
    )
  }
}

/** Thrown when not all proofs were consumed during verification. */
export class CCIPMerkleProofIncompleteError extends CCIPError {
  override readonly name = 'CCIPMerkleProofIncompleteError'
  /** Creates a merkle proof incomplete error. */
  constructor(options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.MERKLE_PROOF_INCOMPLETE,
      'Merkle verification failed: not all proofs were consumed',
      {
        ...options,
        isTransient: false,
      },
    )
  }
}

/** Thrown on internal merkle computation error. */
export class CCIPMerkleInternalError extends CCIPError {
  override readonly name = 'CCIPMerkleInternalError'
  /** Creates a merkle internal error. */
  constructor(message: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.MERKLE_INTERNAL_ERROR, message, {
      ...options,
      isTransient: false,
    })
  }
}

// Address Validation

/** Thrown when EVM address is invalid. */
export class CCIPAddressInvalidEvmError extends CCIPError {
  override readonly name = 'CCIPAddressInvalidEvmError'
  /** Creates an EVM address invalid error. */
  constructor(address: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.ADDRESS_INVALID_EVM, `Invalid EVM address: ${address}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, address },
    })
  }
}

// Version Requirements

/** Thrown when CCIP version requires lane info. */
export class CCIPVersionRequiresLaneError extends CCIPError {
  override readonly name = 'CCIPVersionRequiresLaneError'
  /** Creates a version requires lane error. */
  constructor(version: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.VERSION_REQUIRES_LANE,
      `Decoding commits from CCIP ${version} requires lane`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, version },
      },
    )
  }
}

/** Thrown when version feature is unavailable. */
export class CCIPVersionFeatureUnavailableError extends CCIPError {
  override readonly name = 'CCIPVersionFeatureUnavailableError'
  /** Creates a version feature unavailable error. */
  constructor(feature: string, version: string, minVersion?: string, options?: CCIPErrorOptions) {
    const msg = minVersion
      ? `${feature} requires version >= ${minVersion}, got ${version}`
      : `${feature} not available in version ${version}`
    super(CCIPErrorCode.VERSION_FEATURE_UNAVAILABLE, msg, {
      ...options,
      isTransient: false,
      context: { ...options?.context, feature, version, minVersion },
    })
  }
}

// Contract Validation

/** Thrown when contract is not a Router or expected CCIP contract. */
export class CCIPContractNotRouterError extends CCIPError {
  override readonly name = 'CCIPContractNotRouterError'
  /** Creates a contract not router error. */
  constructor(address: string, typeAndVersion: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.CONTRACT_NOT_ROUTER,
      `Not a Router, Ramp or expected contract: ${address} is "${typeAndVersion}"`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, address, typeAndVersion },
      },
    )
  }
}

// Log Data

/** Thrown when log data is invalid. */
export class CCIPLogDataInvalidError extends CCIPError {
  override readonly name = 'CCIPLogDataInvalidError'
  /** Creates a log data invalid error. */
  constructor(data: unknown, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.LOG_DATA_INVALID, `Invalid log data: ${String(data)}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, data },
    })
  }
}

// Wallet

/** Thrown when wallet is not a valid signer. */
export class CCIPWalletInvalidError extends CCIPError {
  override readonly name = 'CCIPWalletInvalidError'
  /** Creates a wallet invalid error. */
  constructor(wallet: unknown, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.WALLET_INVALID, `Wallet must be a Signer, got ${String(wallet)}`, {
      ...options,
      isTransient: false,
    })
  }
}

// Source Chain

/** Thrown when source chain is unsupported for EVM hasher. */
export class CCIPSourceChainUnsupportedError extends CCIPError {
  override readonly name = 'CCIPSourceChainUnsupportedError'
  /** Creates a source chain unsupported error. */
  constructor(chainSelector: bigint, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.SOLANA_SOURCE_CHAIN_UNSUPPORTED,
      `Unsupported source chain: ${chainSelector}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, chainSelector: String(chainSelector) },
      },
    )
  }
}

// Solana-specific errors

/** Thrown when block time cannot be retrieved for a slot. */
export class CCIPBlockTimeNotFoundError extends CCIPError {
  override readonly name = 'CCIPBlockTimeNotFoundError'
  /** Creates a block time not found error. */
  constructor(block: number | string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.BLOCK_TIME_NOT_FOUND, `Could not get block time for slot ${block}`, {
      ...options,
      isTransient: true,
      retryAfterMs: 5000,
      context: { ...options?.context, block },
    })
  }
}

/** Thrown when Solana topics are not valid strings. */
export class CCIPSolanaTopicsInvalidError extends CCIPError {
  override readonly name = 'CCIPSolanaTopicsInvalidError'
  /** Creates a Solana topics invalid error. */
  constructor(options?: CCIPErrorOptions) {
    super(CCIPErrorCode.SOLANA_TOPICS_INVALID, 'Solana event topics must be string values', {
      ...options,
      isTransient: false,
    })
  }
}

/** Thrown when reference addresses account not found for offRamp. */
export class CCIPSolanaRefAddressesNotFoundError extends CCIPError {
  override readonly name = 'CCIPSolanaRefAddressesNotFoundError'
  /** Creates a reference addresses not found error. */
  constructor(offRamp: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.SOLANA_REF_ADDRESSES_NOT_FOUND,
      `referenceAddresses account not found for offRamp=${offRamp}`,
      {
        ...options,
        isTransient: true,
        retryAfterMs: 5000,
        context: { ...options?.context, offRamp },
      },
    )
  }
}

/** Thrown when OffRamp events not found in feeQuoter transactions. */
export class CCIPSolanaOffRampEventsNotFoundError extends CCIPError {
  override readonly name = 'CCIPSolanaOffRampEventsNotFoundError'
  /** Creates an offRamp events not found error. */
  constructor(feeQuoter: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.SOLANA_OFFRAMP_EVENTS_NOT_FOUND,
      `Could not find OffRamp events in feeQuoter=${feeQuoter} txs`,
      {
        ...options,
        isTransient: true,
        retryAfterMs: 10000,
        context: { ...options?.context, feeQuoter },
      },
    )
  }
}

/** Thrown when token pool info not found. */
export class CCIPTokenPoolInfoNotFoundError extends CCIPError {
  override readonly name = 'CCIPTokenPoolInfoNotFoundError'
  /** Creates a token pool info not found error. */
  constructor(tokenPool: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.TOKEN_POOL_INFO_NOT_FOUND, `TokenPool info not found: ${tokenPool}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, tokenPool },
    })
  }
}

/** Thrown when SPL token is invalid or not Token-2022. */
export class CCIPSplTokenInvalidError extends CCIPError {
  override readonly name = 'CCIPSplTokenInvalidError'
  /** Creates an SPL token invalid error. */
  constructor(token: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.TOKEN_INVALID_SPL, `Invalid SPL token or Token-2022: ${token}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, token },
    })
  }
}

/** Thrown when token data cannot be parsed. */
export class CCIPTokenDataParseError extends CCIPError {
  override readonly name = 'CCIPTokenDataParseError'
  /** Creates a token data parse error. */
  constructor(token: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.TOKEN_DATA_PARSE_FAILED, `Unable to parse token data for ${token}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, token },
    })
  }
}

/** Thrown when EVMExtraArgsV2 has unsupported length. */
export class CCIPExtraArgsLengthInvalidError extends CCIPError {
  override readonly name = 'CCIPExtraArgsLengthInvalidError'
  /** Creates an extraArgs length invalid error. */
  constructor(length: number, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.EXTRA_ARGS_LENGTH_INVALID, `Unsupported EVMExtraArgsV2 length: ${length}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, length },
    })
  }
}

/** Thrown when Solana can only encode EVMExtraArgsV2 but got different args. */
export class CCIPSolanaExtraArgsEncodingError extends CCIPError {
  override readonly name = 'CCIPSolanaExtraArgsEncodingError'
  /** Creates a Solana extraArgs encoding error. */
  constructor(options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.EXTRA_ARGS_SOLANA_EVM_ONLY,
      'Solana extraArgs encoding only supports EVMExtraArgsV2 format',
      {
        ...options,
        isTransient: false,
      },
    )
  }
}

/** Thrown when log data is missing or not a string. */
export class CCIPLogDataMissingError extends CCIPError {
  override readonly name = 'CCIPLogDataMissingError'
  /** Creates a log data missing error. */
  constructor(options?: CCIPErrorOptions) {
    super(CCIPErrorCode.LOG_DATA_MISSING, 'Log data is missing or invalid: expected string value', {
      ...options,
      isTransient: false,
    })
  }
}

/** Thrown when ExecutionState is invalid. */
export class CCIPExecutionStateInvalidError extends CCIPError {
  override readonly name = 'CCIPExecutionStateInvalidError'
  /** Creates an execution state invalid error. */
  constructor(state: unknown, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.EXECUTION_STATE_INVALID, `Invalid ExecutionState: ${String(state)}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, state },
    })
  }
}

/** Thrown when execution report message is not for Solana. */
export class CCIPExecutionReportChainMismatchError extends CCIPError {
  override readonly name = 'CCIPExecutionReportChainMismatchError'
  /** Creates an execution report chain mismatch error. */
  constructor(chain: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.MESSAGE_CHAIN_MISMATCH, `ExecutionReport's message not for ${chain}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, chain },
    })
  }
}

/** Thrown when token pool state PDA not found. */
export class CCIPTokenPoolStateNotFoundError extends CCIPError {
  override readonly name = 'CCIPTokenPoolStateNotFoundError'
  /** Creates a token pool state not found error. */
  constructor(tokenPool: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.TOKEN_POOL_STATE_NOT_FOUND,
      `TokenPool State PDA not found at ${tokenPool}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, tokenPool },
      },
    )
  }
}

/** Thrown when ChainConfig not found for token pool and remote chain. */
export class CCIPTokenPoolChainConfigNotFoundError extends CCIPError {
  override readonly name = 'CCIPTokenPoolChainConfigNotFoundError'
  /** Creates a token pool chain config not found error. */
  constructor(
    address: string,
    tokenPool: string,
    remoteNetwork: string,
    options?: CCIPErrorOptions,
  ) {
    super(
      CCIPErrorCode.TOKEN_NOT_CONFIGURED,
      `ChainConfig not found at ${address} for tokenPool=${tokenPool} and remoteNetwork=${remoteNetwork}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, address, tokenPool, remoteNetwork },
      },
    )
  }
}

// Aptos-specific errors

/** Thrown when Aptos network is unknown. */
export class CCIPAptosNetworkUnknownError extends CCIPError {
  override readonly name = 'CCIPAptosNetworkUnknownError'
  /** Creates an Aptos network unknown error. */
  constructor(url: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.APTOS_NETWORK_UNKNOWN, `Unknown Aptos network: ${url}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, url },
    })
  }
}

/** Thrown when Aptos transaction type is invalid. */
export class CCIPAptosTransactionTypeInvalidError extends CCIPError {
  override readonly name = 'CCIPAptosTransactionTypeInvalidError'
  /** Creates an Aptos transaction type invalid error. */
  constructor(options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.APTOS_TX_TYPE_INVALID,
      'Invalid Aptos transaction type: expected user_transaction',
      {
        ...options,
        isTransient: false,
      },
    )
  }
}

/** Thrown when Aptos registry type is invalid. */
export class CCIPAptosRegistryTypeInvalidError extends CCIPError {
  override readonly name = 'CCIPAptosRegistryTypeInvalidError'
  /** Creates an Aptos registry type invalid error. */
  constructor(registry: string, actualType: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.REGISTRY_TYPE_INVALID,
      `Expected ${registry} to have TokenAdminRegistry type, got=${actualType}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, registry, actualType },
      },
    )
  }
}

/** Thrown when Aptos log data is invalid. */
export class CCIPAptosLogInvalidError extends CCIPError {
  override readonly name = 'CCIPAptosLogInvalidError'
  /** Creates an Aptos log invalid error. */
  constructor(log: unknown, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.LOG_APTOS_INVALID, `Invalid aptos log: ${String(log)}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, log },
    })
  }
}

/** Thrown when Aptos address is invalid. */
export class CCIPAptosAddressInvalidError extends CCIPError {
  override readonly name = 'CCIPAptosAddressInvalidError'
  /** Creates an Aptos address invalid error. */
  constructor(address: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.ADDRESS_INVALID_APTOS, `Invalid aptos address: "${address}"`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, address },
    })
  }
}

/** Thrown when Aptos can only encode specific extra args types. */
export class CCIPAptosExtraArgsEncodingError extends CCIPError {
  override readonly name = 'CCIPAptosExtraArgsEncodingError'
  /** Creates an Aptos extraArgs encoding error. */
  constructor(options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.EXTRA_ARGS_APTOS_RESTRICTION,
      'Aptos can only encode EVMExtraArgsV2 & SVMExtraArgsV1',
      {
        ...options,
        isTransient: false,
      },
    )
  }
}

/** Thrown when Aptos wallet is invalid. */
export class CCIPAptosWalletInvalidError extends CCIPError {
  override readonly name = 'CCIPAptosWalletInvalidError'
  /** Creates an Aptos wallet invalid error. */
  constructor(className: string, wallet: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.WALLET_INVALID,
      `${className}.sendMessage requires an Aptos account wallet, got=${wallet}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, className, wallet },
      },
    )
  }
}

/** Thrown when Aptos expects EVMExtraArgsV2 reports. */
export class CCIPAptosExtraArgsV2RequiredError extends CCIPError {
  override readonly name = 'CCIPAptosExtraArgsV2RequiredError'
  /** Creates an Aptos EVMExtraArgsV2 required error. */
  constructor(options?: CCIPErrorOptions) {
    super(CCIPErrorCode.EXTRA_ARGS_APTOS_V2_REQUIRED, 'Aptos expects EVMExtraArgsV2 reports', {
      ...options,
      isTransient: false,
    })
  }
}

/** Thrown when token is not registered in Aptos registry. */
export class CCIPAptosTokenNotRegisteredError extends CCIPError {
  override readonly name = 'CCIPAptosTokenNotRegisteredError'
  /** Creates an Aptos token not registered error. */
  constructor(token: string, registry: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.TOKEN_NOT_REGISTERED,
      `Token=${token} not registered in registry=${registry}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, token, registry },
      },
    )
  }
}

/** Thrown for unexpected Aptos transaction type. */
export class CCIPAptosTransactionTypeUnexpectedError extends CCIPError {
  override readonly name = 'CCIPAptosTransactionTypeUnexpectedError'
  /** Creates an Aptos transaction type unexpected error. */
  constructor(type: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.APTOS_TX_TYPE_UNEXPECTED, `Unexpected transaction type="${type}"`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, type },
    })
  }
}

/** Thrown when Aptos address with module is required. */
export class CCIPAptosAddressModuleRequiredError extends CCIPError {
  override readonly name = 'CCIPAptosAddressModuleRequiredError'
  /** Creates an Aptos address module required error. */
  constructor(options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.APTOS_ADDRESS_MODULE_REQUIRED,
      'Aptos address with module name is required for this operation',
      {
        ...options,
        isTransient: false,
      },
    )
  }
}

/** Thrown when Aptos topic is invalid. */
export class CCIPAptosTopicInvalidError extends CCIPError {
  override readonly name = 'CCIPAptosTopicInvalidError'
  /** Creates an Aptos topic invalid error. */
  constructor(topic?: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.APTOS_TOPIC_INVALID,
      topic ? `Unknown topic event handler="${topic}"` : 'single string topic required',
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, topic },
      },
    )
  }
}

// Borsh

/** Thrown when Borsh type is unknown. */
export class CCIPBorshTypeUnknownError extends CCIPError {
  override readonly name = 'CCIPBorshTypeUnknownError'
  /** Creates a Borsh type unknown error. */
  constructor(name: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.BORSH_TYPE_UNKNOWN, `Unknown type: ${name}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, name },
    })
  }
}

/** Thrown when Borsh method is unknown. */
export class CCIPBorshMethodUnknownError extends CCIPError {
  override readonly name = 'CCIPBorshMethodUnknownError'
  /** Creates a Borsh method unknown error. */
  constructor(method: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.BORSH_METHOD_UNKNOWN, `Unknown method: ${method}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, method },
    })
  }
}

// CLI & Validation

/** Thrown when CLI argument is invalid. */
export class CCIPArgumentInvalidError extends CCIPError {
  override readonly name = 'CCIPArgumentInvalidError'
  /** Creates an argument invalid error. */
  constructor(argument: string, reason: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.ARGUMENT_INVALID, `Invalid argument "${argument}": ${reason}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, argument, reason },
    })
  }
}

/** Thrown when execution receipt not found in tx logs. Transient: receipt may not be indexed yet. */
export class CCIPReceiptNotFoundError extends CCIPError {
  override readonly name = 'CCIPReceiptNotFoundError'
  /** Creates a receipt not found error. */
  constructor(txHash: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.RECEIPT_NOT_FOUND, `Could not find receipt in tx logs: ${txHash}`, {
      ...options,
      isTransient: true,
      retryAfterMs: 5000,
      context: { ...options?.context, txHash },
    })
  }
}

/** Thrown when data cannot be parsed. */
export class CCIPDataParseError extends CCIPError {
  override readonly name = 'CCIPDataParseError'
  /** Creates a data parse error. */
  constructor(data: string, options?: CCIPErrorOptions) {
    const truncated = data.length > 66 ? `${data.slice(0, 66)}...` : data
    super(CCIPErrorCode.DATA_PARSE_FAILED, `Could not parse data: ${truncated}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, data },
    })
  }
}

/** Thrown when token not found in supported tokens list. */
export class CCIPTokenNotFoundError extends CCIPError {
  override readonly name = 'CCIPTokenNotFoundError'
  /** Creates a token not found error. */
  constructor(token: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.TOKEN_NOT_FOUND, `Token not found: ${token}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, token },
    })
  }
}

// Solana-specific (additional)

/** Thrown when router config not found at PDA. */
export class CCIPSolanaRouterConfigNotFoundError extends CCIPError {
  override readonly name = 'CCIPSolanaRouterConfigNotFoundError'
  /** Creates a Solana router config not found error. */
  constructor(configPda: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.SOLANA_ROUTER_CONFIG_NOT_FOUND, `Router config not found at ${configPda}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, configPda },
    })
  }
}

/** Thrown when fee result from router is invalid. */
export class CCIPSolanaFeeResultInvalidError extends CCIPError {
  override readonly name = 'CCIPSolanaFeeResultInvalidError'
  /** Creates a Solana fee result invalid error. */
  constructor(result: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.SOLANA_FEE_RESULT_INVALID, `Invalid fee result from router: ${result}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, result },
    })
  }
}

/** Thrown when token mint not found. */
export class CCIPTokenMintNotFoundError extends CCIPError {
  override readonly name = 'CCIPTokenMintNotFoundError'
  /** Creates a token mint not found error. */
  constructor(token: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.TOKEN_MINT_NOT_FOUND, `Mint ${token} not found`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, token },
    })
  }
}

/** Thrown when token amount is invalid. */
export class CCIPTokenAmountInvalidError extends CCIPError {
  override readonly name = 'CCIPTokenAmountInvalidError'
  /** Creates a token amount invalid error. */
  constructor(options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.TOKEN_AMOUNT_INVALID,
      'Invalid token amount: token address and positive amount required',
      {
        ...options,
        isTransient: false,
      },
    )
  }
}

/** Thrown when transaction not finalized after timeout. */
export class CCIPTransactionNotFinalizedError extends CCIPError {
  override readonly name = 'CCIPTransactionNotFinalizedError'
  /** Creates a transaction not finalized error. */
  constructor(signature: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.TRANSACTION_NOT_FINALIZED,
      `Transaction ${signature} not finalized after timeout`,
      {
        ...options,
        isTransient: true,
        retryAfterMs: 10000,
        context: { ...options?.context, signature },
      },
    )
  }
}

/** Thrown when CCTP event decode fails. */
export class CCIPCctpDecodeError extends CCIPError {
  override readonly name = 'CCIPCctpDecodeError'
  /** Creates a CCTP decode error. */
  constructor(log: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.CCTP_DECODE_FAILED, `Failed to decode CCTP event: ${log}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, log },
    })
  }
}

/** Thrown when Sui hasher version is unsupported. */
export class CCIPSuiHasherVersionUnsupportedError extends CCIPError {
  override readonly name = 'CCIPSuiHasherVersionUnsupportedError'
  /** Creates a Sui hasher version unsupported error. */
  constructor(version: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.HASHER_VERSION_UNSUPPORTED,
      `Unsupported hasher version for Sui: ${version}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, version },
      },
    )
  }
}

/** Thrown when Sui message version is invalid. */
export class CCIPSuiMessageVersionInvalidError extends CCIPError {
  override readonly name = 'CCIPSuiMessageVersionInvalidError'
  /** Creates a Sui message version invalid error. */
  constructor(options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.MESSAGE_VERSION_INVALID,
      'Invalid Sui message: only CCIP v1.6 format is supported',
      {
        ...options,
        isTransient: false,
      },
    )
  }
}

/** Thrown when Solana lane version is unsupported. */
export class CCIPSolanaLaneVersionUnsupportedError extends CCIPError {
  override readonly name = 'CCIPSolanaLaneVersionUnsupportedError'
  /** Creates a Solana lane version unsupported error. */
  constructor(version: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.LANE_VERSION_UNSUPPORTED, `Unsupported lane version: ${version}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, version },
    })
  }
}

/** Thrown when multiple CCTP events found in transaction. */
export class CCIPCctpMultipleEventsError extends CCIPError {
  override readonly name = 'CCIPCctpMultipleEventsError'
  /** Creates a CCTP multiple events error. */
  constructor(count: number, txSignature: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.CCTP_MULTIPLE_EVENTS,
      `Expected only 1 CcipCctpMessageSentEvent, found ${count} in transaction ${txSignature}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, count, txSignature },
      },
    )
  }
}

/** Thrown when compute units exceed limit. */
export class CCIPSolanaComputeUnitsExceededError extends CCIPError {
  override readonly name = 'CCIPSolanaComputeUnitsExceededError'
  /** Creates a compute units exceeded error. */
  constructor(simulated: number, limit: number, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.SOLANA_COMPUTE_UNITS_EXCEEDED,
      `Main simulation exceeds specified computeUnits limit. simulated=${simulated}, limit=${limit}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, simulated, limit },
      },
    )
  }
}

/** Thrown when Aptos hasher version is unsupported. */
export class CCIPAptosHasherVersionUnsupportedError extends CCIPError {
  override readonly name = 'CCIPAptosHasherVersionUnsupportedError'
  /** Creates an Aptos hasher version unsupported error. */
  constructor(version: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.APTOS_HASHER_VERSION_UNSUPPORTED,
      `Unsupported hasher version for Aptos: ${version}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, version },
      },
    )
  }
}
