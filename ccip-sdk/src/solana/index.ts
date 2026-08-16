import { Buffer } from 'buffer'

import { type IdlTypes, BorshAccountsCoder, BorshCoder, Program } from '@coral-xyz/anchor'
import { NATIVE_MINT } from '@solana/spl-token'
import {
  type Commitment,
  type ConnectionConfig,
  type VersionedTransactionResponse,
  Connection,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SystemProgram,
} from '@solana/web3.js'
import BN from 'bn.js'
import bs58 from 'bs58'
import {
  type BytesLike,
  dataLength,
  dataSlice,
  encodeBase58,
  encodeBase64,
  hexlify,
  isHexString,
  randomBytes,
  toBigInt,
} from 'ethers'
import { type Memoized, memoize } from 'micro-memoize'
import type { PickDeep } from 'type-fest'

import {
  type BlockInfo,
  type ChainContext,
  type ChainStatic,
  type GetBalanceOpts,
  type LogFilter,
  type TokenInfo,
  type TokenPoolRemote,
  type TokenPrice,
  type TokenTransferFeeOpts,
  Chain,
} from '../chain.ts'
import { fetchVerifications } from '../commits.ts'
import {
  CCIPAddressInvalidError,
  CCIPArgumentInvalidError,
  CCIPBlockTimeNotFoundError,
  CCIPContractNotRouterError,
  CCIPDataFormatUnsupportedError,
  CCIPExecutionReportChainMismatchError,
  CCIPExecutionStateInvalidError,
  CCIPExtraArgsInvalidError,
  CCIPExtraArgsLengthInvalidError,
  CCIPLogDataMissingError,
  CCIPLogsAddressRequiredError,
  CCIPSolanaOffRampEventsNotFoundError,
  CCIPSplTokenInvalidError,
  CCIPTokenAccountNotFoundError,
  CCIPTokenDataParseError,
  CCIPTokenNotConfiguredError,
  CCIPTokenPoolChainConfigNotFoundError,
  CCIPTokenPoolStateNotFoundError,
  CCIPTopicsInvalidError,
  CCIPTransactionNotFoundError,
  CCIPWalletInvalidError,
} from '../errors/index.ts'
import {
  type EVMExtraArgsV2,
  type ExtraArgs,
  type GenericExtraArgsV3,
  type SVMExtraArgsV1,
  type SuiExtraArgsV1,
  EVMExtraArgsV2Tag,
  GenericExtraArgsV3Tag,
  SuiExtraArgsV1Tag,
} from '../extra-args.ts'
import { getDestTokenAmount } from '../gas.ts'
import { cleanUpBuffers } from './cleanup.ts'
import { createRateLimitedFetch, fetchProfileForUrl } from '../fetch.ts'
import { generateUnsignedExecuteReport } from './exec.ts'
import {
  decodeSolanaGenericExtraArgsV3,
  decodeSolanaSuiExtraArgsV1,
  encodeSolanaExtraArgs,
} from './extra-args.ts'
import { estimateExecComputeUnits } from './gas.ts'
import { getV16SolanaLeafHasher } from './hasher.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { decodeMessageV1 } from '../messages.ts'
import { type NetworkInfo, ChainFamily, networkInfo } from '../networks.ts'
import { buildMessageForDest, decodeMessage, normalizeDeep } from '../requests.ts'
import SELECTORS from '../selectors.ts'
import { DEFAULT_GAS_LIMIT } from '../shared/constants.ts'
import { supportedChains } from '../supported-chains.ts'
import {
  type AnyMessage,
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
  type LeanNumbers,
  type MergeArrayElements,
  type WithLogger,
  CCIPVersion,
  ExecutionState,
} from '../types.ts'
import {
  bytesToBuffer,
  decodeAddress,
  decodeOnRampAddress,
  getAddressBytes,
  getDataBytes,
  leToBigInt,
  parseTypeAndVersion,
  passesTypeAndVersion,
  toLeArray,
  util,
} from '../utils.ts'
import { IDL as BASE_TOKEN_POOL } from './idl/1.6.0/BASE_TOKEN_POOL.ts'
import { IDL as BURN_MINT_TOKEN_POOL } from './idl/1.6.0/BURN_MINT_TOKEN_POOL.ts'
import { IDL as CCIP_CCTP_TOKEN_POOL } from './idl/1.6.0/CCIP_CCTP_TOKEN_POOL.ts'
import { IDL as CCIP_OFFRAMP_IDL } from './idl/1.6.0/CCIP_OFFRAMP.ts'
import { IDL as CCIP_ROUTER_IDL } from './idl/1.6.0/CCIP_ROUTER.ts'
import { IDL as FEE_QUOTER_IDL } from './idl/1.6.0/FEE_QUOTER.ts'
import { IDL as CCIP_OFFRAMP_V2_IDL } from './idl/2.0.0/CCIP_OFFRAMP.ts'
import { IDL as CCIP_ROUTER_V2_IDL } from './idl/2.0.0/CCIP_ROUTER.ts'
import { getTransactionsForAddress } from './logs.ts'
import { patchBorsh } from './patchBorsh.ts'
import { generateUnsignedCcipSend, getFee } from './send.ts'
import { cacheGetSignaturesForAddress } from './signatures-cache.ts'
import { type CCIPMessage_V1_6_Solana, type UnsignedSolanaTx, isWallet } from './types.ts'
import {
  convertRateLimiter,
  getErrorFromLogs,
  hexDiscriminator,
  parseSolanaLogs,
  resolveATA,
  simulateAndSendTxs,
  simulationProvider,
} from './utils.ts'
export type { UnsignedSolanaTx }

const routerCoder = new BorshCoder(CCIP_ROUTER_IDL)
const routerV2Coder = new BorshCoder(CCIP_ROUTER_V2_IDL)
const offrampCoder = new BorshCoder(CCIP_OFFRAMP_IDL)
const offrampV2Coder = new BorshCoder(CCIP_OFFRAMP_V2_IDL)
const TOKEN_POOL_IDL = {
  ...BURN_MINT_TOKEN_POOL,
  types: BASE_TOKEN_POOL.types,
  events: BASE_TOKEN_POOL.events,
  errors: [...BASE_TOKEN_POOL.errors, ...BURN_MINT_TOKEN_POOL.errors],
}

const tokenPoolCoder = new BorshCoder(TOKEN_POOL_IDL)
const CCTP_TOKEN_POOL_IDL = {
  ...CCIP_CCTP_TOKEN_POOL,
  types: [...BASE_TOKEN_POOL.types, ...CCIP_CCTP_TOKEN_POOL.types],
  events: [...BASE_TOKEN_POOL.events, ...CCIP_CCTP_TOKEN_POOL.events],
  errors: [...BASE_TOKEN_POOL.errors, ...CCIP_CCTP_TOKEN_POOL.errors],
}
const cctpTokenPoolCoder = new BorshCoder(CCTP_TOKEN_POOL_IDL)
// const commonCoder = new BorshCoder(CCIP_COMMON_IDL)

interface ParsedTokenInfo {
  name?: string
  symbol?: string
  decimals: number
  extensions?: Array<{
    extension: string
    state: { name?: string; symbol?: string; [key: string]: unknown }
  }>
}

// hardcoded symbols for tokens without metadata
const unknownTokens: { [mint: string]: string } = {
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': 'USDC', // devnet
}

/** Solana-specific log structure with transaction reference and log level. */
export type SolanaLog = ChainLog & {
  tx?: SolanaTransaction
  data: string
  level: number
  type: 'log' | 'data' | 'cpi'
}
/** Solana-specific transaction structure with versioned transaction response. */
export type SolanaTransaction = MergeArrayElements<
  ChainTransaction,
  {
    tx: VersionedTransactionResponse
    logs: readonly SolanaLog[]
  }
>

/**
 * Solana chain implementation supporting Solana networks.
 *
 * Provides methods for sending CCIP cross-chain messages, querying message
 * status, fetching fee quotes, and manually executing pending messages on
 * Solana networks.
 *
 * @remarks
 * Solana uses CCIP v1.6+ protocol only.
 *
 * @example Create from RPC URL
 * ```typescript
 * import { SolanaChain } from '@chainlink/ccip-sdk'
 *
 * const chain = await SolanaChain.fromUrl('https://api.devnet.solana.com')
 * console.log(`Connected to: ${chain.network.name}`)
 * ```
 *
 * @example Query messages in a transaction
 * ```typescript
 * const requests = await chain.getMessagesInTx('5abc123...')
 * for (const req of requests) {
 *   console.log(`Message ID: ${req.message.messageId}`)
 * }
 * ```
 */
export class SolanaChain extends Chain<typeof ChainFamily.Solana> {
  static {
    patchBorsh()
    supportedChains[ChainFamily.Solana] = SolanaChain
  }
  static readonly family = ChainFamily.Solana
  static readonly decimals = 9

  connection: Connection
  commitment: Commitment = 'confirmed'

