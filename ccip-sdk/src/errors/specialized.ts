import { type CCIPErrorOptions, CCIPError } from './CCIPError.ts'
import { CCIPErrorCode } from './codes.ts'
import { isTransientHttpStatus } from '../http-status.ts'

// Chain/Network

/**
 * Thrown when chain not found by chainId, selector, or name.
 *
 * @example
 * ```typescript
 * import { networkInfo } from '@chainlink/ccip-sdk'
 *
 * try {
 *   const info = networkInfo(999999) // Unknown chain
 * } catch (error) {
 *   if (error instanceof CCIPChainNotFoundError) {
 *     console.log(`Chain not found: ${error.context.chainIdOrSelector}`)
 *     console.log(`Recovery: ${error.recovery}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when chain family is not supported.
 *
 * @example
 * ```typescript
 * try {
 *   const chain = await createChain('unsupported-family')
 * } catch (error) {
 *   if (error instanceof CCIPChainFamilyUnsupportedError) {
 *     console.log(`Unsupported family: ${error.context.family}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when a method or operation is not supported on a given implementation class.
 *
 * @example
 * ```typescript
 * try {
 *   await chain.someUnsupportedMethod()
 * } catch (error) {
 *   if (error instanceof CCIPMethodUnsupportedError) {
 *     console.log(`Method not supported: ${error.context.class}.${error.context.method}`)
 *   }
 * }
 * ```
 */
