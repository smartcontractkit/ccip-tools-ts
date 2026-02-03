import { Buffer } from 'buffer'

import { type Idl, type IdlTypes, BorshAccountsCoder, BorshCoder, Program } from '@coral-xyz/anchor'
import { NATIVE_MINT } from '@solana/spl-token'
import {
  type Commitment,
  type ConnectionConfig,
  type Finality,
  type SignaturesForAddressOptions,
  type VersionedTransactionResponse,
  Connection,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SystemProgram,
} from '@solana/web3.js'
import bs58 from 'bs58'
import {
  type BytesLike,
  concat,
  dataLength,
  dataSlice,
  encodeBase58,
  encodeBase64,
  hexlify,
  isHexString,
  toBigInt,
} from 'ethers'
import { type Memoized, memoize } from 'micro-memoize'
import type { PickDeep } from 'type-fest'

import {
  type ChainContext,
  type ChainStatic,
  type GetBalanceOpts,
  type LogFilter,
  type TokenInfo,
  type TokenPoolRemote,
  Chain,
} from '../chain.ts'
import {
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
  CCIPSolanaExtraArgsEncodingError,
  CCIPSolanaOffRampEventsNotFoundError,
  CCIPSolanaRefAddressesNotFoundError,
  CCIPSplTokenInvalidError,
  CCIPTokenAccountNotFoundError,
  CCIPTokenDataParseError,
  CCIPTokenNotConfiguredError,
  CCIPTokenPoolChainConfigNotFoundError,
  CCIPTokenPoolInfoNotFoundError,
  CCIPTokenPoolStateNotFoundError,
  CCIPTopicsInvalidError,
  CCIPTransactionNotFoundError,
  CCIPWalletInvalidError,
} from '../errors/index.ts'
import {
  type EVMExtraArgsV2,
  type ExtraArgs,
  type SVMExtraArgsV1,
  EVMExtraArgsV2Tag,
} from '../extra-args.ts'
import type { LeafHasher } from '../hasher/common.ts'
import SELECTORS from '../selectors.ts'
import { supportedChains } from '../supported-chains.ts'
import {
  type AnyMessage,
  type CCIPCommit,
  type CCIPExecution,
  type CCIPMessage,
  type CCIPRequest,
  type ChainTransaction,
  type CommitReport,
  type ExecutionReceipt,
  type ExecutionReport,
  type Lane,
  type Log_,
  type MergeArrayElements,
  type NetworkInfo,
  type OffchainTokenData,
  type WithLogger,
  CCIPVersion,
  ChainFamily,
  ExecutionState,
} from '../types.ts'
import {
  bytesToBuffer,
  createRateLimitedFetch,
  decodeAddress,
  decodeOnRampAddress,
  getDataBytes,
  leToBigInt,
  networkInfo,
  parseTypeAndVersion,
  toLeArray,
  util,
} from '../utils.ts'
import { cleanUpBuffers } from './cleanup.ts'
import { generateUnsignedExecuteReport } from './exec.ts'
import { getV16SolanaLeafHasher } from './hasher.ts'
import { IDL as BASE_TOKEN_POOL } from './idl/1.6.0/BASE_TOKEN_POOL.ts'
import { IDL as BURN_MINT_TOKEN_POOL } from './idl/1.6.0/BURN_MINT_TOKEN_POOL.ts'
import { IDL as CCIP_CCTP_TOKEN_POOL } from './idl/1.6.0/CCIP_CCTP_TOKEN_POOL.ts'
import { IDL as CCIP_OFFRAMP_IDL } from './idl/1.6.0/CCIP_OFFRAMP.ts'
import { IDL as CCIP_ROUTER_IDL } from './idl/1.6.0/CCIP_ROUTER.ts'
import { getTransactionsForAddress } from './logs.ts'
import { fetchSolanaOffchainTokenData } from './offchain.ts'
import { generateUnsignedCcipSend, getFee } from './send.ts'
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
import { buildMessageForDest, getMessagesInBatch } from '../requests.ts'
import { patchBorsh } from './patchBorsh.ts'
import { DEFAULT_GAS_LIMIT } from '../evm/const.ts'
export type { UnsignedSolanaTx }