  /**
   * Creates a new SolanaChain instance.
   * @param connection - Solana connection instance.
   * @param network - Network information for this chain.
   */
  constructor(connection: Connection, network: NetworkInfo, ctx?: ChainContext) {
    super(network, ctx)

    this.connection = connection

    // Memoize expensive operations
    this.typeAndVersion = memoize(this.typeAndVersion.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
    })
    // cache whole signature lists per address (up to 30min), to speed up consecutive
    // paginations over the same address
    this.connection.getSignaturesForAddress = cacheGetSignaturesForAddress(this.connection)
    this.getBlockInfo = memoize(this.getBlockInfo.bind(this), {
      async: true,
      maxSize: 1024,
      forceUpdate: ([k]) => typeof k !== 'number' || k <= 0,
    })
    this.getTransaction = memoize(this.getTransaction.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
      expires: 5e3,
    })
    this.getTokenForTokenPool = memoize(this.getTokenForTokenPool.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
    })
    this.getTokenInfo = memoize(this.getTokenInfo.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
    })
    // cache account info for 30 seconds
    this.connection.getAccountInfo = memoize(this.connection.getAccountInfo.bind(this.connection), {
      maxSize: 100,
      maxArgs: 2,
      expires: 5e3,
      transformKey: ([address, commitment]) =>
        [(address as PublicKey).toString(), commitment] as const,
    })

    this._getRouterConfig = memoize(this._getRouterConfig.bind(this), {
      async: true,
      maxArgs: 1,
      expires: 60e3,
    })
    this._getOffRampReferenceAddresses = memoize(this._getOffRampReferenceAddresses.bind(this), {
      async: true,
      maxArgs: 1,
      expires: 60e3,
    })
    this.getOnRampConfig = memoize(this.getOnRampConfig.bind(this), {
      async: true,
      maxArgs: 2,
      expires: 60e3,
    })
    this.getOffRampConfig = memoize(this.getOffRampConfig.bind(this), {
      async: true,
      maxArgs: 2,
      expires: 60e3,
    })

    this.getFeeTokens = memoize(this.getFeeTokens.bind(this), { async: true, maxArgs: 1 })
    this.getOffRampsForRouter = memoize(this.getOffRampsForRouter.bind(this), {
      async: true,
      maxArgs: 2,
      maxSize: 20,
    })
  }

  /**
   * Creates a Solana connection from a URL.
   * @param url - RPC endpoint URL (https://, http://, wss://, or ws://).
   * @param ctx - context containing logger.
   * @returns Solana Connection instance.
   * @throws {@link CCIPDataFormatUnsupportedError} if URL format is invalid
   */
  static _getConnection(
    url: string,
    ctx?: WithLogger & { fetch?: typeof fetch; abort?: AbortSignal },
  ): Connection {
    if (!url.startsWith('http') && !url.startsWith('ws')) {
      throw new CCIPDataFormatUnsupportedError(
        `Invalid Solana RPC URL format (should be https://, http://, wss://, or ws://): ${url}`,
      )
    }

    const config: ConnectionConfig = { commitment: 'confirmed' }
    config.fetch = ctx?.fetch ?? createRateLimitedFetch(fetchProfileForUrl(url), ctx)

    return new Connection(url, config)
  }

  /**
   * Creates a SolanaChain instance from an existing connection.
   * @param connection - Solana Connection instance.
   * @param ctx - context containing logger.
   * @returns A new SolanaChain instance.
   */
  static async fromConnection(connection: Connection, ctx?: ChainContext): Promise<SolanaChain> {
    // Get genesis hash to use as chainId
    return new SolanaChain(connection, networkInfo(await connection.getGenesisHash()), ctx)
  }

  /**
   * Creates a SolanaChain instance from an RPC URL.
   *
   * @param url - RPC endpoint URL (https://, http://, wss://, or ws://).
   * @param ctx - Optional context containing logger and API client configuration.
   * @returns A new SolanaChain instance connected to the specified network.
   * @throws {@link CCIPChainNotFoundError} if chain cannot be identified from genesis hash
   *
   * @example
   * ```typescript
   * // Create from devnet URL
   * const chain = await SolanaChain.fromUrl('https://api.devnet.solana.com')
   *
   * // With custom logger
   * const chain = await SolanaChain.fromUrl(url, { logger: customLogger })
   * ```
   */
  static async fromUrl(url: string, ctx?: ChainContext): Promise<SolanaChain> {
    const connection = this._getConnection(url, ctx)
    return this.fromConnection(connection, ctx)
  }

  // cached
  /**
   * {@inheritDoc Chain.getBlockInfo}
   * @throws {@link CCIPBlockTimeNotFoundError} if block time cannot be retrieved
   */
  async getBlockInfo(block: number | 'latest' | 'finalized'): Promise<BlockInfo> {
    if (typeof block !== 'number') {
      const slot = await this.connection.getSlot(block === 'latest' ? 'confirmed' : block)
      const blockTime = await this.connection.getBlockTime(slot)
      if (blockTime === null) {
        throw new CCIPBlockTimeNotFoundError(`finalized slot ${slot}`)
      }
      return { number: slot, timestamp: blockTime }
    } else if (block <= 0) {
      block = (await this.connection.getSlot('confirmed')) + block
    }

    const blockTime = await this.connection.getBlockTime(block)
    if (blockTime === null) {
      throw new CCIPBlockTimeNotFoundError(block)
    }
    return { number: block, timestamp: blockTime }
  }

  /**
   * {@inheritDoc Chain.getTransaction}
   * @throws {@link CCIPTransactionNotFoundError} if transaction not found
   */
  async getTransaction(hash: string): Promise<SolanaTransaction> {
    const tx = await this.connection.getTransaction(hash, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
    if (!tx)
      throw new CCIPTransactionNotFoundError(hash, { context: { network: this.network.name } })
    if (tx.blockTime) {
      ;(this.getBlockInfo as Memoized<typeof this.getBlockInfo, { async: true }>).cache.set(
        [tx.slot],
        Promise.resolve({ number: tx.slot, timestamp: tx.blockTime }),
      )
    } else {
      tx.blockTime = (await this.getBlockInfo(tx.slot)).timestamp
    }

    // Parse logs from transaction using helper function
    const logs_ = tx.meta
      ? parseSolanaLogs(tx.meta.logMessages ?? [], tx).map((l) => ({
          ...l,
          transactionHash: hash,
          blockNumber: tx.slot,
        }))
      : []

    const chainTx: SolanaTransaction = {
      hash,
      logs: [] as SolanaLog[],
      blockNumber: tx.slot,
      timestamp: tx.blockTime,
      from: tx.transaction.message.staticAccountKeys[0]!.toString(),
      error: tx.meta?.err,
      tx, // specialized solana transaction
    }
    // solana logs include circular reference to tx
    chainTx.logs = logs_.map((l) =>
      Object.assign(l, { blockTimestamp: tx.blockTime!, tx: chainTx }),
    )
    return chainTx
  }

  /**
   * Internal method to get transactions for an address with pagination.
   * @param opts - Log filter options.
   * @returns Async generator of Solana transactions.
   */
  async *getTransactionsForAddress(
    opts: LeanNumbers<Omit<LogFilter, 'topics'>> & {
      pollInterval?: number
      excludeAddresses?: string[]
    },
  ): AsyncGenerator<SolanaTransaction> {
    if (opts.watch) {
      opts = {
        ...opts,
        watch:
          opts.watch instanceof AbortSignal
            ? AbortSignal.any([opts.watch, this.abort])
            : this.abort,
      }
    }
    yield* getTransactionsForAddress(opts, this)
  }

  /**
   * Retrieves logs from Solana transactions with enhanced chronological ordering.
   *
   * Behavior:
   * - If opts.startBlock or opts.startTime is provided:
   *   * Fetches ALL signatures for the address going back in time
   *   * Continues fetching until finding signatures older than the start target
   *   * Filters out signatures older than start criteria
   *   * Returns logs in chronological order (oldest first)
   *
   * - If opts.startBlock and opts.startTime are omitted:
   *   * Uses slot 0 as the forward start for non-watch queries
   *
   * @param opts - Log filter options containing:
   *   - `startBlock`: Starting slot number (inclusive)
   *       Solana's special case: if startBlock=0, fetch only one page of getSignaturesForAddress
   *   - `startTime`: Starting Unix timestamp (inclusive)
   *   - `endBlock`: Ending slot number (inclusive)
   *   - `endBefore`: Fetch signatures before this transaction
   *   - `address`: Program address to filter logs by (required for Solana)
   *   - `topics`: Array of topics to filter logs by (optional); either 0x-8B discriminants or event names
   *   - `watch`: Watch for new logs
   *   - `programs`: Special option to allow querying by address of interest, but yielding matching
   *     logs from specific (string address) program or any (true)
   * @returns AsyncIterableIterator of parsed ChainLog objects.
   * @throws {@link CCIPLogsAddressRequiredError} if address is not provided
   * @throws {@link CCIPTopicsInvalidError} if topics contain invalid values
   */
  async *getLogs(
    opts: LeanNumbers<LogFilter> & { programs?: string[] | true },
  ): AsyncGenerator<SolanaLog> {
    let programs: true | string[]
    let excludeAddresses
    if (!opts.address) {
      throw new CCIPLogsAddressRequiredError()
    } else if (!opts.programs) {
      programs = [opts.address]
      if (opts.topics?.length === 1 && opts.topics[0] === 'ExecutionStateChanged') {
        // optimization: when querying offramp's execs, exclude txs including `fee_billing_signer` (used only in commits)
        const [pdaAddr] = PublicKey.findProgramAddressSync(
          [Buffer.from('fee_billing_signer')],
          new PublicKey(/* OffRamp */ opts.address),
        )
        excludeAddresses = [pdaAddr.toBase58()]
      }
    } else {
      programs = opts.programs
    }
    let topics
    if (opts.topics?.length) {
      if (!opts.topics.every((topic) => typeof topic === 'string'))
        throw new CCIPTopicsInvalidError(opts.topics)
      // append events discriminants (if not 0x-8B already), but keep OG topics
      topics = [
        ...opts.topics,
        ...opts.topics.filter((t) => !isHexString(t, 8)).map((t) => hexDiscriminator(t)),
      ]
    }

    // Process signatures and yield logs
    for await (const tx of this.getTransactionsForAddress({ ...opts, excludeAddresses })) {
      for (const log of tx.logs) {
        // Filter and yield logs from the specified program, and which match event discriminant or log prefix
        if (
          (programs !== true && !programs.includes(log.address)) ||
          (topics &&
            !topics.some(
              (t) =>
                t === log.topics[0] || (typeof log.data === 'string' && log.data.startsWith(t)),
            ))
        )
          continue
        if (!(await passesTypeAndVersion(this, log.address, opts.typeAndVersions))) continue
        yield log
      }
    }
  }

  /** {@inheritDoc Chain.getMessagesInBatch} */
  override async getMessagesInBatch<
    R extends PickDeep<
      CCIPRequest,
      | 'lane'
      | `log.${'topics' | 'address' | 'blockNumber' | 'blockTimestamp'}`
      | 'message.sequenceNumber'
    >,
  >(
    request: R,
    range: Pick<CommitReport, 'minSeqNr' | 'maxSeqNr'>,
    opts?: Pick<LogFilter, 'page'>,
  ): Promise<R['message'][]> {
    const [destChainStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('dest_chain_state'), toLeArray(request.lane.destChainSelector, 8)],
      new PublicKey(request.log.address),
    )
    // getMessagesInBatch pass opts back to getLogs; use it to narrow getLogs filter only to
    // txs touching destChainStatePda
    const opts_: Parameters<SolanaChain['getLogs']>[0] = {
      ...opts,
      programs: [request.log.address],
      address: destChainStatePda.toBase58(),
    }
    return super.getMessagesInBatch(request, range, opts_ as { page?: number })
  }

  /** {@inheritDoc Chain.typeAndVersion} */
  async typeAndVersion(address: string) {
    const program = new Program(
      CCIP_OFFRAMP_IDL, // `typeVersion` schema should be the same
      new PublicKey(address),
      simulationProvider(this),
    )

    // Create the typeVersion instruction
    const returnDataString = (await program.methods
      .typeVersion()
      .accounts({ clock: SYSVAR_CLOCK_PUBKEY })
      .view()) as string
    const res = parseTypeAndVersion(returnDataString.trim())
    if (res[1].startsWith('0.1.')) res[1] = CCIPVersion.V1_6
    return res
  }

  /**
   * On Solana, Router is OnRamp
   */
  override async getRouterForOnRamp(onRamp: string, _destChainSelector: bigint): Promise<string> {
    return onRamp
  }

  /** {@inheritDoc Chain.getOnRampConfig} */
  async getOnRampConfig(onRamp: string, destChainSelector: bigint) {
    const [, version, typeAndVersion] = await this.typeAndVersion(onRamp)
    const routerConfig = await this._getRouterConfig(onRamp)

    // CCIP v2 router (`ccip-router 2.0.0-dev`) stores the per-lane dest chain state under a
    // different PDA seed (`dest_chain_state_v2`) and account type (`DestChainCcipV2`), and folds
    // the lane fee config into that account instead of a separate FeeQuoter dest_chain account
    // (fees are quoted by a committee-verifier CCV at send time). Handle it separately; the rest
    // of the router (Config account) stays byte-compatible with the 1.6 IDL.
    if (version.startsWith('2.')) {
      const program = new Program(CCIP_ROUTER_V2_IDL, new PublicKey(onRamp), {
        connection: this.connection,
      })
      const [destChainStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('dest_chain_state_v2'), toLeArray(destChainSelector, 8)],
        new PublicKey(onRamp),
      )
      const destChainState = await program.account.destChainCcipV2.fetch(destChainStatePda)
      return normalizeDeep(
        {
          ...routerConfig,
          destChainSelector,
          rmn: routerConfig.rmnRemote,
          ...destChainState.config,
          router: onRamp,
          typeAndVersion,
        },
        {
          sourceFamily: (this.constructor as typeof SolanaChain).family,
          destFamily: networkInfo(destChainSelector).family,
        },
      )
    }

    const program = new Program(CCIP_ROUTER_IDL, new PublicKey(onRamp), {
      connection: this.connection,
    })

    const [destChainStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('dest_chain_state'), toLeArray(destChainSelector, 8)],
      new PublicKey(onRamp),
    )
    const destChainState = await program.account.destChain.fetch(destChainStatePda)

    const feeQuoter = new Program(FEE_QUOTER_IDL, routerConfig.feeQuoter, {
      connection: this.connection,
    })
    const [feeQuoterConfigAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from('config')],
      routerConfig.feeQuoter,
    )
    const [feeQuoterDestAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from('dest_chain'), toLeArray(destChainSelector, 8)],
      routerConfig.feeQuoter,
    )
    const [feeQuoterConfig, feeQuoterDestConfig] = await Promise.all([
      feeQuoter.account.config.fetch(feeQuoterConfigAddress),
      feeQuoter.account.destChain.fetch(feeQuoterDestAddress),
    ])
    return normalizeDeep(
      {
        ...routerConfig,
        destChainSelector,
        ...destChainState.config,
        feeQuoterConfig: { ...feeQuoterConfig, ...feeQuoterDestConfig },
        router: onRamp,
        typeAndVersion,
      },
      {
        sourceFamily: (this.constructor as typeof SolanaChain).family,
        destFamily: networkInfo(destChainSelector).family,
      },
    )
  }

  /**
   * Fetch `reference_addresses` PDA for the OffRamp.
   *
   * The layout differs between v1.6 (no `bump` byte) and v2 (`bump` between `version` and
   * `router`), so we load the matching IDL after `typeAndVersion`:
   *   - v1.6  → `CCIP_OFFRAMP_IDL.referenceAddresses` (version + router + …)
   *   - v2    → `CCIP_OFFRAMP_V2_IDL.referenceAddresses` (version + bump + router + …)
   */
  private async _getOffRampReferenceAddresses(offRamp: string) {
    const offRamp_ = new PublicKey(offRamp)
    const [, version] = await this.typeAndVersion(offRamp)
    const program = new Program(
      version.startsWith('2.') ? CCIP_OFFRAMP_V2_IDL : CCIP_OFFRAMP_IDL,
      offRamp_,
      { connection: this.connection },
    )
    const [referenceAddressesPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('reference_addresses')],
      offRamp_,
    )
    return program.account.referenceAddresses.fetch(referenceAddressesPda)
  }

  /**
   * {@inheritDoc Chain.getOffRampConfig}
   */
  async getOffRampConfig(offRamp: string, sourceChainSelector: bigint) {
    const offRamp_ = new PublicKey(offRamp)
    const [, version, typeAndVersion] = await this.typeAndVersion(offRamp)

    // referenceAddresses is byte-identical across 1.6 and 2.0, so read it with the 1.6 IDL always.
    const refAddresses = await this._getOffRampReferenceAddresses(offRamp)

    // The `source_chain_state` PDA seed is unchanged in v2, but the `SourceChain` account layout
    // differs: v2 dropped the `state` (minSeqNr) field and reshaped `SourceChainConfig`. Decode
    // with the matching IDL.
    const isV2 = version.startsWith('2.')
    const program = new Program(isV2 ? CCIP_OFFRAMP_V2_IDL : CCIP_OFFRAMP_IDL, offRamp_, {
      connection: this.connection,
    })

    // Read source_chain_state PDA for onRamp and other config fields
    const [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('source_chain_state'), toLeArray(sourceChainSelector, 8)],
      offRamp_,
    )
    const sourceChain = await program.account.sourceChain.fetch(statePda)
    // v1 carries a per-lane `state` (minSeqNr); v2 has none.
    const state = 'state' in sourceChain ? sourceChain.state : undefined

    // v1 exposes a single `onRamp`; v2 exposes a `onRamps` Vec. Normalize both to `onRamps`.
    const sourceFamily = networkInfo(sourceChainSelector).family
    const decodeOnRampField = (onRampField: { bytes: readonly number[]; len: number }) =>
      decodeOnRampAddress(
        getAddressBytes(onRampField.bytes).subarray(0, onRampField.len),
        sourceFamily,
      )
    const onRamps = Array.isArray(sourceChain.config.onRamps)
      ? sourceChain.config.onRamps.map(decodeOnRampField)
      : [decodeOnRampField(sourceChain.config.onRamp)]
    const { onRamp: _onRamp, onRamps: _onRamps, ...sourceConfig } = sourceChain.config

    return normalizeDeep(
      {
        ...refAddresses,
        rmn: refAddresses.rmnRemote,
        sourceChainSelector,
        ...sourceConfig,
        ...state,
        onRamps,
        typeAndVersion,
      },
      {
        sourceFamily,
        destFamily: (this.constructor as typeof SolanaChain).family,
      },
    )
  }

  /** {@inheritDoc Chain.getNativeTokenForRouter} */
  getNativeTokenForRouter(_router: string): Promise<string> {
    return Promise.resolve(NATIVE_MINT.toBase58())
  }

  /**
   * {@link Chain.getOffRampsForRouter}
   *
   * Both 1.6 and v2 routers maintain `allowed_offramp` marker PDAs per
   * `(sourceChainSelector, offRamp)` pair, seeded as `[allowed_offramp, selectorLE, offRamp]`.
   * The offRamp pubkey lives only in the seeds (marker data is just the 8-byte
   * discriminator), so we:
   *  1. enumerate all `allowed_offramp` marker accounts owned by the router
   *     (filtered by 8-byte data length),
   *  2. read each marker's transaction history (offRamps reference their marker
   *     when executing commit/execute),
   *  3. for every account key seen in those txs, re-derive the marker PDA for
   *     our `sourceChainSelector` and keep the keys that reproduce the marker
   *     address.
   * A match proves both that the key is the offRamp program and that it's
   * allowed for this source chain. All matching offRamps are returned (not just
   * the first), so lanes with multiple historical offRamps are fully discovered.
   *
   * @throws {@link CCIPSolanaOffRampEventsNotFoundError} if no OffRamp markers
   *         match for this source chain.
   */
  async getOffRampsForRouter(router: string, sourceChainSelector: bigint): Promise<string[]> {
    const [, version] = await this.typeAndVersion(router)
    if (version.startsWith('1.')) {
      // feeQuoter is present in router's config, and has a DestChainState account which is updated by
      // the offramps, so we can use it to narrow the search for the offramp
      const { feeQuoter } = await this._getRouterConfig(router)

      const [feeQuoterDestChainStateAccountAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from('dest_chain'), toLeArray(sourceChainSelector, 8)],
        feeQuoter,
      )

      for await (const log of this.getLogs({
        programs: true,
        address: feeQuoterDestChainStateAccountAddress.toBase58(),
        startBlock: 0, // use getLogs special-case to do a single getSignaturesForAddress pass
        endBlock: 'finalized',
        topics: ['ExecutionStateChanged', 'CommitReportAccepted', 'Transmitted'],
      })) {
        return [log.address] // assume single offramp per router/deployment on Solana
      }
    }

    const routerPk = new PublicKey(router)
    // `allowed_offramp` markers are 8-byte accounts (discriminator only) on both
    // 1.6 and v2 routers. Filter by data length to find them without needing a
    // Program/IDL instance.
    const markers = await this.connection.getProgramAccounts(routerPk, {
      filters: [{ dataSize: 8 }],
      encoding: 'base64',
    })

    const offRamps = new Set<string>()
    await Promise.all(
      markers.map(async ({ pubkey: marker }) => {
        const sigs = await this.connection.getSignaturesForAddress(marker, { limit: 10 })
        for (const { signature } of sigs) {
          const tx = await this.connection.getTransaction(signature, {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed',
          })
          if (!tx) continue
          const keys = tx.transaction.message
            .getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses })
            .keySegments()
            .flat()
          for (const key of keys) {
            const [pda] = PublicKey.findProgramAddressSync(
              [Buffer.from('allowed_offramp'), toLeArray(sourceChainSelector, 8), key.toBuffer()],
              routerPk,
            )
            const keyAddr = key.toBase58()
            if (pda.equals(marker)) offRamps.add(keyAddr)
            if (keyAddr.toLowerCase().startsWith('off')) return
          }
        }
      }),
    )

    if (!offRamps.size) throw new CCIPSolanaOffRampEventsNotFoundError(router)
    return [...offRamps]
  }

  /** {@inheritDoc Chain.getOnRampForRouter} */
  getOnRampForRouter(router: string, _destChainSelector: bigint): Promise<string> {
    return Promise.resolve(router) // solana's Router is also the OnRamp
  }

  /**
   * {@inheritDoc Chain.getTokenInfo}
   * @throws {@link CCIPSplTokenInvalidError} if token is not a valid SPL token
   * @throws {@link CCIPTokenDataParseError} if token data cannot be parsed
   */
  async getTokenInfo(token: string): Promise<TokenInfo> {
    const mint = new PublicKey(token)
    const mintInfo = await this.connection.getParsedAccountInfo(mint)

    if (
      !mintInfo.value ||
      (typeof mintInfo.value.data === 'object' &&
        'program' in mintInfo.value.data &&
        mintInfo.value.data.program !== 'spl-token' &&
        mintInfo.value.data.program !== 'spl-token-2022')
    ) {
      throw new CCIPSplTokenInvalidError(token)
    }

    if (typeof mintInfo.value.data === 'object' && 'parsed' in mintInfo.value.data) {
      const parsed = mintInfo.value.data.parsed as { info: ParsedTokenInfo }
      const data = parsed.info

      // Token-2022 tokens may embed metadata in extensions
      const tokenMetadataExt = data.extensions?.find((e) => e.extension === 'tokenMetadata')
      const extSymbol = tokenMetadataExt?.state.symbol
      const extName = tokenMetadataExt?.state.name
      const rawSymbol = data.symbol || extSymbol

      // Track whether we have an on-chain authoritative symbol/name (parsed fields or T-2022 extension).
      // unknownTokens / 'UNKNOWN' are fallbacks — Metaplex can still override them.
      let symbol = rawSymbol || unknownTokens[token] || 'UNKNOWN'
      let name = data.name || extName

      const hasAuthoritativeSymbol = !!rawSymbol && rawSymbol !== 'UNKNOWN'
      const hasAuthoritativeName = !!name

      // If symbol or name is missing, try to fetch from Metaplex metadata
      if (!hasAuthoritativeSymbol || !hasAuthoritativeName) {
        try {
          const metadata = await this._fetchTokenMetadata(mint)
          if (metadata) {
            if (metadata.symbol && !hasAuthoritativeSymbol) {
              symbol = metadata.symbol
            }
            if (metadata.name && !name) {
              name = metadata.name
            }
          }
        } catch (error) {
          // Metaplex metadata fetch failed, keep the default values
          this.logger.debug(`Failed to fetch Metaplex metadata for token ${token}:`, error)
        }
      }

      return {
        name,
        symbol,
        decimals: data.decimals,
      }
    } else {
      throw new CCIPTokenDataParseError(token)
    }
  }

  /**
   * {@inheritDoc Chain.getBalance}
   * @throws {@link CCIPTokenAccountNotFoundError} if token account not found
   */
  async getBalance(opts: GetBalanceOpts): Promise<bigint> {
    const { holder, token } = opts
    const holderPubkey = new PublicKey(holder)

    if (!token) {
      return BigInt(await this.connection.getBalance(holderPubkey))
    }

    const tokenPubkey = new PublicKey(token)
    const resolved = await resolveATA(this.connection, tokenPubkey, holderPubkey)

    // Check if ATA exists on-chain
    const ataAccountInfo = await this.connection.getAccountInfo(resolved.ata)
    if (!ataAccountInfo) {
      throw new CCIPTokenAccountNotFoundError(token, holder)
    }

    const accountInfo = await this.connection.getTokenAccountBalance(resolved.ata)
    return BigInt(accountInfo.value.amount)
  }

  /**
   * Fetches token metadata from Metaplex.
   * @param mintPublicKey - Token mint public key.
   * @returns Token name and symbol, or null if not found.
   */
  async _fetchTokenMetadata(
    mintPublicKey: PublicKey,
  ): Promise<{ name: string; symbol: string } | null> {
    try {
      // Token Metadata Program ID
      const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')

      // Derive metadata account address
      const [metadataPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mintPublicKey.toBuffer()],
        TOKEN_METADATA_PROGRAM_ID,
      )

      // Fetch metadata account
      const metadataAccount = await this.connection.getAccountInfo(metadataPDA)
      if (!metadataAccount) {
        return null
      }

      // Parse Metaplex Token Metadata according to the actual format
      // Reference: https://docs.metaplex.com/programs/token-metadata/accounts#metadata
      const data = metadataAccount.data
      if (data.length < 100) {
        return null
      }

      let offset = 0

      // Skip key (1 byte) - discriminator for account type
      offset += 1

      // Skip update_authority (32 bytes)
      offset += 32

      // Skip mint (32 bytes)
      offset += 32

      // Parse name (variable length string)
      if (offset + 4 > data.length) return null
      const nameLength = data.readUInt32LE(offset)
      offset += 4
      if (nameLength > 200 || offset + nameLength > data.length) return null
      const nameBytes = data.subarray(offset, offset + nameLength)
      const name = nameBytes.toString('utf8').replace(/\0/g, '').trim()
      offset += nameLength

      // Parse symbol (variable length string)
      if (offset + 4 > data.length) return null
      const symbolLength = data.readUInt32LE(offset)
      offset += 4
      if (symbolLength > 50 || offset + symbolLength > data.length) return null

      const symbolBytes = data.subarray(offset, offset + symbolLength)
      const symbol = symbolBytes.toString('utf8').replace(/\0/g, '').trim()

      return name || symbol ? { name, symbol } : null
    } catch (error) {
      this.logger.debug('Error fetching token metadata:', error)
      return null
    }
  }

  /**
   * Decodes a CCIP message from a Solana log event.
   * @param log - Log with data field.
   * @returns Decoded CCIPMessage or undefined if not valid.
   * @throws {@link CCIPExtraArgsInvalidError} if extra args cannot be decoded
   */
  static decodeMessage({ data }: { data: unknown }): CCIPMessage | undefined {
    if (!data || typeof data !== 'string') return undefined

    // Verify the discriminant matches CCIPMessageSent
    try {
      if (
        !['CCIPMessageSent', 'CCIPMessageSentV2']
          .map(hexDiscriminator)
          .includes(dataSlice(getDataBytes(data), 0, 8))
      )
        return
    } catch (_) {
      return
    }
    let decoded
    if (dataSlice(getDataBytes(data), 0, 8) === hexDiscriminator('CCIPMessageSent'))
      decoded = routerCoder.events.decode<
        (typeof CCIP_ROUTER_IDL)['events'][number] & { name: 'CCIPMessageSent' },
        IdlTypes<typeof CCIP_ROUTER_IDL>
      >(data)
    else if (dataSlice(getDataBytes(data), 0, 8) === hexDiscriminator('CCIPMessageSentV2'))
      decoded = routerV2Coder.events.decode<
        (typeof CCIP_ROUTER_V2_IDL)['events'][number] & { name: 'CCIPMessageSentV2' },
        IdlTypes<typeof CCIP_ROUTER_V2_IDL>
      >(data)

    if (decoded?.name === 'CCIPMessageSentV2') {
      const message = decodeMessageV1(decoded.data.encodedMessage)
      return decodeMessage({ ...decoded.data, ...message })
    }
    if (decoded?.name !== 'CCIPMessageSent') return
    const message = decoded.data.message

    // Convert BN/number types to bigints
    const messageId = hexlify(new Uint8Array(message.header.messageId))
    const sourceChainSelector = BigInt(message.header.sourceChainSelector.toString())
    const destChainSelector = BigInt(message.header.destChainSelector.toString())
    const sequenceNumber = BigInt(message.header.sequenceNumber.toString())
    const nonce = BigInt(message.header.nonce.toString())
    const destNetwork = networkInfo(destChainSelector)

    const sender = message.sender.toString()
    const data_ = getDataBytes(message.data)
    // TODO: extract this into a proper normalize/decode/reencode data utility
    const msgData = destNetwork.family === ChainFamily.Solana ? encodeBase64(data_) : hexlify(data_)
    const receiver = decodeAddress(message.receiver, destNetwork.family)
    const feeToken = message.feeToken.toString()

    // Process token amounts
    const tokenAmounts = message.tokenAmounts.map((ta) => ({
      sourcePoolAddress: ta.sourcePoolAddress.toBase58(),
      destTokenAddress: decodeAddress(ta.destTokenAddress, destNetwork.family),
      extraData: hexlify(ta.extraData),
      amount: leToBigInt(ta.amount.leBytes),
      destExecData: hexlify(ta.destExecData),
      // destGasAmount is encoded as BE uint32;
      destGasAmount: toBigInt(ta.destExecData),
    }))

    // Convert fee amounts from CrossChainAmount format
    const feeTokenAmount = leToBigInt(message.feeTokenAmount.leBytes)
    const feeValueJuels = leToBigInt(message.feeValueJuels.leBytes)

    // Parse gas limit from extraArgs
    const extraArgs = hexlify(message.extraArgs)
    const parsed = this.decodeExtraArgs(extraArgs)
    if (!parsed) throw new CCIPExtraArgsInvalidError('SVM', extraArgs)
    const { _tag, ...rest } = parsed as Record<string, unknown>

    return {
      // merge header fields to message
      messageId,
      sourceChainSelector,
      destChainSelector: destChainSelector,
      sequenceNumber: sequenceNumber,
      nonce,
      sender,
      receiver,
      data: msgData,
      tokenAmounts,
      feeToken,
      feeTokenAmount,
      feeValueJuels,
      extraArgs,
      ...rest,
    } as unknown as CCIPMessage
  }

  /**
   * Decodes extra arguments from Solana CCIP messages (Borsh-encoded, produced
   * BY Solana targeting remote chain families).
   *
   * Handles:
   * - `GenericExtraArgsV2` (EVMExtraArgsV2 tag) — Solana → EVM 1.6
   * - `GenericExtraArgsV3` — Solana → EVM 2.0
   * - `SuiExtraArgsV1` — Solana → Sui
   *
   * @param extraArgs - Encoded extra arguments bytes.
   * @returns Decoded extra arguments or undefined if unknown format.
   * @throws {@link CCIPExtraArgsLengthInvalidError} if extra args length is invalid
   */
  static decodeExtraArgs(
    extraArgs: BytesLike,
  ):
    | (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' })
    | (GenericExtraArgsV3 & { _tag: 'GenericExtraArgsV3' })
    | (SuiExtraArgsV1 & { _tag: 'SuiExtraArgsV1' })
    | undefined {
    const data = getDataBytes(extraArgs),
      tag = dataSlice(data, 0, 4)
    switch (tag) {
      case EVMExtraArgsV2Tag: {
        if (dataLength(data) === 4 + 16 + 1) {
          // Solana-generated EVMExtraArgsV2 (Borsh: 21 bytes total, u128 LE gasLimit)
          return {
            _tag: 'EVMExtraArgsV2',
            gasLimit: leToBigInt(dataSlice(data, 4, 4 + 16)), // from Uint128LE
            allowOutOfOrderExecution: data[4 + 16] == 1,
          }
        }
        throw new CCIPExtraArgsLengthInvalidError(dataLength(data))
      }
      case GenericExtraArgsV3Tag: {
        return decodeSolanaGenericExtraArgsV3(data)
      }
      case SuiExtraArgsV1Tag: {
        return decodeSolanaSuiExtraArgsV1(data)
      }
      default:
        return
    }
  }

  /**
   * Encodes extra arguments for Solana CCIP messages in Borsh format.
   *
   * Handles messages FROM Solana TO remote chain families:
   * - `EVMExtraArgsV2` / `GenericExtraArgsV2` (EVM dest): Borsh `{gasLimit: u128, ...}`
   * - `GenericExtraArgsV3` (EVM v2 dest): Borsh `{gas_limit: u32, finality, ccvs, ...}`
   * - `SuiExtraArgsV1` (Sui dest): Borsh `{gasLimit: u64, ...}`
   *
   * @param args - Extra arguments to encode.
   * @returns Encoded extra arguments as hex string.
   */
  static encodeExtraArgs(args: ExtraArgs): string {
    return encodeSolanaExtraArgs(args)
  }

  /**
   * Decodes commit reports from a Solana log event.
   * @param log - Log with data field.
   * @param lane - Lane info for filtering.
   * @returns Array of CommitReport or undefined if not valid.
   * @throws {@link CCIPLogDataMissingError} if log data is missing
   */
  static decodeCommits(
    log: Pick<ChainLog, 'data'>,
    lane?: Omit<Lane, 'destChainSelector'>,
  ): CommitReport[] | undefined {
    // Check if this is a CommitReportAccepted event by looking at the discriminant
    if (!log.data || typeof log.data !== 'string') {
      throw new CCIPLogDataMissingError()
    }

    try {
      // Verify the discriminant matches CommitReportAccepted
      if (dataSlice(getDataBytes(log.data), 0, 8) !== hexDiscriminator('CommitReportAccepted'))
        return
    } catch (_) {
      return
    }

    const decoded = offrampCoder.events.decode<
      (typeof CCIP_OFFRAMP_IDL)['events'][number] & { name: 'CommitReportAccepted' },
      IdlTypes<typeof CCIP_OFFRAMP_IDL>
    >(log.data)
    if (decoded?.name !== 'CommitReportAccepted' || !decoded.data.merkleRoot) return
    const merkleRoot = decoded.data.merkleRoot

    // Verify the source chain selector matches our lane
    const sourceChainSelector = BigInt(merkleRoot.sourceChainSelector.toString())

    // Convert the onRampAddress from bytes to the proper format
    const onRampAddress = decodeOnRampAddress(
      merkleRoot.onRampAddress,
      networkInfo(sourceChainSelector).family,
    )
    if (lane) {
      if (sourceChainSelector !== lane.sourceChainSelector) return
      // Verify the onRampAddress matches our lane
      if (onRampAddress !== lane.onRamp) return
    }

    return [
      {
        sourceChainSelector,
        onRampAddress,
        minSeqNr: BigInt(merkleRoot.minSeqNr.toString()),
        maxSeqNr: BigInt(merkleRoot.maxSeqNr.toString()),
        merkleRoot: hexlify(getDataBytes(merkleRoot.merkleRoot)),
      },
    ]
  }

  /**
   * Decodes an execution receipt from a Solana log event.
   * @param log - Log with data, tx, and index fields.
   * @returns ExecutionReceipt or undefined if not valid.
   * @throws {@link CCIPLogDataMissingError} if log data is missing
   * @throws {@link CCIPExecutionStateInvalidError} if execution state is invalid
   */
  static decodeReceipt(log: Pick<ChainLog, 'data' | 'tx' | 'index'>): ExecutionReceipt | undefined {
    // Check if this is a ExecutionStateChanged event by looking at the discriminant
    if (!log.data || typeof log.data !== 'string') {
      throw new CCIPLogDataMissingError()
    }

    let discriminator
    try {
      discriminator = dataSlice(getDataBytes(log.data), 0, 8)
      if (
        discriminator !== hexDiscriminator('ExecutionStateChanged') &&
        discriminator !== hexDiscriminator('ExecutionStateChangedV2')
      )
        return
    } catch (_) {
      return
    }

    const decoded =
      discriminator === hexDiscriminator('ExecutionStateChangedV2')
        ? offrampV2Coder.events.decode<
            (typeof CCIP_OFFRAMP_V2_IDL)['events'][number] & { name: 'ExecutionStateChangedV2' },
            IdlTypes<typeof CCIP_OFFRAMP_V2_IDL>
          >(log.data)
        : offrampCoder.events.decode<
            (typeof CCIP_OFFRAMP_IDL)['events'][number] & { name: 'ExecutionStateChanged' },
            IdlTypes<typeof CCIP_OFFRAMP_IDL>
          >(log.data)
    if (decoded?.name !== 'ExecutionStateChanged' && decoded?.name !== 'ExecutionStateChangedV2')
      return
    const messageId = hexlify(getDataBytes(decoded.data.messageId))

    // Decode state enum (MessageExecutionState)
    // Enum discriminant is a single byte: Untouched=0, InProgress=1, Success=2, Failure=3
    let state: ExecutionState
    if (decoded.data.state.inProgress) {
      state = ExecutionState.InProgress
    } else if (decoded.data.state.success) {
      state = ExecutionState.Success
    } else if (decoded.data.state.failure) {
      state = ExecutionState.Failed
    } else throw new CCIPExecutionStateInvalidError(util.inspect(decoded.data.state))

    const eventReturnData =
      'returnData' in decoded.data && dataLength(decoded.data.returnData) > 0
        ? hexlify(decoded.data.returnData)
        : undefined
    let returnData
    if (log.tx?.logs) {
      // use only last receipt per tx+message (i.e. skip intermediary InProgress=1 states for Solana)
      const laterReceiptLog = log.tx.logs
        .filter((l) => l.index > log.index)
        .findLast((l) => {
          const lastReceipt = this.decodeReceipt(l)
          return lastReceipt && lastReceipt.messageId === messageId
        })
      if (laterReceiptLog) {
        return // ignore intermediary state (InProgress=1) if we can find a later receipt
      } else if (state !== ExecutionState.Success) {
        returnData = eventReturnData ?? getErrorFromLogs(log.tx.logs as SolanaLog[])
      } else if (log.tx.error) {
        returnData = util.inspect(log.tx.error)
        state = ExecutionState.Failed
      }
    }

    return {
      sourceChainSelector: BigInt(decoded.data.sourceChainSelector.toString()),
      sequenceNumber:
        decoded.name === 'ExecutionStateChangedV2'
          ? BigInt(decoded.data.messageNumber.toString())
          : BigInt(decoded.data.sequenceNumber.toString()),
      messageId,
      ...(decoded.name === 'ExecutionStateChanged' && {
        messageHash: hexlify(getDataBytes(decoded.data.messageHash)),
      }),
      state,
      returnData: returnData ?? eventReturnData,
    }
  }

  /**
   * Converts bytes to a Solana address (Base58).
   * @param bytes - Bytes to convert.
   * @returns Base58-encoded Solana address.
   */
  static getAddress(bytes: BytesLike | PublicKey): string {
    if (bytes instanceof PublicKey) return bytes.toBase58()
    try {
      if (typeof bytes === 'string' && bs58.decode(bytes).length === 32) return bytes
    } catch (_) {
      // pass
    }
    try {
      const decoded = getDataBytes(bytes)
      if (decoded.length === 32) return encodeBase58(decoded)
    } catch {
      // pass
    }
    throw new CCIPAddressInvalidError(bytes, this.family)
  }

  /**
   * Validates a transaction hash format for Solana
   */
  static isTxHash(v: unknown): v is string {
    if (typeof v !== 'string') return false
    try {
      return bs58.decode(v).length === 64
    } catch (_) {
      // pass
    }
    return false
  }

  /**
   * Gets the leaf hasher for Solana destination chains.
   * @param lane - Lane configuration.
   * @returns Leaf hasher function.
   */
  static getDestLeafHasher(lane: Lane, ctx?: WithLogger): LeafHasher<typeof CCIPVersion.V1_6> {
    return getV16SolanaLeafHasher(lane, ctx)
  }

  /**
   * {@inheritDoc Chain.getTokenAdminRegistryFor}
   * @throws {@link CCIPContractNotRouterError} if address is not a Router
   */
  async getTokenAdminRegistryFor(address: string): Promise<string> {
    const [type] = await this.typeAndVersion(address)
    if (type.includes('OffRamp'))
      return this.getTokenAdminRegistryFor(
        (await this._getOffRampReferenceAddresses(address)).router.toBase58(),
      )
    if (!type.includes('Router')) throw new CCIPContractNotRouterError(address, type)
    // Solana implements TokenAdminRegistry in the Router/OnRamp program
    return address
  }

  /** {@inheritDoc Chain.getFee} */
  async getFee(opts: Parameters<Chain['getFee']>[0]): Promise<bigint> {
    await this.checkSendMessage(opts)
    const { router, destChainSelector, message } = opts
    const populatedMessage = buildMessageForDest(message, networkInfo(destChainSelector).family)
    return getFee(this, router, destChainSelector, populatedMessage)
  }

  /**
   * {@inheritDoc Chain.generateUnsignedSendMessage}
   * @returns instructions - array of instructions; `ccipSend` is last, after any approval
   *   lookupTables - array of lookup tables for `ccipSend` call
   *   mainIndex - instructions.length - 1
   */
  async generateUnsignedSendMessage(
    opts: Parameters<Chain['generateUnsignedSendMessage']>[0],
  ): Promise<UnsignedSolanaTx> {
    const { sender, router, destChainSelector } = opts
    const populatedMessage = buildMessageForDest(
      opts.message,
      networkInfo(destChainSelector).family,
    )
    const message = {
      ...populatedMessage,
      fee: opts.message.fee ?? (await this.getFee({ ...opts, message: populatedMessage })),
    }
    return generateUnsignedCcipSend(
      this,
      new PublicKey(sender),
      new PublicKey(router),
      destChainSelector,
      message,
      opts,
    )
  }

  /**
   * {@inheritDoc Chain.sendMessage}
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana wallet
   */
  async sendMessage(opts: Parameters<Chain['sendMessage']>[0]): Promise<CCIPRequest> {
    if (!isWallet(opts.wallet)) throw new CCIPWalletInvalidError(util.inspect(opts.wallet))
    const unsigned = await this.generateUnsignedSendMessage({
      ...opts,
      sender: opts.wallet.publicKey.toBase58(),
    })

    const hash = await simulateAndSendTxs(this, opts.wallet, unsigned, opts.txGasLimit)
    return (await this.getMessagesInTx(await this.getTransaction(hash)))[0]!
  }

  /**
   * {@inheritDoc Chain.generateUnsignedExecute}
   * @returns instructions - array of instructions to execute the report
   *   lookupTables - array of lookup tables for `manuallyExecute` call
   *   mainIndex - index of the `manuallyExecute` instruction in the array; last unless
   *   forceLookupTable is set, in which case last is ALT deactivation tx, and manuallyExecute is
   *   second to last
   * @throws {@link CCIPExecutionReportChainMismatchError} if message is not a Solana message
   */
  async generateUnsignedExecute({
    payer,
    ...opts
  }: Parameters<Chain['generateUnsignedExecute']>[0]): Promise<UnsignedSolanaTx> {
    const resolved = await this.resolveExecuteOpts(opts)
    if (!('message' in resolved.input) || !('computeUnits' in resolved.input.message))
      throw new CCIPExecutionReportChainMismatchError('Solana')
    const { offRamp, input } = resolved
    const execReport_ = input as ExecutionInput<CCIPMessage_V1_6_Solana>
    return generateUnsignedExecuteReport(
      this,
      new PublicKey(payer),
      new PublicKey(offRamp),
      execReport_,
      opts,
    )
  }

  /**
   * {@inheritDoc Chain.execute}
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana wallet
   */
  async execute(
    opts: Parameters<Chain['execute']>[0] & {
      // when cleaning leftover LookUp Tables, wait deactivation grace period (~513 slots) then close ALT
      waitDeactivation?: boolean
      clearLeftoverAccounts?: boolean
    },
  ): Promise<CCIPExecution> {
    const wallet = opts.wallet
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(util.inspect(wallet))

    let hash
    do {
      try {
        const unsigned = await this.generateUnsignedExecute({
          ...opts,
          payer: wallet.publicKey.toBase58(),
        })
        hash = await simulateAndSendTxs(this, wallet, unsigned, opts.txGasLimit ?? opts.gasLimit)
      } catch (err) {
        if (!(err instanceof Error)) throw err
        if (err.message.includes('AlreadyContainsChunk')) {
          // stale buffer from a previous failed attempt; close it and retry
          if (!opts.clearLeftoverAccounts) {
            opts = { ...opts, clearLeftoverAccounts: true }
          } else throw err
        } else if (
          ['encoding overruns Uint8Array', 'too large'].some((e) => err.message.includes(e))
        ) {
          // in case of failure to serialize a report, first try buffering (because it gets
          // auto-closed upon successful execution), then ALTs (need a grace period ~3min after
          // deactivation before they can be closed/recycled)
          if (!opts.forceBuffer) opts = { ...opts, forceBuffer: true }
          else if (!opts.forceLookupTable) opts = { ...opts, forceLookupTable: true }
          else throw err
        } else throw err
      }
    } while (!hash)

    try {
      await this.cleanUpBuffers(opts)
    } catch (err) {
      this.logger.warn('Error while trying to clean up buffers:', err)
    }
    const tx = await this.getTransaction(hash)
    return this.getExecutionReceiptInTx(tx)
  }

  /** {@inheritDoc Chain.estimateReceiveExecution} */
  override async estimateReceiveExecution(
    opts: Parameters<NonNullable<Chain['estimateReceiveExecution']>>[0],
  ): Promise<number> {
    let opts_
    if (!('offRamp' in opts)) {
      const { lane, message, metadata } = await this.getMessageById(opts.messageId)
      const offRamp =
        ('offRampAddress' in message && message.offRampAddress) ||
        metadata?.offRamp ||
        (await this.apiClient!.getExecutionInput(opts.messageId)).offRamp

      opts_ = {
        offRamp,
        message: {
          sourceChainSelector: lane.sourceChainSelector,
          messageId: message.messageId,
          receiver: message.receiver,
          sender: message.sender,
          data: message.data,
          destTokenAmounts: await Promise.all(
            message.tokenAmounts.map((tokenAmount) =>
              getDestTokenAmount({ dest: this, tokenAmount }),
            ),
          ),
          tokenReceiver: 'tokenReceiver' in message ? message.tokenReceiver : undefined,
          accounts: 'accounts' in message ? message.accounts : undefined,
          accountIsWritableBitmap:
            'accountIsWritableBitmap' in message ? message.accountIsWritableBitmap : undefined,
        },
      }
    } else {
      opts_ = {
        ...opts,
        message: {
          messageId: hexlify(randomBytes(32)),
          ...opts.message,
          destTokenAmounts: await Promise.all(
            (opts.message.tokenAmounts ?? []).map((tokenAmount) =>
              getDestTokenAmount({ dest: this, tokenAmount }),
            ),
          ),
        },
      }
    }

    const router = await this.getRouterForOffRamp(opts_.offRamp, opts_.message.sourceChainSelector)
    return estimateExecComputeUnits({
      connection: this.connection,
      router,
      ...opts_,
      logger: this.logger,
    })
  }

  /**
   * Clean up and recycle buffers and address lookup tables owned by wallet
   * @param opts - cleanUp options
   *   - wallet - wallet instance to sign txs
   *   - waitDeactivation - Whether to wait for lookup table deactivation cool down period
   *       (513 slots) to pass before closing; by default, we deactivate (if needed) and move on, to
   *       close other ready ALTs
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana wallet
   */
  async cleanUpBuffers(opts: { wallet: unknown; waitDeactivation?: boolean }): Promise<void> {
    const wallet = opts.wallet
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(util.inspect(wallet))
    await cleanUpBuffers(this, wallet, opts)
  }

  /**
   * Parses raw Solana data into typed structures.
   * @param data - Raw data to parse.
   * @returns Parsed data or undefined.
   */
  static parse(data: unknown) {
    if (!data) return
    try {
      if (Array.isArray(data)) {
        if (data.every((e) => typeof e === 'string')) return getErrorFromLogs(data)
        else if (data.every((e) => typeof e === 'object' && 'data' in e && 'address' in e))
          return getErrorFromLogs(data as SolanaLog[])
      } else if (typeof data === 'object') {
        if ('transactionLogs' in data && 'transactionMessage' in data) {
          const parsed = getErrorFromLogs(data.transactionLogs as SolanaLog[] | string[])
          if (parsed) return { message: data.transactionMessage, ...parsed }
        }
        if ('program' in data || 'error' in data) return data
        if ('logs' in data) return getErrorFromLogs(data.logs as SolanaLog[] | string[])
      } else if (typeof data === 'string') {
        const parsedExtraArgs = this.decodeExtraArgs(getDataBytes(data))
        if (parsedExtraArgs) return parsedExtraArgs
        const parsedMessage = this.decodeMessage({ data })
        if (parsedMessage) return parsedMessage
      }
    } catch (_) {
      // Ignore errors during parsing
    }
  }

  /**
   * Solana specialization: for v2 lanes, resolve the verification policy from the offRamp's
   * `getCcvsForMsg` view and fetch CCV results from the indexers (no onchain commit exists);
   * for v1.x, use getProgramAccounts to fetch commit reports from PDAs
   */
  override async getVerifications(
    opts: Parameters<Chain['getVerifications']>[0],
  ): Promise<CCIPVerifications> {
    const { offRamp, request } = opts
    if (request.lane.version >= CCIPVersion.V2_0) {
      // For v2 messages, there is no onchain commit — the verification policy (required/optional
      // CCVs) comes from the OffRamp's `getCcvsForMsg` view, and the actual verifier results
      // come from the CCIP v2 indexer.
      //
      // The view resolves CCVs from three sources (see chainlink-ccip-solana
      // `get_ccvs_for_msg/processor.rs`):
      //   1. Lane defaults + mandated CCVs (always, from SourceChain config)
      //   2. Receiver CCVs (for arbitrary/data messages, via CPI to the receiver program)
      //   3. Pool CCVs (for token transfers, via CPI to the token pool)
      //
      // We resolve receiver CCVs by deriving the `receiver_registry` PDA from the router
      // (read from ReferenceAddresses) and the receiver address. If the registry is owned by
      // the router, the receiver is v2 and we also pass [receiver_program, source_chain_ccv_config]
      // as remaining_accounts for the CPI. If the registry doesn't exist or is system-owned, the
      // receiver is v1 and only the registry is passed.
      //
      // Token transfer CCVs are not yet resolved (TODO: needs 5 pool remaining_accounts).
      const offRampPk = new PublicKey(offRamp)
      const program = new Program(CCIP_OFFRAMP_V2_IDL, offRampPk, simulationProvider(this))
      const pda = (seed: string, ...extra: Uint8Array[]) =>
        PublicKey.findProgramAddressSync([Buffer.from(seed), ...extra], offRampPk)[0]

      // Read ReferenceAddresses to get the router (receiver_registry derivation) and the
      // RMN Remote program (required by the `get_ccvs_for_msg` view since the latest redeploy).
      const refAddresses = await this._getOffRampReferenceAddresses(offRamp)
      const router = refAddresses.router

      // Resolve the receiver and its remaining_accounts
      const message = request.message as CCIPMessage
      let messageReceiver = PublicKey.default
      const remainingAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = []
      if (message.receiver && message.receiver !== '0x') {
        try {
          messageReceiver = new PublicKey(message.receiver)
        } catch {
          // non-svm or zero receiver — leave default, skip receiver consultation
        }
      }
      if (!messageReceiver.equals(PublicKey.default)) {
        // receiver_registry PDA: [RECEIVER_REGISTRY, receiver] under router
        const [registryPda] = PublicKey.findProgramAddressSync(
          [Buffer.from('receiver_registry'), messageReceiver.toBuffer()],
          router,
        )
        const registryAcc = await this.connection.getAccountInfo(registryPda)
        const isV2 =
          registryAcc != null && registryAcc.owner.equals(router) && registryAcc.data.length >= 8
        remainingAccounts.push({
          pubkey: registryPda,
          isSigner: false,
          isWritable: false,
        })
        if (isV2) {
          // v2 receiver: also pass [receiver_program, source_chain_ccv_config]
          // source_chain_ccv_config PDA: [ccv_config, sourceChainSelectorLE] under receiver
          const [ccvConfigPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('ccv_config'), toLeArray(request.lane.sourceChainSelector, 8)],
            messageReceiver,
          )
          remainingAccounts.push({
            pubkey: messageReceiver,
            isSigner: false,
            isWritable: false,
          })
          remainingAccounts.push({
            pubkey: ccvConfigPda,
            isSigner: false,
            isWritable: false,
          })
        }
      }

      // RMN Remote CPI accounts (required by the latest offramp). The `rmn_remote` program is
      // read from ReferenceAddresses; its two config/curse PDAs are derived under it.
      const [rmnRemoteCurses] = PublicKey.findProgramAddressSync(
        [Buffer.from('curses')],
        refAddresses.rmnRemote,
      )
      const [rmnRemoteConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from('config')],
        refAddresses.rmnRemote,
      )

      const ccvs = (await program.methods
        .getCcvsForMsg({
          // TODO: token transfers require 5 pool remaining_accounts for pool CCV resolution
          tokenTransfer: null,
          messageReceiver,
          sender: Buffer.from(getAddressBytes(message.sender)),
          resolutionMetadata: Buffer.alloc(0),
          remoteChainSelector: new BN(request.lane.sourceChainSelector.toString()),
          requestedFinality: { flags: 0, blockDepth: 0 },
        })
        .accounts({
          config: pda('config'),
          referenceAddresses: pda('reference_addresses'),
          sourceChain: pda('source_chain_state', toLeArray(request.lane.sourceChainSelector, 8)),
          rmnRemote: refAddresses.rmnRemote,
          rmnRemoteCurses,
          rmnRemoteConfig,
        })
        .remainingAccounts(remainingAccounts)
        .view()) as {
        requiredCcvs: PublicKey[]
        optionalCcvs: PublicKey[]
        optionalThreshold: number
      }
      const verificationPolicy = {
        requiredCCVs: ccvs.requiredCcvs.map((c) => c.toBase58()),
        optionalCCVs: ccvs.optionalCcvs.map((c) => c.toBase58()),
        optionalThreshold: ccvs.optionalThreshold,
      }
      const verifications = await fetchVerifications(request.message.messageId, {
        apiClient: this.apiClient,
        indexer: opts.indexer ?? this.network.networkType,
        watch:
          opts.watch instanceof AbortSignal
            ? AbortSignal.any([opts.watch, this.abort])
            : opts.watch
              ? this.abort
              : undefined,
      })
      return { verificationPolicy, verifications }
    }
    const commitsAroundSeqNum = await this.connection.getProgramAccounts(new PublicKey(offRamp), {
      filters: [
        {
          // commit report account discriminator filter
          memcmp: {
            offset: 0,
            bytes: encodeBase58(BorshAccountsCoder.accountDiscriminator('CommitReport')),
          },
        },
        {
          // sourceChainSelector filter
          memcmp: {
            offset: 8 + 1,
            bytes: encodeBase58(toLeArray(request.lane.sourceChainSelector, 8)),
          },
        },
        // memcmp report.min with msg.sequenceNumber's without least-significant byte;
        // this should be ~256 around seqNum, i.e. big chance of a match; requires PDAs not to have been closed
        {
          memcmp: {
            offset: 8 + 1 + 8 + 32 + 8 + /*skip byte*/ 1,
            bytes: encodeBase58(toLeArray(request.message.sequenceNumber, 8).slice(1)),
          },
        },
      ],
    })
    for (const acc of commitsAroundSeqNum) {
      // const merkleRoot = acc.account.data.subarray(8 + 1 + 8, 8 + 1 + 8 + 32)
      const minSeqNr = acc.account.data.readBigUInt64LE(8 + 1 + 8 + 32 + 8)
      const maxSeqNr = acc.account.data.readBigUInt64LE(8 + 1 + 8 + 32 + 8 + 8)
      if (
        BigInt(request.message.sequenceNumber) < minSeqNr ||
        maxSeqNr < BigInt(request.message.sequenceNumber)
      )
        continue
      // we have all the commit report info, but we also need log details (txHash, etc)
      for await (const log of this.getLogs({
        startTime: 1, // just to force getting the oldest log first
        programs: [offRamp],
        address: acc.pubkey.toBase58(),
        topics: ['CommitReportAccepted'],
      })) {
        // first yielded log should be commit (which created this PDA)
        const report = (this.constructor as typeof SolanaChain).decodeCommits(
          log,
          request.lane,
        )?.[0]
        if (report) return { report, log }
      }
    }
    // in case we can't find it, fallback to generic iterating txs
    return super.getVerifications(opts)
  }

  /** {@inheritDoc Chain.getExecutionReceipts} */
  override async *getExecutionReceipts(
    opts: Parameters<Chain['getExecutionReceipts']>[0],
  ): AsyncIterableIterator<CCIPExecution> {
    const { offRamp, sourceChainSelector, verifications, messageId } = opts
    const [, version] = await this.typeAndVersion(offRamp)
    const topics = [
      version >= CCIPVersion.V2_0 ? 'ExecutionStateChangedV2' : 'ExecutionStateChanged',
    ]
    let opts_: Parameters<Chain['getExecutionReceipts']>[0] &
      Parameters<SolanaChain['getLogs']>[0] = { ...opts, topics }
    if (version >= CCIPVersion.V2_0 && messageId) {
      // Every v2 execution attempt (executor or manual, including retries) touches
      // the per-message `message_exec_state` PDA (seeded with the message id) on the
      // offRamp, so the message's execution txs are exactly the signatures of that
      // PDA. Narrowing the scan to it replaces a full offRamp-address sweep (one
      // getTransaction per tx in the start window — the dominant cost under load)
      // with the handful of txs of this message's own attempts.
      const [messageExecStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('message_exec_state'), bytesToBuffer(messageId)],
        new PublicKey(offRamp),
      )
      opts_ = {
        ...opts,
        topics,
        programs: [offRamp],
        address: messageExecStatePda.toBase58(),
      }
    } else if (sourceChainSelector && verifications && 'report' in verifications) {
      // if we know of commit, use `commit_report` PDA as more specialized address
      const [commitReportPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('commit_report'),
          toLeArray(sourceChainSelector, 8),
          bytesToBuffer(verifications.report.merkleRoot),
        ],
        new PublicKey(offRamp),
      )
      opts_ = {
        ...opts,
        topics,
        programs: [offRamp],
        address: commitReportPda.toBase58(),
      }
    }
    yield* super.getExecutionReceipts(opts_)
  }

  /**
   * {@inheritDoc Chain.getRegistryTokenConfig}
   * @throws {@link CCIPTokenNotConfiguredError} if token is not configured in registry
   */
  async getRegistryTokenConfig(
    registry: string,
    token: string,
  ): Promise<{
    administrator: string
    pendingAdministrator?: string
    tokenPool?: string
  }> {
    const registry_ = new PublicKey(registry)
    const tokenMint = new PublicKey(token)

    const [tokenAdminRegistryAddr] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_admin_registry'), tokenMint.toBuffer()],
      registry_,
    )

    const tokenAdminRegistry = await this.connection.getAccountInfo(tokenAdminRegistryAddr)
    if (!tokenAdminRegistry) throw new CCIPTokenNotConfiguredError(token, registry)

    const config: {
      administrator: string
      pendingAdministrator?: string
      tokenPool?: string
    } = {
      administrator: encodeBase58(tokenAdminRegistry.data.subarray(9, 9 + 32)),
    }
    const pendingAdministrator = new PublicKey(tokenAdminRegistry.data.subarray(41, 41 + 32))

    // Check if pendingAdministrator is set (not system program address)
    if (
      !pendingAdministrator.equals(SystemProgram.programId) &&
      !pendingAdministrator.equals(PublicKey.default)
    ) {
      config.pendingAdministrator = pendingAdministrator.toBase58()
    }

    // Get token pool from lookup table if available
    try {
      const lookupTableAddr = new PublicKey(tokenAdminRegistry.data.subarray(73, 73 + 32))
      const lookupTable = await this.connection.getAddressLookupTable(lookupTableAddr)
      if (lookupTable.value) {
        // tokenPool state PDA is at index [3]
        const tokenPoolAddress = lookupTable.value.state.addresses[3]
        if (tokenPoolAddress && !tokenPoolAddress.equals(PublicKey.default)) {
          config.tokenPool = tokenPoolAddress.toBase58()
        }
      }
    } catch (_err) {
      // Token pool may not be configured yet
    }
    return config
  }

  /**
   * {@inheritDoc Chain.getTokenPoolConfig}
   * @throws {@link CCIPTokenPoolStateNotFoundError} if token pool state not found
   */
  async getTokenPoolConfig(
    tokenPool: string,
    _feeOpts?: TokenTransferFeeOpts,
  ): Promise<{
    token: string
    router: string
    tokenPoolProgram: string
    typeAndVersion?: string
  }> {
    // `tokenPool` is actually a State PDA in the tokenPoolProgram
    const tokenPoolState = await this.connection.getAccountInfo(new PublicKey(tokenPool))
    if (!tokenPoolState || tokenPoolState.data.length < 266 + 32)
      throw new CCIPTokenPoolStateNotFoundError(tokenPool)
    const tokenPoolProgram = tokenPoolState.owner.toBase58()

    let typeAndVersion
    try {
      ;[, , typeAndVersion] = await this.typeAndVersion(tokenPoolProgram)
    } catch (_) {
      // TokenPool may not have a typeAndVersion
    }

    // const { config }: { config: IdlTypes<typeof BASE_TOKEN_POOL>['BaseConfig'] } =
    //   tokenPoolCoder.accounts.decode('state', tokenPoolState.data)
    const mint = new PublicKey(tokenPoolState.data.subarray(41, 41 + 32))
    const router = new PublicKey(tokenPoolState.data.subarray(266, 266 + 32))

    return {
      token: mint.toBase58(),
      router: router.toBase58(),
      tokenPoolProgram,
      typeAndVersion,
    }
  }

  /**
   * {@inheritDoc Chain.getTokenPoolRemotes}
   * @throws {@link CCIPTokenPoolStateNotFoundError} if token pool state not found
   * @throws {@link CCIPTokenPoolChainConfigNotFoundError} if chain config not found for specified selector
   */
  async getTokenPoolRemotes(
    tokenPool: string,
    remoteChainSelector?: bigint,
  ): Promise<Record<string, TokenPoolRemote>> {
    // `tokenPool` is actually a State PDA in the tokenPoolProgram
    const tokenPoolState = await this.connection.getAccountInfo(new PublicKey(tokenPool))
    if (!tokenPoolState) throw new CCIPTokenPoolStateNotFoundError(tokenPool)

    const tokenPoolProgram = tokenPoolState.owner

    const { config }: { config: { mint: PublicKey; router: PublicKey } } =
      tokenPoolCoder.accounts.decode('state', tokenPoolState.data)

    // Get all supported chains by fetching ChainConfig PDAs
    // We need to scan for all ChainConfig accounts owned by this token pool program
    const remotes: Record<string, TokenPoolRemote> = {}

    // Fetch all ChainConfig accounts for this token pool
    let selectors: { selector: bigint }[] = Object.values(SELECTORS)
    let accounts
    if (remoteChainSelector) {
      selectors = [{ selector: remoteChainSelector }]
      const [chainConfigAddr] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('ccip_tokenpool_chainconfig'),
          toLeArray(remoteChainSelector, 8),
          config.mint.toBuffer(),
        ],
        tokenPoolProgram,
      )
      const chainConfigAcc = await this.connection.getAccountInfo(chainConfigAddr)
      if (!chainConfigAcc)
        throw new CCIPTokenPoolChainConfigNotFoundError(
          chainConfigAddr.toBase58(),
          tokenPool,
          networkInfo(remoteChainSelector).name,
        )
      accounts = [
        {
          pubkey: chainConfigAddr,
          account: chainConfigAcc,
        },
      ]
    } else
      accounts = await this.connection.getProgramAccounts(tokenPoolProgram, {
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: encodeBase58(BorshAccountsCoder.accountDiscriminator('ChainConfig')),
            },
          },
        ],
      })

    for (const acc of accounts) {
      try {
        let base: IdlTypes<typeof BASE_TOKEN_POOL>['BaseChain']
        try {
          ;({ base } = tokenPoolCoder.accounts.decode('chainConfig', acc.account.data))
        } catch (_) {
          ;({ base } = cctpTokenPoolCoder.accounts.decode('chainConfig', acc.account.data))
        }

        let remoteChainSelector
        // test all selectors, to find the correct seed
        for (const { selector } of Object.values(selectors)) {
          const [chainConfigAddr] = PublicKey.findProgramAddressSync(
            [
              Buffer.from('ccip_tokenpool_chainconfig'),
              toLeArray(selector, 8),
              config.mint.toBuffer(),
            ],
            tokenPoolProgram,
          )
          if (chainConfigAddr.equals(acc.pubkey)) {
            remoteChainSelector = selector
            break
          }
        }
        if (!remoteChainSelector) continue

        const remoteNetwork = networkInfo(remoteChainSelector)

        const remoteToken = decodeAddress(base.remote.tokenAddress.address, remoteNetwork.family)

        const remotePools = base.remote.poolAddresses.map((pool) =>
          decodeAddress(pool.address, remoteNetwork.family),
        )

        const inboundRateLimiterState = convertRateLimiter(base.inboundRateLimit)
        const outboundRateLimiterState = convertRateLimiter(base.outboundRateLimit)

        remotes[remoteNetwork.name] = {
          remoteToken,
          remotePools,
          inboundRateLimiterState,
          outboundRateLimiterState,
        }
      } catch (err) {
        this.logger.warn('Failed to decode ChainConfig account:', err)
      }
    }

    return remotes
  }

  /** {@inheritDoc Chain.getSupportedTokens} */
  async getSupportedTokens(router: string): Promise<string[]> {
    // `mint` offset in TokenAdminRegistry account data; more robust against changes in layout
    const mintOffset = 8 + 1 + 32 + 32 + 32 + 16 * 2 // = 137
    const router_ = new PublicKey(router)
    const res = []
    for (const acc of await this.connection.getProgramAccounts(router_, {
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: encodeBase58(BorshAccountsCoder.accountDiscriminator('TokenAdminRegistry')),
          },
        },
      ],
    })) {
      if (acc.account.data.length < mintOffset + 32) continue
      const mint = new PublicKey(acc.account.data.subarray(mintOffset, mintOffset + 32))
      const [derivedPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('token_admin_registry'), mint.toBuffer()],
        router_,
      )
      if (!acc.pubkey.equals(derivedPda)) continue
      res.push(mint.toBase58())
    }
    return res
  }

  /** {@inheritDoc Chain.getFeeTokens} */
  async getFeeTokens(router: string): Promise<Record<string, TokenInfo>> {
    const { feeQuoter } = await this._getRouterConfig(router)
    const tokenConfigs = await this.connection.getProgramAccounts(feeQuoter, {
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: encodeBase58(
              BorshAccountsCoder.accountDiscriminator('BillingTokenConfigWrapper'),
            ),
          },
        },
      ],
    })
    return Object.fromEntries(
      await Promise.all(
        tokenConfigs.map(async (acc) => {
          const token = new PublicKey(acc.account.data.subarray(10, 10 + 32)).toBase58()
          return [token, await this.getTokenInfo(token)] as const
        }),
      ),
    )
  }

  /** {@inheritDoc Chain.getTokenPrice} */
  override async getTokenPrice(opts: {
    router: string
    token: string
    timestamp?: number
  }): Promise<TokenPrice> {
    if (opts.timestamp != null) {
      this.logger.warn(
        'getTokenPrice: timestamp parameter not yet supported on Solana, returning latest price',
      )
    }
    const { feeQuoter } = await this._getRouterConfig(opts.router)

    // Resolve native SOL to wrapped SOL (NATIVE_MINT)
    const tokenMint =
      !opts.token || opts.token === PublicKey.default.toBase58()
        ? NATIVE_MINT
        : new PublicKey(opts.token)

    const feeQuoterProgram = new Program(FEE_QUOTER_IDL, feeQuoter, {
      connection: this.connection,
    })

    const [billingTokenConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('fee_billing_token_config'), tokenMint.toBuffer()],
      feeQuoter,
    )

    const [billingTokenConfigWrapper, { decimals }] = await Promise.all([
      feeQuoterProgram.account.billingTokenConfigWrapper.fetch(billingTokenConfigPda),
      this.getTokenInfo(tokenMint.toBase58()),
    ])

    const usdPerToken = billingTokenConfigWrapper.config.usdPerToken
    return { price: Number(toBigInt(Buffer.from(usdPerToken.value))) * 10 ** (decimals - 36) }
  }

  /**
   * Gets the router configuration from the Config PDA.
   * @param router - Router program address.
   * @returns Router configuration including feeQuoter.
   */
  async _getRouterConfig(router: string) {
    const program = new Program(CCIP_ROUTER_IDL, new PublicKey(router), {
      connection: this.connection,
    })

    const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId)

    // feeQuoter is present in router's config, and has a DestChainState account which is updated by
    // the offramps, so we can use it to narrow the search for the offramp
    return program.account.config.fetch(configPda)
  }

  /**
   * Returns a copy of a message, populating missing fields like `extraArgs` with defaults.
   * It's expected to return a message suitable at least for basic token transfers.
   *
   * @remarks
   * Solana-specific receiver/tokenReceiver handling:
   * - Explicit `tokenReceiver` in extraArgs: both `receiver` and `tokenReceiver` are kept as provided.
   * - Tokens but no explicit `tokenReceiver`: `receiver` is set to `PublicKey.default` and
   *   `tokenReceiver` is set to `message.receiver`.
   * - No tokens: `tokenReceiver` is set to `PublicKey.default` and `receiver` is `message.receiver`.
   *
   * Accepts `gasLimit` as an alias for `computeUnits` in extraArgs.
   *
   * @param message - AnyMessage (from source), containing at least `receiver`
   * @returns A message suitable for `sendMessage` to this destination chain family
   * @throws {@link CCIPArgumentInvalidError} if tokenReceiver missing when sending tokens with data
   * @throws {@link CCIPArgumentInvalidError} if extraArgs contains unknown fields for SVMExtraArgsV1
   */
  static override buildMessageForDest(
    message: Parameters<ChainStatic['buildMessageForDest']>[0],
  ): AnyMessage & { extraArgs: SVMExtraArgsV1 } {
    /** Valid field names for SVMExtraArgsV1, including recognised aliases. */
    const SVM_EXTRA_ARGS_FIELDS = new Set([
      'computeUnits',
      'gasLimit', // alias for computeUnits
      'allowOutOfOrderExecution',
      'tokenReceiver',
      'accounts',
      'accountIsWritableBitmap',
    ])
    if (message.extraArgs) {
      const unknown = Object.keys(message.extraArgs).filter(
        (k) => k !== '_tag' && !SVM_EXTRA_ARGS_FIELDS.has(k),
      )
      if (unknown.length)
        throw new CCIPArgumentInvalidError(
          'extraArgs',
          `unknown field(s) for SVMExtraArgsV1: ${unknown.map((k) => JSON.stringify(k)).join(', ')}`,
        )
    }
    if (
      !(
        message.extraArgs &&
        'tokenReceiver' in message.extraArgs &&
        message.extraArgs.tokenReceiver
      ) &&
      message.data &&
      getDataBytes(message.data).length &&
      message.tokenAmounts?.length
    )
      throw new CCIPArgumentInvalidError(
        'tokenReceiver',
        'required when sending tokens with data to Solana',
      )

    const computeUnits =
      message.extraArgs &&
      'computeUnits' in message.extraArgs &&
      message.extraArgs.computeUnits != null
        ? message.extraArgs.computeUnits
        : message.extraArgs && 'gasLimit' in message.extraArgs && message.extraArgs.gasLimit != null
          ? message.extraArgs.gasLimit // populates computeUnits from gasLimit
          : message.data && getDataBytes(message.data).length
            ? DEFAULT_GAS_LIMIT
            : 0n
    const allowOutOfOrderExecution =
      message.extraArgs &&
      'allowOutOfOrderExecution' in message.extraArgs &&
      message.extraArgs.allowOutOfOrderExecution != null
        ? message.extraArgs.allowOutOfOrderExecution
        : true
    const [tokenReceiver, receiver] =
      message.extraArgs && 'tokenReceiver' in message.extraArgs && !!message.extraArgs.tokenReceiver
        ? [this.getAddress(message.extraArgs.tokenReceiver), this.getAddress(message.receiver)] // explicit tokenReceiver, keep both
        : message.tokenAmounts?.length
          ? [this.getAddress(message.receiver), PublicKey.default.toBase58()] // if sending tokens without tokenReceiver, set receiver to default and tokenReceiver to message.receiver
          : [PublicKey.default.toBase58(), this.getAddress(message.receiver)] // otherwise, tokenReceiver is default and receiver is message.receiver
    const accounts =
      message.extraArgs && 'accounts' in message.extraArgs && message.extraArgs.accounts != null
        ? message.extraArgs.accounts.map(this.getAddress.bind(this))
        : []
    const accountIsWritableBitmap =
      message.extraArgs &&
      'accountIsWritableBitmap' in message.extraArgs &&
      message.extraArgs.accountIsWritableBitmap != null
        ? message.extraArgs.accountIsWritableBitmap
        : 0n

    const extraArgs: SVMExtraArgsV1 = {
      computeUnits,
      allowOutOfOrderExecution,
      tokenReceiver,
      accounts,
      accountIsWritableBitmap,
    }

    return {
      ...message,
      receiver,
      extraArgs,
    }
  }
}