export class CCIPMethodUnsupportedError extends CCIPError {
  override readonly name = 'CCIPMethodUnsupportedError'
  /** Creates a method unsupported error. */
  constructor(klass: string, method: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.METHOD_UNSUPPORTED, `Unsupported method in class: ${klass}.${method}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, class: klass, method },
    })
  }
}

// Block & Transaction

/**
 * Thrown when block not found. Transient: block may not be indexed yet.
 *
 * @example
 * ```typescript
 * try {
 *   const timestamp = await chain.getBlockTimestamp(999999999)
 * } catch (error) {
 *   if (error instanceof CCIPBlockNotFoundError) {
 *     if (error.isTransient) {
 *       console.log(`Block not indexed yet, retry in ${error.retryAfterMs}ms`)
 *     }
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when transaction not found. Transient: tx may be pending.
 *
 * @example
 * ```typescript
 * try {
 *   const tx = await chain.getTransaction('0x1234...')
 * } catch (error) {
 *   if (error instanceof CCIPTransactionNotFoundError) {
 *     if (error.isTransient) {
 *       await sleep(error.retryAfterMs ?? 5000)
 *       // Retry the operation
 *     }
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when message format is invalid.
 *
 * @example
 * ```typescript
 * try {
 *   const message = EVMChain.decodeMessage(invalidLog)
 * } catch (error) {
 *   if (error instanceof CCIPMessageInvalidError) {
 *     console.log(`Invalid message format: ${error.message}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when no CCIPSendRequested event in tx. Transient: tx may not be indexed.
 *
 * @example
 * ```typescript
 * try {
 *   const messages = await chain.getMessagesInTx('0x1234...')
 * } catch (error) {
 *   if (error instanceof CCIPMessageNotFoundInTxError) {
 *     if (error.isTransient) {
 *       console.log(`Message not indexed yet, retry in ${error.retryAfterMs}ms`)
 *     }
 *   }
 * }
 * ```
 */
export class CCIPMessageNotFoundInTxError extends CCIPError {
  override readonly name = 'CCIPMessageNotFoundInTxError'
  /** Creates a message not found in transaction error. */
  constructor(txHash: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.MESSAGE_NOT_FOUND_IN_TX, `Could not find any CCIP request event in tx`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, txHash },
    })
  }
}

/**
 * Thrown when message with messageId not found. Transient: message may be in transit.
 *
 * @example
 * ```typescript
 * try {
 *   const request = await getMessageById(chain, messageId, onRamp)
 * } catch (error) {
 *   if (error instanceof CCIPMessageIdNotFoundError) {
 *     if (error.isTransient) {
 *       console.log(`Message in transit, retry in ${error.retryAfterMs}ms`)
 *     }
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when messageId format is invalid.
 *
 * @example
 * ```typescript
 * try {
 *   const request = await chain.getMessageById('invalid-format')
 * } catch (error) {
 *   if (error instanceof CCIPMessageIdValidationError) {
 *     console.log(`Invalid messageId: ${error.message}`)
 *     // Not transient - fix the messageId format
 *   }
 * }
 * ```
 */
export class CCIPMessageIdValidationError extends CCIPError {
  override readonly name = 'CCIPMessageIdValidationError'
  /** Creates a message ID validation error. */
  constructor(message: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.MESSAGE_ID_INVALID, message, {
      ...options,
      isTransient: false,
    })
  }
}

/**
 * Thrown when not all messages in batch were found. Transient: may still be indexing.
 *
 * @example
 * ```typescript
 * try {
 *   const messages = await getMessagesInBatch(chain, request, commit)
 * } catch (error) {
 *   if (error instanceof CCIPMessageBatchIncompleteError) {
 *     console.log(`Found ${error.context.foundSeqNums.length} of expected range`)
 *     if (error.isTransient) {
 *       await sleep(error.retryAfterMs ?? 30000)
 *     }
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when message not in expected batch.
 *
 * @example
 * ```typescript
 * try {
 *   const proof = calculateManualExecProof(messages, lane, messageId)
 * } catch (error) {
 *   if (error instanceof CCIPMessageNotInBatchError) {
 *     console.log(`Message ${error.context.messageId} not in batch range`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when message retrieval fails via both API and RPC.
 *
 * @example
 * ```typescript
 * try {
 *   const request = await chain.getMessageById('0xabc123...')
 * } catch (error) {
 *   if (error instanceof CCIPMessageRetrievalError) {
 *     console.log(`Failed to retrieve message: ${error.message}`)
 *     console.log(`Recovery: ${error.recovery}`)
 *   }
 * }
 * ```
 */
export class CCIPMessageRetrievalError extends CCIPError {
  override readonly name = 'CCIPMessageRetrievalError'
  /** Creates a message retrieval error with both API and RPC failure context. */
  constructor(
    messageId: string,
    apiError: CCIPError | undefined,
    rpcError: CCIPError | undefined,
    options?: CCIPErrorOptions,
  ) {
    const apiMsg = apiError?.message ?? 'API disabled or not attempted'
    const rpcMsg = rpcError?.message ?? 'RPC not configured'
    super(
      CCIPErrorCode.MESSAGE_RETRIEVAL_FAILED,
      `Failed to retrieve message ${messageId} via API and RPC.\n  API: ${apiMsg}\n  RPC: ${rpcMsg}`,
      {
        ...options,
        isTransient: (apiError?.isTransient ?? false) || (rpcError?.isTransient ?? false),
        retryAfterMs: apiError?.retryAfterMs ?? rpcError?.retryAfterMs,
        recovery:
          'Verify the message ID is correct. If using --id-from-source, configure an RPC for on-chain lookup or wait for API indexing.',
        context: {
          ...options?.context,
          messageId,
          apiError: apiError?.message,
          rpcError: rpcError?.message,
        },
      },
    )
  }
}

// Lane & Routing

/**
 * Thrown when no offRamp found for lane.
 *
 * @example
 * ```typescript
 * try {
 *   const offRamp = await discoverOffRamp(source, dest, request)
 * } catch (error) {
 *   if (error instanceof CCIPOffRampNotFoundError) {
 *     console.log(`No offRamp for ${error.context.onRamp} on ${error.context.destNetwork}`)
 *     console.log(`Recovery: ${error.recovery}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when onRamp required but not provided.
 *
 * @example
 * ```typescript
 * try {
 *   const lane = await chain.getLaneForOnRamp(undefined)
 * } catch (error) {
 *   if (error instanceof CCIPOnRampRequiredError) {
 *     console.log('onRamp address is required for this operation')
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when lane not found between source and destination chains.
 *
 * @example
 * ```typescript
 * try {
 *   const lane = await discoverLane(sourceChainSelector, destChainSelector)
 * } catch (error) {
 *   if (error instanceof CCIPLaneNotFoundError) {
 *     console.log(`No lane: ${error.context.sourceChainSelector} → ${error.context.destChainSelector}`)
 *   }
 * }
 * ```
 */
export class CCIPLaneNotFoundError extends CCIPError {
  override readonly name = 'CCIPLaneNotFoundError'
  /** Creates a lane not found error. */
  constructor(sourceChainSelector: bigint, destChainSelector: bigint, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.LANE_NOT_FOUND,
      `Lane not found: ${sourceChainSelector} → ${destChainSelector}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, sourceChainSelector, destChainSelector },
      },
    )
  }
}

// Commit & Merkle

/**
 * Thrown when commit report not found. Transient: DON may not have committed yet.
 *
 * @example
 * ```typescript
 * try {
 *   const verifications = await chain.getVerifications({ offRamp, request })
 * } catch (error) {
 *   if (error instanceof CCIPCommitNotFoundError) {
 *     if (error.isTransient) {
 *       console.log(`Commit pending, retry in ${error.retryAfterMs}ms`)
 *     }
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when merkle root verification fails.
 *
 * @example
 * ```typescript
 * try {
 *   const proof = calculateManualExecProof(messages, lane, messageId, merkleRoot)
 * } catch (error) {
 *   if (error instanceof CCIPMerkleRootMismatchError) {
 *     console.log(`Root mismatch: expected=${error.context.expected}, got=${error.context.got}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when attempting to create tree without leaves.
 *
 * @example
 * ```typescript
 * try {
 *   const root = createMerkleTree([])
 * } catch (error) {
 *   if (error instanceof CCIPMerkleTreeEmptyError) {
 *     console.log('Cannot create merkle tree without messages')
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when CCIP version not supported.
 *
 * @example
 * ```typescript
 * try {
 *   const [type, version] = await chain.typeAndVersion(contractAddress)
 * } catch (error) {
 *   if (error instanceof CCIPVersionUnsupportedError) {
 *     console.log(`Version ${error.context.version} not supported`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when hasher version not supported for chain.
 *
 * @example
 * ```typescript
 * try {
 *   const hasher = getLeafHasher(lane)
 * } catch (error) {
 *   if (error instanceof CCIPHasherVersionUnsupportedError) {
 *     console.log(`Hasher not available for ${error.context.chain} v${error.context.version}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when extraArgs cannot be parsed.
 *
 * @example
 * ```typescript
 * try {
 *   const args = decodeExtraArgs(invalidData)
 * } catch (error) {
 *   if (error instanceof CCIPExtraArgsParseError) {
 *     console.log(`Cannot parse extraArgs: ${error.context.from}`)
 *   }
 * }
 * ```
 */
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
 *
 * @example
 * ```typescript
 * try {
 *   const encoded = encodeExtraArgs({ gasLimit: -1n }, 'EVM')
 * } catch (error) {
 *   if (error instanceof CCIPExtraArgsInvalidError) {
 *     console.log(`Invalid extraArgs for ${error.context.chainFamily}`)
 *   }
 * }
 * ```
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

/**
 * Thrown when token not found in registry.
 *
 * @example
 * ```typescript
 * try {
 *   const config = await chain.getRegistryTokenConfig(registry, tokenAddress)
 * } catch (error) {
 *   if (error instanceof CCIPTokenNotInRegistryError) {
 *     console.log(`Token ${error.context.token} not in ${error.context.registry}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when token not configured in registry.
 *
 * @example
 * ```typescript
 * try {
 *   const pool = await chain.getTokenPoolConfigs(tokenPool)
 * } catch (error) {
 *   if (error instanceof CCIPTokenNotConfiguredError) {
 *     console.log(`Token ${error.context.token} not configured`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when destination token decimals insufficient.
 *
 * @example
 * ```typescript
 * try {
 *   const amounts = await sourceToDestTokenAmounts(source, dest, tokenAmounts)
 * } catch (error) {
 *   if (error instanceof CCIPTokenDecimalsInsufficientError) {
 *     console.log(`Cannot express ${error.context.amount} with ${error.context.destDecimals} decimals`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when contract type is not as expected.
 *
 * @example
 * ```typescript
 * try {
 *   const router = await chain.getRouterForOnRamp(address)
 * } catch (error) {
 *   if (error instanceof CCIPContractTypeInvalidError) {
 *     console.log(`${error.context.address} is "${error.context.actualType}", expected ${error.context.expectedTypes}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when wallet must be Signer but isn't.
 *
 * @example
 * ```typescript
 * try {
 *   await chain.sendMessage({ ...opts, wallet: provider })
 * } catch (error) {
 *   if (error instanceof CCIPWalletNotSignerError) {
 *     console.log('Wallet must be a Signer to send transactions')
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when exec tx not confirmed. Transient: may need more time.
 *
 * @example
 * ```typescript
 * try {
 *   await chain.execute({ offRamp, input, wallet })
 * } catch (error) {
 *   if (error instanceof CCIPExecTxNotConfirmedError) {
 *     if (error.isTransient) {
 *       await sleep(error.retryAfterMs ?? 5000)
 *     }
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when exec tx reverted.
 *
 * @example
 * ```typescript
 * try {
 *   await chain.execute({ offRamp, input, wallet })
 * } catch (error) {
 *   if (error instanceof CCIPExecTxRevertedError) {
 *     console.log(`Execution reverted: ${error.context.txHash}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when USDC attestation fetch fails. Transient: attestation may not be ready.
 *
 * @example
 * ```typescript
 * try {
 *   const offchainData = await chain.getOffchainTokenData(request)
 * } catch (error) {
 *   if (error instanceof CCIPUsdcAttestationError) {
 *     if (error.isTransient) {
 *       console.log(`USDC attestation pending, retry in ${error.retryAfterMs}ms`)
 *     }
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when LBTC attestation fetch fails. Transient: attestation may not be ready.
 *
 * @example
 * ```typescript
 * try {
 *   const offchainData = await chain.getOffchainTokenData(request)
 * } catch (error) {
 *   if (error instanceof CCIPLbtcAttestationError) {
 *     if (error.isTransient) {
 *       console.log(`LBTC attestation pending, retry in ${error.retryAfterMs}ms`)
 *     }
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when LBTC attestation not found for payload hash. Transient: may not be processed yet.
 *
 * @example
 * ```typescript
 * try {
 *   const offchainData = await chain.getOffchainTokenData(request)
 * } catch (error) {
 *   if (error instanceof CCIPLbtcAttestationNotFoundError) {
 *     console.log(`Attestation not found for hash: ${error.context.payloadHash}`)
 *     if (error.isTransient) {
 *       await sleep(error.retryAfterMs ?? 30000)
 *     }
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when LBTC attestation is not yet approved. Transient: may be pending notarization.
 *
 * @example
 * ```typescript
 * try {
 *   const offchainData = await chain.getOffchainTokenData(request)
 * } catch (error) {
 *   if (error instanceof CCIPLbtcAttestationNotApprovedError) {
 *     console.log(`Attestation pending approval for: ${error.context.payloadHash}`)
 *     if (error.isTransient) {
 *       await sleep(error.retryAfterMs ?? 30000)
 *     }
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when lookup table not found. Transient: may not be synced yet.
 *
 * @example
 * ```typescript
 * try {
 *   const lookupTable = await solanaChain.getLookupTable(address)
 * } catch (error) {
 *   if (error instanceof CCIPSolanaLookupTableNotFoundError) {
 *     if (error.isTransient) {
 *       console.log(`Lookup table not synced, retry in ${error.retryAfterMs}ms`)
 *     }
 *   }
 * }
 * ```
 */
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

/**
 * Thrown for invalid Aptos transaction hash or version.
 *
 * @example
 * ```typescript
 * try {
 *   const tx = await aptosChain.getTransaction('invalid-hash')
 * } catch (error) {
 *   if (error instanceof CCIPAptosTransactionInvalidError) {
 *     console.log(`Invalid tx: ${error.context.hashOrVersion}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown for HTTP errors. Transient if 429 or 5xx.
 *
 * @example
 * ```typescript
 * try {
 *   const latency = await chain.getLaneLatency(destChainSelector)
 * } catch (error) {
 *   if (error instanceof CCIPHttpError) {
 *     console.log(`HTTP ${error.context.status}: ${error.context.statusText}`)
 *     if (error.isTransient) {
 *       // 429 or 5xx - safe to retry
 *     }
 *   }
 * }
 * ```
 */
export class CCIPHttpError extends CCIPError {
  override readonly name = 'CCIPHttpError'
  /** Creates an HTTP error. */
  constructor(status: number, statusText: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.HTTP_ERROR, `HTTP ${status}: ${statusText}`, {
      ...options,
      isTransient: isTransientHttpStatus(status),
      context: { ...options?.context, status, statusText },
    })
  }
}

/**
 * Thrown when a request times out. Transient: network may recover.
 *
 * @example
 * ```typescript
 * try {
 *   const tx = await chain.getTransaction('0x1234...')
 * } catch (error) {
 *   if (error instanceof CCIPTimeoutError) {
 *     console.log(`Operation timed out: ${error.context.operation}`)
 *     if (error.isTransient) {
 *       console.log(`Retry in ${error.retryAfterMs}ms`)
 *     }
 *   }
 * }
 * ```
 */
export class CCIPTimeoutError extends CCIPError {
  override readonly name = 'CCIPTimeoutError'
  /** Creates a timeout error. */
  constructor(operation: string, timeoutMs: number, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.TIMEOUT, `Request timed out after ${timeoutMs}ms: ${operation}`, {
      ...options,
      isTransient: true,
      retryAfterMs: 5000,
      context: { ...options?.context, operation, timeoutMs },
    })
  }
}

/**
 * Thrown for not implemented features.
 *
 * @example
 * ```typescript
 * try {
 *   await chain.someUnimplementedMethod()
 * } catch (error) {
 *   if (error instanceof CCIPNotImplementedError) {
 *     console.log(`Feature not implemented: ${error.context.feature}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when data format is not supported.
 *
 * @example
 * ```typescript
 * try {
 *   const parsed = parseData(unknownFormat)
 * } catch (error) {
 *   if (error instanceof CCIPDataFormatUnsupportedError) {
 *     console.log(`Unsupported format: ${error.context.data}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when typeAndVersion string cannot be parsed.
 *
 * @example
 * ```typescript
 * try {
 *   const [type, version] = await chain.typeAndVersion(contractAddress)
 * } catch (error) {
 *   if (error instanceof CCIPTypeVersionInvalidError) {
 *     console.log(`Cannot parse: ${error.context.typeAndVersion}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when no block found before timestamp.
 *
 * @example
 * ```typescript
 * try {
 *   const block = await chain.getBlockBeforeTimestamp(timestamp)
 * } catch (error) {
 *   if (error instanceof CCIPBlockBeforeTimestampNotFoundError) {
 *     console.log(`No block before timestamp: ${error.context.timestamp}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when message decoding fails.
 *
 * @example
 * ```typescript
 * try {
 *   const message = EVMChain.decodeMessage(log)
 * } catch (error) {
 *   if (error instanceof CCIPMessageDecodeError) {
 *     console.log(`Decode failed: ${error.context.reason}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when network family is not supported for an operation.
 *
 * @example
 * ```typescript
 * try {
 *   const chain = await Chain.fromUrl(rpcUrl)
 * } catch (error) {
 *   if (error instanceof CCIPNetworkFamilyUnsupportedError) {
 *     console.log(`Unsupported family: ${error.context.family}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when RPC endpoint not found.
 *
 * @example
 * ```typescript
 * try {
 *   const chain = await EVMChain.fromUrl(rpcUrl)
 * } catch (error) {
 *   if (error instanceof CCIPRpcNotFoundError) {
 *     console.log(`No RPC for chainId: ${error.context.chainId}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when logs not found for filter criteria. Transient: logs may not be indexed yet.
 *
 * @example
 * ```typescript
 * try {
 *   const logs = await chain.getLogs(filter)
 * } catch (error) {
 *   if (error instanceof CCIPLogsNotFoundError) {
 *     if (error.isTransient) {
 *       await sleep(error.retryAfterMs ?? 5000)
 *     }
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when log topics not found.
 *
 * @example
 * ```typescript
 * try {
 *   const logs = await chain.getLogs({ topics: ['0xunknown'] })
 * } catch (error) {
 *   if (error instanceof CCIPLogTopicsNotFoundError) {
 *     console.log(`Topics not matched: ${error.context.topics}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when trying to `watch` logs but giving a fixed `endBlock`.
 *
 * @example
 * ```typescript
 * try {
 *   await chain.watchLogs({ endBlock: 1000 }) // Fixed endBlock not allowed
 * } catch (error) {
 *   if (error instanceof CCIPLogsWatchRequiresFinalityError) {
 *     console.log('Use "latest" or "finalized" for endBlock in watch mode')
 *   }
 * }
 * ```
 */
export class CCIPLogsWatchRequiresFinalityError extends CCIPError {
  override readonly name = 'CCIPLogsWatchRequiresFinalityError'
  /** Creates a logs watch requires finality error. */
  constructor(endBlock?: number | string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.LOGS_WATCH_REQUIRES_FINALITY,
      `Watch mode requires finality config for endBlock (latest, finalized or block depth=negative)`,
      { ...options, isTransient: false, context: { ...options?.context, endBlock } },
    )
  }
}

/**
 * Thrown when trying to `watch` logs but no start position provided.
 *
 * @example
 * ```typescript
 * try {
 *   await chain.watchLogs({}) // Missing startBlock or startTime
 * } catch (error) {
 *   if (error instanceof CCIPLogsWatchRequiresStartError) {
 *     console.log('Provide startBlock or startTime for watch mode')
 *   }
 * }
 * ```
 */
export class CCIPLogsWatchRequiresStartError extends CCIPError {
  override readonly name = 'CCIPLogsWatchRequiresStartError'
  /** Creates a logs watch requires start error. */
  constructor(options?: CCIPErrorOptions) {
    super(CCIPErrorCode.LOGS_WATCH_REQUIRES_START, `Watch mode requires startBlock or startTime`, {
      ...options,
      isTransient: false,
    })
  }
}

/**
 * Thrown when address is required for logs filtering, but not provided.
 *
 * @example
 * ```typescript
 * try {
 *   await chain.getLogs({ topics: [...] }) // Missing address
 * } catch (error) {
 *   if (error instanceof CCIPLogsAddressRequiredError) {
 *     console.log('Contract address is required for this chain')
 *   }
 * }
 * ```
 */
export class CCIPLogsAddressRequiredError extends CCIPError {
  override readonly name = 'CCIPLogsAddressRequiredError'
  /** Creates a Solana program address required error. */
  constructor(options?: CCIPErrorOptions) {
    super(CCIPErrorCode.LOGS_ADDRESS_REQUIRED, 'Address is required for logs filtering', {
      ...options,
      isTransient: false,
    })
  }
}

// Chain Family

/**
 * Thrown when network family does not match expected for a Chain constructor.
 *
 * @example
 * ```typescript
 * try {
 *   const chain = new EVMChain(provider, solanaNetworkInfo) // Wrong family
 * } catch (error) {
 *   if (error instanceof CCIPChainFamilyMismatchError) {
 *     console.log(`Expected ${error.context.expected}, got ${error.context.actual}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when legacy (pre-1.5) token pools are not supported.
 *
 * @example
 * ```typescript
 * try {
 *   await chain.getTokenPoolConfigs(legacyPool)
 * } catch (error) {
 *   if (error instanceof CCIPLegacyTokenPoolsUnsupportedError) {
 *     console.log('Upgrade to CCIP v1.5+ token pools')
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when merkle proof is empty.
 *
 * @example
 * ```typescript
 * try {
 *   verifyMerkleProof({ leaves: [], proofs: [] })
 * } catch (error) {
 *   if (error instanceof CCIPMerkleProofEmptyError) {
 *     console.log('Cannot verify empty merkle proof')
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when merkle leaves or proofs exceed max limit.
 *
 * @example
 * ```typescript
 * try {
 *   verifyMerkleProof({ leaves: largeArray, proofs })
 * } catch (error) {
 *   if (error instanceof CCIPMerkleProofTooLargeError) {
 *     console.log(`Proof exceeds limit: ${error.context.limit}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when total hashes exceed max merkle tree size.
 *
 * @example
 * ```typescript
 * try {
 *   createMerkleTree(hashes)
 * } catch (error) {
 *   if (error instanceof CCIPMerkleHashesTooLargeError) {
 *     console.log(`${error.context.totalHashes} exceeds limit ${error.context.limit}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when source flags count does not match expected total.
 *
 * @example
 * ```typescript
 * try {
 *   verifyMerkleProof({ hashes, sourceFlags })
 * } catch (error) {
 *   if (error instanceof CCIPMerkleFlagsMismatchError) {
 *     console.log(`Hashes: ${error.context.totalHashes}, Flags: ${error.context.flagsLength}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when proof source flags count does not match proof hashes.
 *
 * @example
 * ```typescript
 * try {
 *   verifyMerkleProof({ sourceFlags, proofs })
 * } catch (error) {
 *   if (error instanceof CCIPMerkleProofFlagsMismatchError) {
 *     console.log(`Flags: ${error.context.sourceProofCount}, Proofs: ${error.context.proofsLength}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when not all proofs were consumed during verification.
 *
 * @example
 * ```typescript
 * try {
 *   verifyMerkleProof({ leaves, proofs, root })
 * } catch (error) {
 *   if (error instanceof CCIPMerkleProofIncompleteError) {
 *     console.log('Merkle proof verification incomplete')
 *   }
 * }
 * ```
 */
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

/**
 * Thrown on internal merkle computation error.
 *
 * @example
 * ```typescript
 * try {
 *   computeMerkleRoot(hashes)
 * } catch (error) {
 *   if (error instanceof CCIPMerkleInternalError) {
 *     console.log(`Internal merkle error: ${error.message}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when EVM address is invalid.
 *
 * @example
 * ```typescript
 * try {
 *   EVMChain.getAddress('not-an-address')
 * } catch (error) {
 *   if (error instanceof CCIPAddressInvalidEvmError) {
 *     console.log(`Invalid address: ${error.context.address}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when CCIP version requires lane info.
 *
 * @example
 * ```typescript
 * try {
 *   EVMChain.decodeCommits(log) // Missing lane for v1.6
 * } catch (error) {
 *   if (error instanceof CCIPVersionRequiresLaneError) {
 *     console.log(`Version ${error.context.version} requires lane parameter`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when version feature is unavailable.
 *
 * @example
 * ```typescript
 * try {
 *   await chain.getFeature(oldVersion)
 * } catch (error) {
 *   if (error instanceof CCIPVersionFeatureUnavailableError) {
 *     console.log(`${error.context.feature} requires v${error.context.minVersion}+`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when contract is not a Router or expected CCIP contract.
 *
 * @example
 * ```typescript
 * try {
 *   await chain.getRouterForOnRamp(address)
 * } catch (error) {
 *   if (error instanceof CCIPContractNotRouterError) {
 *     console.log(`${error.context.address} is "${error.context.typeAndVersion}"`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when log data is invalid.
 *
 * @example
 * ```typescript
 * try {
 *   const message = EVMChain.decodeMessage(log)
 * } catch (error) {
 *   if (error instanceof CCIPLogDataInvalidError) {
 *     console.log(`Invalid log data: ${error.context.data}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when wallet is not a valid signer.
 *
 * @example
 * ```typescript
 * try {
 *   await chain.sendMessage({ ...opts, wallet: invalidWallet })
 * } catch (error) {
 *   if (error instanceof CCIPWalletInvalidError) {
 *     console.log('Provide a valid signer wallet')
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when source chain is unsupported for EVM hasher.
 *
 * @example
 * ```typescript
 * try {
 *   const hasher = chain.getDestLeafHasher(lane)
 * } catch (error) {
 *   if (error instanceof CCIPSourceChainUnsupportedError) {
 *     console.log(`Unsupported source: ${error.context.chainSelector}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when block time cannot be retrieved for a slot. Transient: slot may not be indexed.
 *
 * @example
 * ```typescript
 * try {
 *   const timestamp = await solanaChain.getBlockTimestamp(slot)
 * } catch (error) {
 *   if (error instanceof CCIPBlockTimeNotFoundError) {
 *     if (error.isTransient) {
 *       await sleep(error.retryAfterMs ?? 5000)
 *     }
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when topics are not valid strings.
 *
 * @example
 * ```typescript
 * try {
 *   await chain.getLogs({ topics: [123] }) // Invalid topic type
 * } catch (error) {
 *   if (error instanceof CCIPTopicsInvalidError) {
 *     console.log('Topics must be string values')
 *   }
 * }
 * ```
 */
export class CCIPTopicsInvalidError extends CCIPError {
  override readonly name = 'CCIPTopicsInvalidError'
  /** Creates a Solana topics invalid error. */
  constructor(topics: unknown[], options?: CCIPErrorOptions) {
    super(CCIPErrorCode.TOPICS_INVALID, `event topics must be string values`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, topics },
    })
  }
}

/**
 * Thrown when reference addresses account not found for offRamp. Transient: may not be synced.
 *
 * @example
 * ```typescript
 * try {
 *   await solanaChain.getOffRampForRouter(router)
 * } catch (error) {
 *   if (error instanceof CCIPSolanaRefAddressesNotFoundError) {
 *     if (error.isTransient) {
 *       await sleep(error.retryAfterMs ?? 5000)
 *     }
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when OffRamp events not found in feeQuoter transactions. Transient: events may not be indexed.
 *
 * @example
 * ```typescript
 * try {
 *   await solanaChain.getOffRampsForRouter(router)
 * } catch (error) {
 *   if (error instanceof CCIPSolanaOffRampEventsNotFoundError) {
 *     if (error.isTransient) {
 *       await sleep(error.retryAfterMs ?? 10000)
 *     }
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when token pool info not found.
 *
 * @example
 * ```typescript
 * try {
 *   await chain.getTokenPoolConfigs(tokenPool)
 * } catch (error) {
 *   if (error instanceof CCIPTokenPoolInfoNotFoundError) {
 *     console.log(`TokenPool not found: ${error.context.tokenPool}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when SPL token is invalid or not Token-2022.
 *
 * @example
 * ```typescript
 * try {
 *   await solanaChain.getTokenInfo(tokenAddress)
 * } catch (error) {
 *   if (error instanceof CCIPSplTokenInvalidError) {
 *     console.log(`Invalid SPL token: ${error.context.token}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when token data cannot be parsed.
 *
 * @example
 * ```typescript
 * try {
 *   await chain.getTokenInfo(tokenAddress)
 * } catch (error) {
 *   if (error instanceof CCIPTokenDataParseError) {
 *     console.log(`Cannot parse token: ${error.context.token}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when EVMExtraArgsV2 has unsupported length.
 *
 * @example
 * ```typescript
 * try {
 *   SolanaChain.decodeExtraArgs(data)
 * } catch (error) {
 *   if (error instanceof CCIPExtraArgsLengthInvalidError) {
 *     console.log(`Unsupported length: ${error.context.length}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when Solana can only encode EVMExtraArgsV2 but got different args.
 *
 * @example
 * ```typescript
 * try {
 *   SolanaChain.encodeExtraArgs(unsupportedArgs)
 * } catch (error) {
 *   if (error instanceof CCIPSolanaExtraArgsEncodingError) {
 *     console.log('Use EVMExtraArgsV2 format for Solana')
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when log data is missing or not a string.
 *
 * @example
 * ```typescript
 * try {
 *   const message = Chain.decodeMessage(log)
 * } catch (error) {
 *   if (error instanceof CCIPLogDataMissingError) {
 *     console.log('Log data is missing or invalid')
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when ExecutionState is invalid.
 *
 * @example
 * ```typescript
 * try {
 *   const receipt = Chain.decodeReceipt(log)
 * } catch (error) {
 *   if (error instanceof CCIPExecutionStateInvalidError) {
 *     console.log(`Invalid state: ${error.context.state}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when execution report message is not for the expected chain.
 *
 * @example
 * ```typescript
 * try {
 *   await chain.execute({ offRamp, input, wallet })
 * } catch (error) {
 *   if (error instanceof CCIPExecutionReportChainMismatchError) {
 *     console.log(`Message not for ${error.context.chain}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when token pool state PDA not found.
 *
 * @example
 * ```typescript
 * try {
 *   await solanaChain.getTokenPoolConfigs(tokenPool)
 * } catch (error) {
 *   if (error instanceof CCIPTokenPoolStateNotFoundError) {
 *     console.log(`State not found at: ${error.context.tokenPool}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when ChainConfig not found for token pool and remote chain.
 *
 * @example
 * ```typescript
 * try {
 *   await chain.getTokenPoolRemotes(tokenPool, destChainSelector)
 * } catch (error) {
 *   if (error instanceof CCIPTokenPoolChainConfigNotFoundError) {
 *     console.log(`No config for ${error.context.remoteNetwork}`)
 *   }
 * }
 * ```
 */
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
      CCIPErrorCode.TOKEN_REMOTE_NOT_CONFIGURED,
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

/**
 * Thrown when Aptos network is unknown.
 *
 * @example
 * ```typescript
 * try {
 *   const chain = await AptosChain.fromUrl('https://unknown-network')
 * } catch (error) {
 *   if (error instanceof CCIPAptosNetworkUnknownError) {
 *     console.log(`Unknown network: ${error.context.url}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when Aptos transaction type is invalid.
 *
 * @example
 * ```typescript
 * try {
 *   await aptosChain.getMessagesInTx(txHash)
 * } catch (error) {
 *   if (error instanceof CCIPAptosTransactionTypeInvalidError) {
 *     console.log('Expected user_transaction type')
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when Aptos registry type is invalid.
 *
 * @example
 * ```typescript
 * try {
 *   await aptosChain.getTokenAdminRegistryFor(registry)
 * } catch (error) {
 *   if (error instanceof CCIPAptosRegistryTypeInvalidError) {
 *     console.log(`Expected TokenAdminRegistry, got: ${error.context.actualType}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when Aptos log data is invalid.
 *
 * @example
 * ```typescript
 * try {
 *   const message = AptosChain.decodeMessage(log)
 * } catch (error) {
 *   if (error instanceof CCIPAptosLogInvalidError) {
 *     console.log(`Invalid log: ${error.context.log}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when Aptos address is invalid.
 *
 * @example
 * ```typescript
 * import { CCIPDataFormatUnsupportedError } from '@chainlink/ccip-sdk'
 *
 * try {
 *   AptosChain.getAddress('invalid-address')
 * } catch (error) {
 *   if (error instanceof CCIPDataFormatUnsupportedError) {
 *     console.log(`Invalid address: ${error.message}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when Aptos can only encode specific extra args types.
 *
 * @example
 * ```typescript
 * try {
 *   AptosChain.encodeExtraArgs(unsupportedArgs)
 * } catch (error) {
 *   if (error instanceof CCIPAptosExtraArgsEncodingError) {
 *     console.log('Use EVMExtraArgsV2 or SVMExtraArgsV1 for Aptos')
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when Aptos wallet is invalid.
 *
 * @example
 * ```typescript
 * try {
 *   await aptosChain.sendMessage({ ...opts, wallet: invalidWallet })
 * } catch (error) {
 *   if (error instanceof CCIPAptosWalletInvalidError) {
 *     console.log('Provide a valid Aptos account wallet')
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when Aptos expects EVMExtraArgsV2 reports.
 *
 * @example
 * ```typescript
 * try {
 *   await aptosChain.execute({ offRamp, input, wallet })
 * } catch (error) {
 *   if (error instanceof CCIPAptosExtraArgsV2RequiredError) {
 *     console.log('Aptos requires EVMExtraArgsV2 format')
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when token is not registered in Aptos registry.
 *
 * @example
 * ```typescript
 * try {
 *   await aptosChain.getRegistryTokenConfig(registry, token)
 * } catch (error) {
 *   if (error instanceof CCIPAptosTokenNotRegisteredError) {
 *     console.log(`Token ${error.context.token} not in registry`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown for unexpected Aptos transaction type.
 *
 * @example
 * ```typescript
 * try {
 *   await aptosChain.getTransaction(txHash)
 * } catch (error) {
 *   if (error instanceof CCIPAptosTransactionTypeUnexpectedError) {
 *     console.log(`Unexpected type: ${error.context.type}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when Aptos address with module is required.
 *
 * @example
 * ```typescript
 * try {
 *   await aptosChain.getLogs({ address: '0x1' }) // Missing module
 * } catch (error) {
 *   if (error instanceof CCIPAptosAddressModuleRequiredError) {
 *     console.log('Provide address with module name')
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when Aptos topic is invalid.
 *
 * @example
 * ```typescript
 * try {
 *   await aptosChain.getLogs({ topics: ['invalid'] })
 * } catch (error) {
 *   if (error instanceof CCIPAptosTopicInvalidError) {
 *     console.log(`Invalid topic: ${error.context.topic}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when Borsh type is unknown.
 *
 * @example
 * ```typescript
 * try {
 *   decodeBorsh(data, 'UnknownType')
 * } catch (error) {
 *   if (error instanceof CCIPBorshTypeUnknownError) {
 *     console.log(`Unknown type: ${error.context.name}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when Borsh method is unknown.
 *
 * @example
 * ```typescript
 * try {
 *   callBorshMethod('unknownMethod')
 * } catch (error) {
 *   if (error instanceof CCIPBorshMethodUnknownError) {
 *     console.log(`Unknown method: ${error.context.method}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when CLI argument is invalid.
 *
 * @example
 * ```typescript
 * try {
 *   parseArguments(['--invalid-arg'])
 * } catch (error) {
 *   if (error instanceof CCIPArgumentInvalidError) {
 *     console.log(`${error.context.argument}: ${error.context.reason}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when execution receipt not found in tx logs. Transient: receipt may not be indexed yet.
 *
 * @example
 * ```typescript
 * try {
 *   const receipt = await chain.getExecutionReceiptInTx(txHash)
 * } catch (error) {
 *   if (error instanceof CCIPReceiptNotFoundError) {
 *     if (error.isTransient) {
 *       await sleep(error.retryAfterMs ?? 5000)
 *     }
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when data cannot be parsed.
 *
 * @example
 * ```typescript
 * try {
 *   const parsed = Chain.parse(data)
 * } catch (error) {
 *   if (error instanceof CCIPDataParseError) {
 *     console.log(`Parse failed for: ${error.context.data}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when token not found in supported tokens list.
 *
 * @example
 * ```typescript
 * try {
 *   const tokens = await chain.getSupportedTokens(router, destChainSelector)
 * } catch (error) {
 *   if (error instanceof CCIPTokenNotFoundError) {
 *     console.log(`Token not found: ${error.context.token}`)
 *   }
 * }
 * ```
 */
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

/** Thrown when account has insufficient balance for operation. */
export class CCIPInsufficientBalanceError extends CCIPError {
  override readonly name = 'CCIPInsufficientBalanceError'
  /** Creates an insufficient balance error. */
  constructor(have: string, need: string, symbol: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.INSUFFICIENT_BALANCE,
      `Insufficient balance: have ${have} ${symbol}, need ${need} ${symbol}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, have, need, symbol },
      },
    )
  }
}

// Solana-specific (additional)

/**
 * Thrown when router config not found at PDA.
 *
 * @example
 * ```typescript
 * try {
 *   await solanaChain.getOnRampForRouter(router, destChainSelector)
 * } catch (error) {
 *   if (error instanceof CCIPSolanaRouterConfigNotFoundError) {
 *     console.log(`Config not found at: ${error.context.configPda}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when fee result from router is invalid.
 *
 * @example
 * ```typescript
 * try {
 *   const fee = await solanaChain.getFee(router, message)
 * } catch (error) {
 *   if (error instanceof CCIPSolanaFeeResultInvalidError) {
 *     console.log(`Invalid fee result: ${error.context.result}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when token mint not found.
 *
 * @example
 * ```typescript
 * try {
 *   await solanaChain.getTokenInfo(mintAddress)
 * } catch (error) {
 *   if (error instanceof CCIPTokenMintNotFoundError) {
 *     console.log(`Mint not found: ${error.context.token}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when token mint exists but is not a valid SPL token (wrong owner program).
 *
 * @example
 * ```typescript
 * try {
 *   const tokenInfo = await solanaChain.getTokenInfo(mintAddress)
 * } catch (error) {
 *   if (error instanceof CCIPTokenMintInvalidError) {
 *     console.log(`Invalid mint: ${error.context.token}`)
 *     console.log(`Owner: ${error.context.actualOwner}`)
 *     console.log(`Expected: ${error.context.expectedOwners.join(' or ')}`)
 *   }
 * }
 * ```
 */
export class CCIPTokenMintInvalidError extends CCIPError {
  override readonly name = 'CCIPTokenMintInvalidError'
  /** Creates a token mint invalid error. */
  constructor(
    token: string,
    actualOwner: string,
    expectedOwners: string[],
    options?: CCIPErrorOptions,
  ) {
    super(
      CCIPErrorCode.TOKEN_MINT_INVALID,
      `Token ${token} is not a valid SPL token mint. ` +
        `Account is owned by ${actualOwner}, but expected one of: ${expectedOwners.join(' or ')}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, token, actualOwner, expectedOwners },
      },
    )
  }
}

/**
 * Thrown when token amount is invalid.
 *
 * @example
 * ```typescript
 * try {
 *   await chain.sendMessage({ tokenAmounts: [{ token: '', amount: 0n }] })
 * } catch (error) {
 *   if (error instanceof CCIPTokenAmountInvalidError) {
 *     console.log('Token address and positive amount required')
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when token account (e.g., Solana ATA) does not exist for holder.
 *
 * @example
 * ```typescript
 * try {
 *   const balance = await solanaChain.getBalance({ address: holder, token: mint })
 * } catch (error) {
 *   if (error instanceof CCIPTokenAccountNotFoundError) {
 *     console.log(`No ATA for token ${error.context.token}`)
 *     console.log(`Holder: ${error.context.holder}`)
 *   }
 * }
 * ```
 */
export class CCIPTokenAccountNotFoundError extends CCIPError {
  override readonly name = 'CCIPTokenAccountNotFoundError'
  /** Creates a token account not found error. */
  constructor(token: string, holder: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.TOKEN_ACCOUNT_NOT_FOUND,
      `Token account not found for token ${token} and holder ${holder}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, token, holder },
      },
    )
  }
}

/**
 * Thrown when transaction not finalized after timeout. Transient: may need more time.
 *
 * @example
 * ```typescript
 * try {
 *   await chain.waitFinalized(txHash)
 * } catch (error) {
 *   if (error instanceof CCIPTransactionNotFinalizedError) {
 *     if (error.isTransient) {
 *       await sleep(error.retryAfterMs ?? 10000)
 *     }
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when CCTP event decode fails.
 *
 * @example
 * ```typescript
 * try {
 *   const cctpData = decodeCctpEvent(log)
 * } catch (error) {
 *   if (error instanceof CCIPCctpDecodeError) {
 *     console.log(`CCTP decode failed: ${error.context.log}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when Sui hasher version is unsupported.
 *
 * @example
 * ```typescript
 * try {
 *   const hasher = SuiChain.getDestLeafHasher(lane)
 * } catch (error) {
 *   if (error instanceof CCIPSuiHasherVersionUnsupportedError) {
 *     console.log(`Unsupported hasher: ${error.context.version}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when Sui message version is invalid.
 *
 * @example
 * ```typescript
 * try {
 *   const message = SuiChain.decodeMessage(log)
 * } catch (error) {
 *   if (error instanceof CCIPSuiMessageVersionInvalidError) {
 *     console.log('Only CCIP v1.6 format is supported for Sui')
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when Sui log data is invalid.
 *
 * This error occurs when attempting to decode a Sui event log that doesn't
 * conform to the expected CCIP message format.
 *
 * @example
 * ```typescript
 * try {
 *   const message = SuiChain.decodeMessage(log)
 * } catch (error) {
 *   if (error instanceof CCIPSuiLogInvalidError) {
 *     console.log('Invalid Sui log format:', error.context.log)
 *   }
 * }
 * ```
 */
export class CCIPSuiLogInvalidError extends CCIPError {
  override readonly name = 'CCIPSuiLogInvalidError'
  /**
   * Creates a Sui log invalid error.
   *
   * @param log - The invalid log data
   * @param options - Additional error options
   */
  constructor(log: unknown, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.LOG_DATA_INVALID, `Invalid sui log: ${String(log)}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, log },
    })
  }
}

/**
 * Thrown when Solana lane version is unsupported.
 *
 * @example
 * ```typescript
 * try {
 *   const lane = await solanaChain.getLane(onRamp, offRamp)
 * } catch (error) {
 *   if (error instanceof CCIPSolanaLaneVersionUnsupportedError) {
 *     console.log(`Unsupported version: ${error.context.version}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when multiple CCTP events found in transaction.
 *
 * @example
 * ```typescript
 * try {
 *   const cctpData = await chain.getOffchainTokenData(request)
 * } catch (error) {
 *   if (error instanceof CCIPCctpMultipleEventsError) {
 *     console.log(`Found ${error.context.count} events, expected 1`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when compute units exceed limit.
 *
 * @example
 * ```typescript
 * try {
 *   await solanaChain.execute({ offRamp, input, wallet })
 * } catch (error) {
 *   if (error instanceof CCIPSolanaComputeUnitsExceededError) {
 *     console.log(`CU: ${error.context.simulated} > limit ${error.context.limit}`)
 *   }
 * }
 * ```
 */
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

/**
 * Thrown when Aptos hasher version is unsupported.
 *
 * @example
 * ```typescript
 * try {
 *   const hasher = AptosChain.getDestLeafHasher(lane)
 * } catch (error) {
 *   if (error instanceof CCIPAptosHasherVersionUnsupportedError) {
 *     console.log(`Unsupported hasher: ${error.context.version}`)
 *   }
 * }
 * ```
 */
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

// API Client

/**
 * Thrown when API client is not available (explicitly opted out).
 *
 * @example
 * ```typescript
 * const chain = await EVMChain.fromUrl(rpc, { apiClient: null }) // Opt-out of API
 * try {
 *   await chain.getLaneLatency(destChainSelector)
 * } catch (error) {
 *   if (error instanceof CCIPApiClientNotAvailableError) {
 *     console.log('API client disabled - initialize with apiClient or remove opt-out')
 *   }
 * }
 * ```
 */
export class CCIPApiClientNotAvailableError extends CCIPError {
  override readonly name = 'CCIPApiClientNotAvailableError'
  /**
   * Creates an API client not available error.
   * @param options - Additional error options
   */
  constructor(options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.API_CLIENT_NOT_AVAILABLE,
      'CCIP API client is not available. Initialize with an apiClient or remove the explicit opt-out (apiClient: null).',
      { ...options, isTransient: false },
    )
  }
}

/**
 * Thrown when API returns hasNextPage=true unexpectedly (more than 100 messages).
 *
 * @example
 * ```typescript
 * try {
 *   const messages = await chain.getMessagesInTx(txHash)
 * } catch (error) {
 *   if (error instanceof CCIPUnexpectedPaginationError) {
 *     console.log(`Too many messages in tx: ${error.context.txHash}`)
 *     console.log(`Message count: ${error.context.messageCount}+`)
 *   }
 * }
 * ```
 */
export class CCIPUnexpectedPaginationError extends CCIPError {
  override readonly name = 'CCIPUnexpectedPaginationError'
  /** Creates an unexpected pagination error. */
  constructor(txHash: string, messageCount: number, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.API_UNEXPECTED_PAGINATION,
      `Transaction ${txHash} contains more CCIP messages than expected (${messageCount}+ returned with hasNextPage=true)`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, txHash, messageCount },
      },
    )
  }
}

// Viem Adapter

/**
 * Thrown when viem adapter encounters an issue.
 *
 * @example
 * ```typescript
 * import { fromViemClient } from '@chainlink/ccip-sdk/viem'
 *
 * try {
 *   const chain = await fromViemClient(viemClient)
 * } catch (error) {
 *   if (error instanceof CCIPViemAdapterError) {
 *     console.log(`Viem adapter error: ${error.message}`)
 *   }
 * }
 * ```
 */
export class CCIPViemAdapterError extends CCIPError {
  override readonly name = 'CCIPViemAdapterError'
  /**
   * Creates a viem adapter error.
   * @param message - Error message describing the issue
   * @param options - Additional error options including recovery hints
   */
  constructor(message: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.VIEM_ADAPTER_ERROR, message, {
      ...options,
      isTransient: false,
    })
  }
}