const routerCoder = new BorshCoder(CCIP_ROUTER_IDL)
const offrampCoder = new BorshCoder(CCIP_OFFRAMP_IDL)
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
}

// hardcoded symbols for tokens without metadata
const unknownTokens: { [mint: string]: string } = {
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': 'USDC', // devnet
}

/** Solana-specific log structure with transaction reference and log level. */
export type SolanaLog = Log_ & { tx: SolanaTransaction; data: string; level: number }
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
  readonly destroy$: Promise<void>

  /**
   * Creates a new SolanaChain instance.
   * @param connection - Solana connection instance.
   * @param network - Network information for this chain.
   */
  constructor(connection: Connection, network: NetworkInfo, ctx?: ChainContext) {
    super(network, ctx)

    this.connection = connection
    this.destroy$ = new Promise<void>((resolve) => (this.destroy = resolve))

    // Memoize expensive operations
    this.typeAndVersion = memoize(this.typeAndVersion.bind(this), {
      maxArgs: 1,
      async: true,
    })
    this.getBlockTimestamp = memoize(this.getBlockTimestamp.bind(this), {
      async: true,
      maxSize: 100,
      forceUpdate: ([k]) => typeof k !== 'number' || k <= 0,
    })
    this.getTransaction = memoize(this.getTransaction.bind(this), {
      maxSize: 100,
      maxArgs: 1,
    })
    this.getTokenForTokenPool = memoize(this.getTokenForTokenPool.bind(this))
    this.getTokenInfo = memoize(this.getTokenInfo.bind(this))
    this.connection.getSignaturesForAddress = memoize(
      this.connection.getSignaturesForAddress.bind(this.connection),
      {
        maxSize: 100,
        async: true,
        // if options.before is defined, caches for long, otherwise for short (recent signatures)
        expires: (key) => (key[1] ? 2 ** 31 - 1 : 5e3),
        transformKey: ([address, options, commitment]: [
          address: PublicKey,
          options?: SignaturesForAddressOptions,
          commitment?: Finality,
        ]) =>
          [
            address.toBase58(),
            options?.before,
            options?.until,
            options?.limit,
            commitment,
          ] as const,
      },
    )
    // cache account info for 30 seconds
    this.connection.getAccountInfo = memoize(this.connection.getAccountInfo.bind(this.connection), {
      maxSize: 100,
      maxArgs: 2,
      expires: 30e3,
      transformKey: ([address, commitment]) =>
        [(address as PublicKey).toString(), commitment] as const,
    })

    this._getRouterConfig = memoize(this._getRouterConfig.bind(this), { maxArgs: 1 })

    this.getFeeTokens = memoize(this.getFeeTokens.bind(this), { maxArgs: 1 })
    this.getOffRampsForRouter = memoize(this.getOffRampsForRouter.bind(this), { maxArgs: 1 })
  }

  /**
   * Creates a Solana connection from a URL.
   * @param url - RPC endpoint URL (https://, http://, wss://, or ws://).
   * @param ctx - context containing logger.
   * @returns Solana Connection instance.
   * @throws {@link CCIPDataFormatUnsupportedError} if URL format is invalid
   */
  static _getConnection(url: string, ctx?: WithLogger): Connection {
    const { logger = console } = ctx ?? {}
    if (!url.startsWith('http') && !url.startsWith('ws')) {
      throw new CCIPDataFormatUnsupportedError(
        `Invalid Solana RPC URL format (should be https://, http://, wss://, or ws://): ${url}`,
      )
    }

    const config: ConnectionConfig = { commitment: 'confirmed' }
    if (url.includes('.solana.com')) {
      config.fetch = createRateLimitedFetch(undefined, ctx) // public nodes
      logger.warn('Using rate-limited fetch for public solana nodes, commands may be slow')
    }

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
   * @param url - RPC endpoint URL.
   * @param ctx - context containing logger.
   * @returns A new SolanaChain instance.
   */
  static async fromUrl(url: string, ctx?: ChainContext): Promise<SolanaChain> {
    const connection = this._getConnection(url, ctx)
    return this.fromConnection(connection, ctx)
  }

  // cached
  /**
   * {@inheritDoc Chain.getBlockTimestamp}
   * @throws {@link CCIPBlockTimeNotFoundError} if block time cannot be retrieved
   */
  async getBlockTimestamp(block: number | 'latest' | 'finalized'): Promise<number> {
    if (typeof block !== 'number') {
      const slot = await this.connection.getSlot(block === 'latest' ? 'confirmed' : block)
      const blockTime = await this.connection.getBlockTime(slot)
      if (blockTime === null) {
        throw new CCIPBlockTimeNotFoundError(`finalized slot ${slot}`)
      }
      return blockTime
    } else if (block <= 0) {
      block = (await this.connection.getSlot('confirmed')) + block
    }

    const blockTime = await this.connection.getBlockTime(block)
    if (blockTime === null) {
      throw new CCIPBlockTimeNotFoundError(block)
    }
    return blockTime
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
    if (!tx) throw new CCIPTransactionNotFoundError(hash)
    if (tx.blockTime) {
      ;(
        this.getBlockTimestamp as Memoized<typeof this.getBlockTimestamp, { async: true }>
      ).cache.set([tx.slot], Promise.resolve(tx.blockTime))
    } else {
      tx.blockTime = await this.getBlockTimestamp(tx.slot)
    }

    // Parse logs from transaction using helper function
    const logs_ = tx.meta?.logMessages?.length
      ? parseSolanaLogs(tx.meta.logMessages).map((l) => ({
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
    chainTx.logs = logs_.map((l) => Object.assign(l, { tx: chainTx }))
    return chainTx
  }

  /**
   * Internal method to get transactions for an address with pagination.
   * @param opts - Log filter options.
   * @returns Async generator of Solana transactions.
   */
  async *getTransactionsForAddress(
    opts: Omit<LogFilter, 'topics'>,
  ): AsyncGenerator<SolanaTransaction> {
    if (opts.watch instanceof Promise)
      opts = { ...opts, watch: Promise.race([opts.watch, this.destroy$]) }
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
   *   * Fetches signatures in reverse chronological order (newest first)
   *   * Returns logs in reverse chronological order (newest first)
   *
   * @param opts - Log filter options containing:
   *   - `startBlock`: Starting slot number (inclusive)
   *   - `startTime`: Starting Unix timestamp (inclusive)
   *   - `endBlock`: Ending slot number (inclusive)
   *   - `endBefore`: Fetch signatures before this transaction
   *   - `address`: Program address to filter logs by (required for Solana)
   *   - `topics`: Array of topics to filter logs by (optional); either 0x-8B discriminants or event names
   *   - `watch`: Watch for new logs
   *   - `programs`: Special option to allow querying by address of interest, but yielding matching
   *     logs from specific (string address) program or any (true)
   * @returns AsyncIterableIterator of parsed Log_ objects.
   * @throws {@link CCIPLogsAddressRequiredError} if address is not provided
   * @throws {@link CCIPTopicsInvalidError} if topics contain invalid values
   */
  async *getLogs(
    opts: LogFilter & { programs?: string[] | true },
  ): AsyncGenerator<Log_ & { tx: SolanaTransaction }> {
    let programs: true | string[]
    if (!opts.address) {
      throw new CCIPLogsAddressRequiredError()
    } else if (!opts.programs) {
      programs = [opts.address]
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
    for await (const tx of this.getTransactionsForAddress(opts)) {
      let logs = tx.logs
      if (opts.startBlock == null && opts.startTime == null) logs = logs.toReversed() // backwards
      for (const log of logs) {
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
        yield log
      }
    }
  }

  /** {@inheritDoc Chain.getMessagesInBatch} */
  async getMessagesInBatch<
    R extends PickDeep<
      CCIPRequest,
      'lane' | `log.${'topics' | 'address' | 'blockNumber'}` | 'message.sequenceNumber'
    >,
  >(
    request: R,
    commit: Pick<CommitReport, 'minSeqNr' | 'maxSeqNr'>,
    opts?: { page?: number },
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
    return getMessagesInBatch(this, request, commit, opts_)
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

  /** {@inheritDoc Chain.getRouterForOnRamp} */
  getRouterForOnRamp(onRamp: string, _destChainSelector: bigint): Promise<string> {
    return Promise.resolve(onRamp) // Solana's router is also the onRamp
  }

  /**
   * {@inheritDoc Chain.getRouterForOffRamp}
   * @throws {@link CCIPSolanaRefAddressesNotFoundError} if reference addresses PDA not found
   */
  async getRouterForOffRamp(offRamp: string, _sourceChainSelector: bigint): Promise<string> {
    const offRamp_ = new PublicKey(offRamp)
    const program = new Program(CCIP_OFFRAMP_IDL as Idl, offRamp_, {
      connection: this.connection,
    })

    const [referenceAddressesAddr] = PublicKey.findProgramAddressSync(
      [Buffer.from('reference_addresses')],
      offRamp_,
    )
    const referenceAddressesPda = await this.connection.getAccountInfo(referenceAddressesAddr)
    if (!referenceAddressesPda) throw new CCIPSolanaRefAddressesNotFoundError(offRamp)

    // Decode the config account using the program's coder
    const { router }: { router: PublicKey } = program.coder.accounts.decode(
      'referenceAddresses',
      referenceAddressesPda.data,
    )
    return router.toBase58()
  }

  /** {@inheritDoc Chain.getNativeTokenForRouter} */
  getNativeTokenForRouter(_router: string): Promise<string> {
    return Promise.resolve(NATIVE_MINT.toBase58())
  }

  /**
   * {@inheritDoc Chain.getOffRampsForRouter}
   * @throws {@link CCIPSolanaOffRampEventsNotFoundError} if no OffRamp events found
   */
  async getOffRampsForRouter(router: string, sourceChainSelector: bigint): Promise<string[]> {
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
      topics: ['ExecutionStateChanged', 'CommitReportAccepted', 'Transmitted'],
    })) {
      return [log.address] // assume single offramp per router/deployment on Solana
    }
    throw new CCIPSolanaOffRampEventsNotFoundError(feeQuoter.toString())
  }

  /** {@inheritDoc Chain.getOnRampForRouter} */
  getOnRampForRouter(router: string, _destChainSelector: bigint): Promise<string> {
    return Promise.resolve(router) // solana's Router is also the OnRamp
  }

  /** {@inheritDoc Chain.getOnRampForOffRamp} */
  async getOnRampForOffRamp(offRamp: string, sourceChainSelector: bigint): Promise<string> {
    const program = new Program(CCIP_OFFRAMP_IDL, new PublicKey(offRamp), {
      connection: this.connection,
    })

    const [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('source_chain_state'), toLeArray(sourceChainSelector, 8)],
      program.programId,
    )

    // Decode the config account using the program's coder
    const {
      config: { onRamp },
    } = await program.account.sourceChain.fetch(statePda)
    return decodeAddress(
      new Uint8Array(onRamp.bytes.slice(0, onRamp.len)),
      networkInfo(sourceChainSelector).family,
    )
  }

  /** {@inheritDoc Chain.getCommitStoreForOffRamp} */
  getCommitStoreForOffRamp(offRamp: string): Promise<string> {
    return Promise.resolve(offRamp) // Solana supports only CCIP>=1.6, for which OffRamp and CommitStore are the same
  }

  /**
   * {@inheritDoc Chain.getTokenForTokenPool}
   * @throws {@link CCIPTokenPoolInfoNotFoundError} if token pool info not found
   */
  async getTokenForTokenPool(tokenPool: string): Promise<string> {
    const tokenPoolInfo = await this.connection.getAccountInfo(new PublicKey(tokenPool))
    if (!tokenPoolInfo) throw new CCIPTokenPoolInfoNotFoundError(tokenPool)
    const { config }: { config: { mint: PublicKey } } = tokenPoolCoder.accounts.decode(
      'state',
      tokenPoolInfo.data,
    )
    return config.mint.toString()
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
      let symbol = data.symbol || unknownTokens[token] || 'UNKNOWN'
      let name = data.name

      // If symbol or name is missing, try to fetch from Metaplex metadata
      if (!data.symbol || symbol === 'UNKNOWN' || !data.name) {
        try {
          const metadata = await this._fetchTokenMetadata(mint)
          if (metadata) {
            if (metadata.symbol && (!data.symbol || symbol === 'UNKNOWN')) {
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
      if (dataSlice(getDataBytes(data), 0, 8) !== hexDiscriminator('CCIPMessageSent')) return
    } catch (_) {
      return
    }

    const decoded = routerCoder.events.decode<
      (typeof CCIP_ROUTER_IDL)['events'][number] & { name: 'CCIPMessageSent' },
      IdlTypes<typeof CCIP_ROUTER_IDL>
    >(data)
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
    const { _tag, ...rest } = parsed

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
    } as CCIPMessage<typeof CCIPVersion.V1_6>
  }

  /**
   * Decodes extra arguments from Solana CCIP messages.
   * @param extraArgs - Encoded extra arguments bytes.
   * @returns Decoded EVMExtraArgsV2 or undefined if unknown format.
   * @throws {@link CCIPExtraArgsLengthInvalidError} if extra args length is invalid
   */
  static decodeExtraArgs(
    extraArgs: BytesLike,
  ): (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' }) | undefined {
    const data = getDataBytes(extraArgs),
      tag = dataSlice(data, 0, 4)
    switch (tag) {
      case EVMExtraArgsV2Tag: {
        if (dataLength(data) === 4 + 16 + 1) {
          // Solana-generated EVMExtraArgsV2 (21 bytes total)
          return {
            _tag: 'EVMExtraArgsV2',
            gasLimit: leToBigInt(dataSlice(data, 4, 4 + 16)), // from Uint128LE
            allowOutOfOrderExecution: data[4 + 16] == 1,
          }
        }
        throw new CCIPExtraArgsLengthInvalidError(dataLength(data))
      }
      default:
        return
    }
  }

  /**
   * Encodes extra arguments for Solana CCIP messages.
   * @param args - Extra arguments to encode.
   * @returns Encoded extra arguments as hex string.
   * @throws {@link CCIPSolanaExtraArgsEncodingError} if SVMExtraArgsV1 encoding is attempted
   */
  static encodeExtraArgs(args: ExtraArgs): string {
    if ('computeUnits' in args) throw new CCIPSolanaExtraArgsEncodingError()
    const gasLimitUint128Le = toLeArray(args.gasLimit, 16)
    return concat([
      EVMExtraArgsV2Tag,
      gasLimitUint128Le,
      'allowOutOfOrderExecution' in args && args.allowOutOfOrderExecution ? '0x01' : '0x00',
    ])
  }

  /**
   * Decodes commit reports from a Solana log event.
   * @param log - Log with data field.
   * @param lane - Lane info for filtering.
   * @returns Array of CommitReport or undefined if not valid.
   * @throws {@link CCIPLogDataMissingError} if log data is missing
   */
  static decodeCommits(
    log: Pick<Log_, 'data'>,
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
  static decodeReceipt(log: Pick<Log_, 'data' | 'tx' | 'index'>): ExecutionReceipt | undefined {
    // Check if this is a ExecutionStateChanged event by looking at the discriminant
    if (!log.data || typeof log.data !== 'string') {
      throw new CCIPLogDataMissingError()
    }

    try {
      // Verify the discriminant matches ExecutionStateChanged
      if (dataSlice(getDataBytes(log.data), 0, 8) !== hexDiscriminator('ExecutionStateChanged'))
        return
    } catch (_) {
      return
    }

    const decoded = offrampCoder.events.decode<
      (typeof CCIP_OFFRAMP_IDL)['events'][number] & { name: 'ExecutionStateChanged' },
      IdlTypes<typeof CCIP_OFFRAMP_IDL>
    >(log.data)
    if (decoded?.name !== 'ExecutionStateChanged') return
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

    let returnData
    if (log.tx) {
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
        returnData = getErrorFromLogs(log.tx.logs)
      } else if (log.tx.error) {
        returnData = util.inspect(log.tx.error)
        state = ExecutionState.Failed
      }
    }

    return {
      sourceChainSelector: BigInt(decoded.data.sourceChainSelector.toString()),
      sequenceNumber: BigInt(decoded.data.sequenceNumber.toString()),
      messageId,
      messageHash: hexlify(getDataBytes(decoded.data.messageHash)),
      state,
      returnData,
    }
  }

  /**
   * Converts bytes to a Solana address (Base58).
   * @param bytes - Bytes to convert.
   * @returns Base58-encoded Solana address.
   */
  static getAddress(bytes: BytesLike): string {
    try {
      if (typeof bytes === 'string' && bs58.decode(bytes).length === 32) return bytes
    } catch (_) {
      // pass
    }
    return encodeBase58(getDataBytes(bytes))
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
    if (!type.includes('Router')) throw new CCIPContractNotRouterError(address, type)
    // Solana implements TokenAdminRegistry in the Router/OnRamp program
    return address
  }

  /** {@inheritDoc Chain.getFee} */
  getFee({ router, destChainSelector, message }: Parameters<Chain['getFee']>[0]): Promise<bigint> {
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

    const hash = await simulateAndSendTxs(this, opts.wallet, unsigned)
    return (await this.getMessagesInTx(await this.getTransaction(hash)))[0]!
  }

  /** {@inheritDoc Chain.getOffchainTokenData} */
  async getOffchainTokenData(request: CCIPRequest): Promise<OffchainTokenData[]> {
    return fetchSolanaOffchainTokenData(request, this)
  }

  /**
   * {@inheritDoc Chain.generateUnsignedExecuteReport}
   * @returns instructions - array of instructions to execute the report
   *   lookupTables - array of lookup tables for `manuallyExecute` call
   *   mainIndex - index of the `manuallyExecute` instruction in the array; last unless
   *   forceLookupTable is set, in which case last is ALT deactivation tx, and manuallyExecute is
   *   second to last
   * @throws {@link CCIPExecutionReportChainMismatchError} if message is not a Solana message
   */
  async generateUnsignedExecuteReport({
    payer,
    offRamp,
    execReport,
    ...opts
  }: Parameters<Chain['generateUnsignedExecuteReport']>[0]): Promise<UnsignedSolanaTx> {
    if (!('computeUnits' in execReport.message))
      throw new CCIPExecutionReportChainMismatchError('Solana')
    const execReport_ = execReport as ExecutionReport<CCIPMessage_V1_6_Solana>
    return generateUnsignedExecuteReport(
      this,
      new PublicKey(payer),
      new PublicKey(offRamp),
      execReport_,
      opts,
    )
  }

  /**
   * {@inheritDoc Chain.executeReport}
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana wallet
   */
  async executeReport(
    opts: Parameters<Chain['executeReport']>[0] & {
      // when cleaning leftover LookUp Tables, wait deactivation grace period (~513 slots) then close ALT
      waitDeactivation?: boolean
    },
  ): Promise<CCIPExecution> {
    const wallet = opts.wallet
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(util.inspect(wallet))

    let hash
    do {
      try {
        const unsigned = await this.generateUnsignedExecuteReport({
          ...opts,
          payer: wallet.publicKey.toBase58(),
        })
        hash = await simulateAndSendTxs(this, wallet, unsigned, opts.gasLimit)
      } catch (err) {
        if (
          !(err instanceof Error) ||
          !['encoding overruns Uint8Array', 'too large'].some((e) => err.message.includes(e))
        )
          throw err
        // in case of failure to serialize a report, first try buffering (because it gets
        // auto-closed upon successful execution), then ALTs (need a grace period ~3min after
        // deactivation before they can be closed/recycled)
        if (!opts.forceBuffer) opts = { ...opts, forceBuffer: true }
        else if (!opts.forceLookupTable) opts = { ...opts, forceLookupTable: true }
        else throw err
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
          return getErrorFromLogs(data as Log_[])
      } else if (typeof data === 'object') {
        if ('transactionLogs' in data && 'transactionMessage' in data) {
          const parsed = getErrorFromLogs(data.transactionLogs as Log_[] | string[])
          if (parsed) return { message: data.transactionMessage, ...parsed }
        }
        if ('logs' in data) return getErrorFromLogs(data.logs as Log_[] | string[])
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
   * Solana specialization: use getProgramAccounts to fetch commit reports from PDAs
   */
  override async getCommitReport(
    opts: Parameters<Chain['getCommitReport']>[0],
  ): Promise<CCIPCommit> {
    const { commitStore, request } = opts
    const commitsAroundSeqNum = await this.connection.getProgramAccounts(
      new PublicKey(commitStore),
      {
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
      },
    )
    for (const acc of commitsAroundSeqNum) {
      // const merkleRoot = acc.account.data.subarray(8 + 1 + 8, 8 + 1 + 8 + 32)
      const minSeqNr = acc.account.data.readBigUInt64LE(8 + 1 + 8 + 32 + 8)
      const maxSeqNr = acc.account.data.readBigUInt64LE(8 + 1 + 8 + 32 + 8 + 8)
      if (request.message.sequenceNumber < minSeqNr || maxSeqNr < request.message.sequenceNumber)
        continue
      // we have all the commit report info, but we also need log details (txHash, etc)
      for await (const log of this.getLogs({
        startTime: 1, // just to force getting the oldest log first
        programs: [commitStore],
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
    return super.getCommitReport(opts)
  }

  /** {@inheritDoc Chain.getExecutionReceipts} */
  override async *getExecutionReceipts(
    opts: Parameters<Chain['getExecutionReceipts']>[0],
  ): AsyncIterableIterator<CCIPExecution> {
    const { offRamp, sourceChainSelector, commit } = opts
    let opts_: Parameters<Chain['getExecutionReceipts']>[0] &
      Parameters<SolanaChain['getLogs']>[0] = opts
    if (commit && sourceChainSelector) {
      // if we know of commit, use `commit_report` PDA as more specialized address
      const [commitReportPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('commit_report'),
          toLeArray(sourceChainSelector, 8),
          bytesToBuffer(commit.report.merkleRoot),
        ],
        new PublicKey(offRamp),
      )
      opts_ = {
        ...opts,
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
  async getTokenPoolConfig(tokenPool: string): Promise<{
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
   * {@inheritDoc ChainStatic.buildMessageForDest}
   * @throws {@link CCIPArgumentInvalidError} if tokenReceiver missing when sending tokens with data
   */
  static override buildMessageForDest(
    message: Parameters<ChainStatic['buildMessageForDest']>[0],
  ): AnyMessage & { extraArgs: SVMExtraArgsV1 } {
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
    const tokenReceiver =
      message.extraArgs &&
      'tokenReceiver' in message.extraArgs &&
      message.extraArgs.tokenReceiver != null
        ? message.extraArgs.tokenReceiver
        : message.tokenAmounts?.length
          ? this.getAddress(message.receiver)
          : PublicKey.default.toBase58()
    const accounts =
      message.extraArgs && 'accounts' in message.extraArgs && message.extraArgs.accounts != null
        ? message.extraArgs.accounts
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
      extraArgs,
      // if tokenReceiver, then message.receiver can (must?) be default
      ...(!!message.tokenAmounts?.length && { receiver: PublicKey.default.toBase58() }),
    }
  }
}
