import util from 'util'

import {
  type Idl,
  type IdlTypes,
  AnchorProvider,
  BorshAccountsCoder,
  BorshCoder,
  Program,
  Wallet,
} from '@coral-xyz/anchor'
import { NATIVE_MINT } from '@solana/spl-token'
import {
  type Commitment,
  type ConfirmedSignatureInfo,
  type ConnectionConfig,
  type VersionedTransactionResponse,
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SystemProgram,
} from '@solana/web3.js'
import type BN from 'bn.js'
import bs58 from 'bs58'
import {
  type BytesLike,
  concat,
  dataLength,
  dataSlice,
  encodeBase58,
  encodeBase64,
  getBytes,
  hexlify,
  isHexString,
  toBigInt,
} from 'ethers'
import moize, { type Moized } from 'moize'
import type { PickDeep } from 'type-fest'

import {
  type ChainStatic,
  type LogFilter,
  type RateLimiterState,
  type TokenInfo,
  type TokenPoolRemote,
  Chain,
} from '../chain.ts'
import { type EVMExtraArgsV2, type ExtraArgs, EVMExtraArgsV2Tag } from '../extra-args.ts'
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
  CCIPVersion,
  ChainFamily,
  ExecutionState,
} from '../types.ts'
import {
  createRateLimitedFetch,
  decodeAddress,
  decodeOnRampAddress,
  getDataBytes,
  leToBigInt,
  networkInfo,
  parseTypeAndVersion,
  toLeArray,
} from '../utils.ts'
import { cleanUpBuffers } from './cleanup.ts'
import { executeReport } from './exec.ts'
import { getV16SolanaLeafHasher } from './hasher.ts'
import { IDL as BASE_TOKEN_POOL } from './idl/1.6.0/BASE_TOKEN_POOL.ts'
import { IDL as BURN_MINT_TOKEN_POOL } from './idl/1.6.0/BURN_MINT_TOKEN_POOL.ts'
import { IDL as CCIP_CCTP_TOKEN_POOL } from './idl/1.6.0/CCIP_CCTP_TOKEN_POOL.ts'
import { IDL as CCIP_OFFRAMP_IDL } from './idl/1.6.0/CCIP_OFFRAMP.ts'
import { IDL as CCIP_ROUTER_IDL } from './idl/1.6.0/CCIP_ROUTER.ts'
import { fetchSolanaOffchainTokenData } from './offchain.ts'
import { ccipSend, getFee } from './send.ts'
import type { CCIPMessage_V1_6_Solana } from './types.ts'
import {
  bytesToBuffer,
  getErrorFromLogs,
  hexDiscriminator,
  parseSolanaLogs,
  simulationProvider,
} from './utils.ts'

const routerCoder = new BorshCoder(CCIP_ROUTER_IDL)
const offrampCoder = new BorshCoder(CCIP_OFFRAMP_IDL)
const tokenPoolCoder = new BorshCoder({
  ...BURN_MINT_TOKEN_POOL,
  types: BASE_TOKEN_POOL.types,
  events: BASE_TOKEN_POOL.events,
  errors: [...BASE_TOKEN_POOL.errors, ...BURN_MINT_TOKEN_POOL.errors],
})
const cctpTokenPoolCoder = new BorshCoder({
  ...CCIP_CCTP_TOKEN_POOL,
  types: [...BASE_TOKEN_POOL.types, ...CCIP_CCTP_TOKEN_POOL.types],
  events: [...BASE_TOKEN_POOL.events, ...CCIP_CCTP_TOKEN_POOL.events],
  errors: [...BASE_TOKEN_POOL.errors, ...CCIP_CCTP_TOKEN_POOL.errors],
})
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

// some circular specialized types, but all good with proper references
export type SolanaLog = Log_ & { tx: SolanaTransaction; data: string; level: number }
export type SolanaTransaction = MergeArrayElements<
  ChainTransaction,
  {
    tx: VersionedTransactionResponse
    logs: readonly SolanaLog[]
  }
>

export class SolanaChain extends Chain<typeof ChainFamily.Solana> {
  static readonly family = ChainFamily.Solana
  static readonly decimals = 9

  readonly network: NetworkInfo<typeof ChainFamily.Solana>
  readonly connection: Connection
  readonly commitment: Commitment = 'confirmed'

  _getSignaturesForAddress: (
    programId: string,
    before?: string,
  ) => Promise<ConfirmedSignatureInfo[]>

  constructor(connection: Connection, network: NetworkInfo) {
    super()

    if (network.family !== ChainFamily.Solana) {
      throw new Error(`Invalid network family for SolanaChain: ${network.family}`)
    }
    this.network = network
    this.connection = connection

    // Memoize expensive operations
    this.typeAndVersion = moize.default(this.typeAndVersion.bind(this), {
      maxArgs: 1,
      isPromise: true,
    })
    this.getBlockTimestamp = moize.default(this.getBlockTimestamp.bind(this), {
      isPromise: true,
      maxSize: 100,
      updateCacheForKey: (key) => typeof key[key.length - 1] !== 'number',
    })
    this.getTransaction = moize.default(this.getTransaction.bind(this), {
      maxSize: 100,
      maxArgs: 1,
    })
    this.getWallet = moize.default(this.getWallet.bind(this), { maxSize: 1, maxArgs: 0 })
    this.getTokenForTokenPool = moize.default(this.getTokenForTokenPool.bind(this))
    this.getTokenInfo = moize.default(this.getTokenInfo.bind(this))
    this._getSignaturesForAddress = moize.default(
      (programId: string, before?: string) =>
        this.connection.getSignaturesForAddress(
          new PublicKey(programId),
          { limit: 1000, before },
          'confirmed',
        ),
      {
        maxSize: 100,
        maxAge: 60000,
        maxArgs: 2,
        isPromise: true,
        updateExpire: true,
        // only expire undefined before (i.e. recent getSignaturesForAddress calls)
        onExpire: ([, before]) => !before,
      },
    )
    // cache account info for 30 seconds
    this.connection.getAccountInfo = moize.default(
      this.connection.getAccountInfo.bind(this.connection),
      {
        maxSize: 100,
        maxArgs: 2,
        maxAge: 30e3,
        transformArgs: ([address, commitment]) =>
          [(address as PublicKey).toString(), commitment] as const,
      },
    )

    this._getRouterConfig = moize.default(this._getRouterConfig.bind(this), {
      maxArgs: 1,
    })

    this.getFeeTokens = moize.default(this.getFeeTokens.bind(this), {
      maxArgs: 1,
    })
  }

  static _getConnection(url: string): Connection {
    if (!url.startsWith('http') && !url.startsWith('ws')) {
      throw new Error(
        `Invalid Solana RPC URL format (should be https://, http://, wss://, or ws://): ${url}`,
      )
    }

    const config: ConnectionConfig = { commitment: 'confirmed' }
    if (url.includes('.solana.com')) {
      config.fetch = createRateLimitedFetch() // public nodes
      console.warn('Using rate-limited fetch for public solana nodes, commands may be slow')
    }

    return new Connection(url, config)
  }

  static async fromConnection(connection: Connection): Promise<SolanaChain> {
    // Get genesis hash to use as chainId
    return new SolanaChain(connection, networkInfo(await connection.getGenesisHash()))
  }

  static async fromUrl(url: string): Promise<SolanaChain> {
    const connection = this._getConnection(url)
    return this.fromConnection(connection)
  }

  async destroy(): Promise<void> {
    // Solana Connection doesn't have an explicit destroy method
    // The memoized functions will be garbage collected when the instance is destroyed
  }

  static getWallet(_opts?: { wallet?: unknown }): Promise<Wallet> {
    throw new Error('Wallet not implemented')
  }

  /**
   * Load wallet
   * @param opts - options to load wallet
   * @param opts.wallet - private key as 0x or base58 string, or async getter function resolving to
   *   Wallet instance
   * @returns Wallet, after caching in instance
   */
  async getWallet(opts: { wallet?: unknown } = {}): Promise<Wallet> {
    try {
      if (typeof opts.wallet === 'string')
        return new Wallet(
          Keypair.fromSecretKey(
            opts.wallet.startsWith('0x') ? getBytes(opts.wallet) : bs58.decode(opts.wallet),
          ),
        )
    } catch (_) {
      // pass
    }
    return (this.constructor as typeof SolanaChain).getWallet(opts)
  }

  async getWalletAddress(opts?: { wallet?: unknown }): Promise<string> {
    return (await this.getWallet(opts)).publicKey.toBase58()
  }

  // cached
  async getBlockTimestamp(block: number | 'finalized'): Promise<number> {
    if (block === 'finalized') {
      const slot = await this.connection.getSlot('finalized')
      const blockTime = await this.connection.getBlockTime(slot)
      if (blockTime === null) {
        throw new Error(`Could not get block time for finalized slot ${slot}`)
      }
      return blockTime
    }

    const blockTime = await this.connection.getBlockTime(block)
    if (blockTime === null) {
      throw new Error(`Could not get block time for slot ${block}`)
    }
    return blockTime
  }

  // cached
  async getTransaction(hash: string): Promise<SolanaTransaction> {
    const tx = await this.connection.getTransaction(hash, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
    if (!tx) throw new Error(`Transaction not found: ${hash}`)
    if (tx.blockTime) {
      ;(this.getBlockTimestamp as Moized<typeof this.getBlockTimestamp>).set(
        [tx.slot],
        Promise.resolve(tx.blockTime),
      )
    } else {
      tx.blockTime = await this.getBlockTimestamp(tx.slot)
    }

    // Parse logs from transaction using helper function
    const logs_ = tx.meta?.logMessages?.length
      ? parseSolanaLogs(tx.meta?.logMessages).map((l) => ({
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
      from: tx.transaction.message.staticAccountKeys[0].toString(),
      error: tx.meta?.err,
      tx, // specialized solana transaction
    }
    // solana logs include circular reference to tx
    chainTx.logs = logs_.map((l) => Object.assign(l, { tx: chainTx }))
    return chainTx
  }

  // implements inner paging logic for this.getLogs
  async *_getTransactionsForAddress(
    opts: Omit<LogFilter, 'topics'>,
  ): AsyncGenerator<SolanaTransaction> {
    if (!opts.address) throw new Error('Program address is required for Solana log filtering')

    let allSignatures
    if (opts.startBlock || opts.startTime) {
      // forward collect all matching sigs in array
      const allSigs: { signature: string; slot: number; blockTime?: number | null }[] = []
      let batch: Awaited<ReturnType<typeof this.connection.getSignaturesForAddress>> | undefined,
        popped = false
      while (!popped && (batch?.length ?? true)) {
        batch = await this._getSignaturesForAddress(
          opts.address,
          allSigs[allSigs.length - 1]?.signature,
        )
        while (
          batch.length > 0 &&
          (batch[batch.length - 1].slot < (opts.startBlock || 0) ||
            (batch[batch.length - 1].blockTime || -1) < (opts.startTime || 0))
        ) {
          batch.pop() // pop tail of txs which are older than requested start
          popped = true
        }
        allSigs.push(...batch)
      }
      allSigs.reverse()
      while (
        opts.endBlock &&
        allSigs.length > 0 &&
        allSigs[allSigs.length - 1].slot > opts.endBlock
      ) {
        allSigs.pop() // pop head (after reverse) of txs which are newer than requested end
      }
      allSignatures = allSigs
    } else {
      allSignatures = async function* (this: SolanaChain) {
        let batch: { signature: string; slot: number; blockTime?: number | null }[] | undefined
        while (batch?.length ?? true) {
          batch = await this._getSignaturesForAddress(
            opts.address!,
            batch?.length
              ? batch[batch.length - 1].signature
              : opts.endBefore
                ? opts.endBefore
                : undefined,
          )
          for (const sig of batch) {
            if (opts.endBlock && sig.slot > opts.endBlock) continue
            yield sig
          }
        }
      }.call(this) // generate backwards until depleting getSignaturesForAddress
    }

    // Process signatures
    for await (const signatureInfo of allSignatures) {
      yield await this.getTransaction(signatureInfo.signature)
    }
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
   * @param opts - Log filter options
   * @param opts.startBlock - Starting slot number (inclusive)
   * @param opts.startTime - Starting Unix timestamp (inclusive)
   * @param opts.endBlock - Ending slot number (inclusive)
   * @param opts.address - Program address to filter logs by (required for Solana)
   * @param opts.topics - Array of topics to filter logs by (optional);
   *   either 0x-8B discriminants or event names
   * @param.opts.programs - a special option to allow querying by address of interest, but
   *   yielding matching logs from specific (string address) program or any (true)
   * @param opts.commit - Special param for fetching ExecutionReceipts, to narrow down the search
   * @returns AsyncIterableIterator of parsed Log_ objects
   */
  async *getLogs(
    opts: LogFilter & { sender?: string; programs?: string[] | true; commit?: CommitReport },
  ): AsyncGenerator<Log_ & { tx: SolanaTransaction }> {
    let programs: true | string[]
    if (opts.sender && !opts.address) {
      // specialization for fetching txs/requests for a given account of interest without a programID
      opts.address = opts.sender
      programs = true
    } else if (!opts.address) {
      throw new Error('Program address is required for Solana log filtering')
    } else if (!opts.programs) {
      programs = [opts.address]
    } else {
      programs = opts.programs
    }
    if (opts.topics?.length) {
      if (!opts.topics.every((topic) => typeof topic === 'string'))
        throw new Error('Topics must be strings')
      // append events discriminants (if not 0x-8B already), but keep OG topics
      opts.topics.push(
        ...opts.topics.filter((t) => !isHexString(t, 8)).map((t) => hexDiscriminator(t)),
      )
    }

    // Process signatures and yield logs
    for await (const tx of this._getTransactionsForAddress(opts)) {
      for (const log of tx.logs) {
        // Filter and yield logs from the specified program, and which match event discriminant or log prefix
        if (
          (programs !== true && !programs.includes(log.address)) ||
          (opts.topics?.length &&
            !(opts.topics as string[]).some(
              (t) =>
                t === log.topics[0] || (typeof log.data === 'string' && log.data.startsWith(t)),
            ))
        )
          continue
        yield Object.assign(log, { timestamp: new Date(tx.timestamp * 1000) })
      }
    }
  }

  async typeAndVersion(address: string) {
    const program = new Program(
      CCIP_OFFRAMP_IDL, // `typeVersion` schema should be the same
      new PublicKey(address),
      simulationProvider(this.connection),
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

  getRouterForOnRamp(onRamp: string, _destChainSelector: bigint): Promise<string> {
    return Promise.resolve(onRamp) // Solana's router is also the onRamp
  }

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
    if (!referenceAddressesPda)
      throw new Error(`referenceAddresses account not found for offRamp=${offRamp}`)

    // Decode the config account using the program's coder
    const { router }: { router: PublicKey } = program.coder.accounts.decode(
      'referenceAddresses',
      referenceAddressesPda.data,
    )
    return router.toBase58()
  }

  getNativeTokenForRouter(_router: string): Promise<string> {
    return Promise.resolve(NATIVE_MINT.toBase58())
  }

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
    throw new Error(`Could not find OffRamp events in feeQuoter=${feeQuoter.toString()} txs`)
  }

  getOnRampForRouter(router: string, _destChainSelector: bigint): Promise<string> {
    return Promise.resolve(router) // solana's Router is also the OnRamp
  }

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

  getCommitStoreForOffRamp(offRamp: string): Promise<string> {
    return Promise.resolve(offRamp) // Solana supports only CCIP>=1.6, for which OffRamp and CommitStore are the same
  }

  async getTokenForTokenPool(tokenPool: string): Promise<string> {
    const tokenPoolInfo = await this.connection.getAccountInfo(new PublicKey(tokenPool))
    if (!tokenPoolInfo) throw new Error(`TokenPool info not found: ${tokenPool}`)
    const { config }: { config: { mint: PublicKey } } = tokenPoolCoder.accounts.decode(
      'state',
      tokenPoolInfo.data,
    )
    return config.mint.toString()
  }

  async getTokenInfo(token: string): Promise<TokenInfo> {
    const mint = new PublicKey(token)
    const mintInfo = await this.connection.getParsedAccountInfo(mint)

    if (
      !mintInfo.value ||
      !mintInfo.value.data ||
      (typeof mintInfo.value.data === 'object' &&
        'program' in mintInfo.value.data &&
        mintInfo.value.data.program !== 'spl-token' &&
        mintInfo.value.data.program !== 'spl-token-2022')
    ) {
      throw new Error(`Invalid SPL token or Token-2022: ${token}`)
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
          console.debug(`Failed to fetch Metaplex metadata for token ${token}:`, error)
        }
      }

      return {
        name,
        symbol,
        decimals: data.decimals,
      }
    } else {
      throw new Error(`Unable to parse token data for ${token}`)
    }
  }

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
      console.debug('Error fetching token metadata:', error)
      return null
    }
  }

  static decodeMessage({ data }: { data: unknown }): CCIPMessage | undefined {
    if (!data || typeof data !== 'string') return undefined
    let eventDataBuffer
    try {
      eventDataBuffer = bytesToBuffer(data)
    } catch (_) {
      return
    }

    const disc = dataSlice(eventDataBuffer, 0, 8)
    if (disc !== hexDiscriminator('CCIPMessageSent')) return

    // Use module-level BorshCoder for decoding structs

    // Manually parse event header (discriminator + event-level fields)
    let offset = 8

    // Parse event-level fields
    const _destChainSelector = eventDataBuffer.readBigUInt64LE(offset)
    offset += 8

    const _sequenceNumber = eventDataBuffer.readBigUInt64LE(offset)
    offset += 8

    // Now decode the SVM2AnyRampMessage struct using BorshCoder
    const messageBytes = eventDataBuffer.subarray(offset)

    const message: IdlTypes<typeof CCIP_ROUTER_IDL>['SVM2AnyRampMessage'] =
      routerCoder.types.decode('SVM2AnyRampMessage', messageBytes)

    // Convert BN/number types to bigints
    const sourceChainSelector = BigInt(message.header.sourceChainSelector.toString())
    const destChainSelector = BigInt(message.header.destChainSelector.toString())
    const sequenceNumber = BigInt(message.header.sequenceNumber.toString())
    const nonce = BigInt(message.header.nonce.toString())
    const destNetwork = networkInfo(destChainSelector)

    // Convert message fields to expected format
    const messageId = hexlify(new Uint8Array(message.header.messageId))
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
    if (!parsed) throw new Error('Invalid extraArgs: ' + extraArgs)
    const { _tag, ...rest } = parsed

    return {
      header: {
        messageId,
        sourceChainSelector,
        destChainSelector: destChainSelector,
        sequenceNumber: sequenceNumber,
        nonce,
      },
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
        throw new Error(`Unsupported EVMExtraArgsV2 length: ${dataLength(data)}`)
      }
      default:
        return
    }
  }

  static encodeExtraArgs(args: ExtraArgs): string {
    if ('computeUnits' in args) throw new Error('Solana can only encode EVMExtraArgsV2')
    const gasLimitUint128Le = toLeArray(args.gasLimit, 16)
    return concat([
      EVMExtraArgsV2Tag,
      gasLimitUint128Le,
      'allowOutOfOrderExecution' in args && args.allowOutOfOrderExecution ? '0x01' : '0x00',
    ])
  }

  static decodeCommits(
    log: Pick<Log_, 'data'>,
    lane?: Omit<Lane, 'destChainSelector'>,
  ): CommitReport[] | undefined {
    // Check if this is a CommitReportAccepted event by looking at the discriminant
    if (!log.data || typeof log.data !== 'string') {
      throw new Error('Log data is missing or not a string')
    }

    const eventDataBuffer = bytesToBuffer(log.data)

    // Verify the discriminant matches CommitReportAccepted
    const expectedDiscriminant = hexDiscriminator('CommitReportAccepted')
    const actualDiscriminant = hexlify(eventDataBuffer.subarray(0, 8))
    if (actualDiscriminant !== expectedDiscriminant) return

    // Skip the 8-byte discriminant and decode the event data manually
    let offset = 8

    // Decode Option<MerkleRoot> - first byte indicates Some(1) or None(0)
    const hasValue = eventDataBuffer.readUInt8(offset)
    offset += 1
    if (!hasValue) return []

    // Decode MerkleRoot struct using the types decoder
    // We need to read the remaining bytes as a MerkleRoot struct
    const merkleRootBytes = eventDataBuffer.subarray(offset)

    type MerkleRootData = {
      sourceChainSelector: BN
      onRampAddress: Buffer
      minSeqNr: BN
      maxSeqNr: BN
      merkleRoot: number[]
    }

    const merkleRootData: MerkleRootData = offrampCoder.types.decode('MerkleRoot', merkleRootBytes)

    if (!merkleRootData) {
      throw new Error('Failed to decode MerkleRoot data')
    }

    // Verify the source chain selector matches our lane
    const sourceChainSelector = BigInt(merkleRootData.sourceChainSelector.toString())

    // Convert the onRampAddress from bytes to the proper format
    const onRampAddress = decodeOnRampAddress(
      merkleRootData.onRampAddress,
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
        minSeqNr: BigInt(merkleRootData.minSeqNr.toString()),
        maxSeqNr: BigInt(merkleRootData.maxSeqNr.toString()),
        merkleRoot: hexlify(new Uint8Array(merkleRootData.merkleRoot)),
      },
    ]
  }

  static decodeReceipt(log: Pick<Log_, 'data' | 'tx' | 'index'>): ExecutionReceipt | undefined {
    // Check if this is a ExecutionStateChanged event by looking at the discriminant
    if (!log.data || typeof log.data !== 'string') {
      throw new Error('Log data is missing or not a string')
    }

    // Verify the discriminant matches ExecutionStateChanged
    if (dataSlice(getDataBytes(log.data), 0, 8) !== hexDiscriminator('ExecutionStateChanged'))
      return
    const eventDataBuffer = bytesToBuffer(log.data)

    // Note: We manually decode the event fields rather than using BorshCoder
    // since ExecutionStateChanged is an event, not a defined type

    // Skip the 8-byte discriminant and manually decode the event fields
    let offset = 8

    // Decode sourceChainSelector (u64)
    const sourceChainSelector = eventDataBuffer.readBigUInt64LE(offset)
    offset += 8

    // Decode sequenceNumber (u64)
    const sequenceNumber = eventDataBuffer.readBigUInt64LE(offset)
    offset += 8

    // Decode messageId ([u8; 32])
    const messageId = hexlify(eventDataBuffer.subarray(offset, offset + 32))
    offset += 32

    // Decode messageHash ([u8; 32])
    const messageHash = hexlify(eventDataBuffer.subarray(offset, offset + 32))
    offset += 32

    // Decode state enum (MessageExecutionState)
    // Enum discriminant is a single byte: Untouched=0, InProgress=1, Success=2, Failure=3
    let state = eventDataBuffer.readUInt8(offset) as ExecutionState
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
      sourceChainSelector,
      sequenceNumber,
      messageId,
      messageHash,
      state,
      returnData,
    }
  }

  static getAddress(bytes: BytesLike): string {
    try {
      if (typeof bytes === 'string' && bs58.decode(bytes).length === 32) return bytes
    } catch (_) {
      // pass
    }
    return encodeBase58(getDataBytes(bytes))
  }

  static getDestLeafHasher(lane: Lane): LeafHasher<typeof CCIPVersion.V1_6> {
    return getV16SolanaLeafHasher(lane)
  }

  async getTokenAdminRegistryFor(address: string): Promise<string> {
    const [type] = await this.typeAndVersion(address)
    if (!type.includes('Router')) throw new Error(`Not a Router: ${address} is ${type}`)
    // Solana implements TokenAdminRegistry in the Router/OnRamp program
    return address
  }

  /**
   * Get the fee required to send a CCIP message from the Solana router.
   */
  getFee(router: string, destChainSelector: bigint, message: AnyMessage): Promise<bigint> {
    return getFee(this.connection, router, destChainSelector, message)
  }

  async sendMessage(
    router_: string,
    destChainSelector: bigint,
    message: AnyMessage & { fee?: bigint },
    opts?: { wallet?: unknown; approveMax?: boolean },
  ): Promise<ChainTransaction> {
    if (!message.fee) message.fee = await this.getFee(router_, destChainSelector, message)
    const wallet = await this.getWallet(opts)

    const router = new Program(
      CCIP_ROUTER_IDL,
      new PublicKey(router_),
      new AnchorProvider(this.connection, wallet, { commitment: this.commitment }),
    )
    const { hash } = await ccipSend(
      router,
      destChainSelector,
      message as AnyMessage & { fee: bigint },
      opts,
    )
    return this.getTransaction(hash)
  }

  async fetchOffchainTokenData(request: CCIPRequest): Promise<OffchainTokenData[]> {
    return fetchSolanaOffchainTokenData(this.connection, request)
  }

  async executeReport(
    offRamp: string,
    execReport_: ExecutionReport,
    opts?: {
      wallet?: string
      gasLimit?: number
      forceLookupTable?: boolean
      forceBuffer?: boolean
      clearLeftoverAccounts?: boolean
      dontWait?: boolean
    },
  ): Promise<ChainTransaction> {
    if (!('computeUnits' in execReport_.message))
      throw new Error("ExecutionReport's message not for Solana")
    const execReport = execReport_ as ExecutionReport<CCIPMessage_V1_6_Solana>

    const wallet = await this.getWallet(opts)
    const provider = new AnchorProvider(this.connection, wallet, { commitment: this.commitment })
    const offrampProgram = new Program(CCIP_OFFRAMP_IDL, new PublicKey(offRamp), provider)

    const rep = await executeReport({ offrampProgram, execReport, ...opts })
    if (opts?.clearLeftoverAccounts) {
      try {
        await this.cleanUpBuffers(opts)
      } catch (err) {
        console.warn('Error while trying to clean up buffers:', err)
      }
    }
    return this.getTransaction(rep.hash)
  }

  /**
   * Clean up and recycle buffers and address lookup tables owned by wallet
   * CAUTION: this will close ANY lookup table owned by this wallet
   * @param wallet - wallet options
   * @param dontWait - Whether to skip waiting for lookup table deactivation cool down period
   *   (513 slots) to pass before closing; by default, we deactivate (if needed) and wait to close
   *   before returning from this method
   */
  async cleanUpBuffers(opts?: { wallet?: string; dontWait?: boolean }): Promise<void> {
    const wallet = await this.getWallet(opts)
    const provider = new AnchorProvider(this.connection, wallet, { commitment: this.commitment })
    await cleanUpBuffers(provider, this.getLogs.bind(this), opts)
  }

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
   * Solana optimization: we use getProgramAccounts with
   */
  async fetchCommitReport(
    commitStore: string,
    request: PickDeep<CCIPRequest, 'lane' | 'message.header.sequenceNumber' | 'tx.timestamp'>,
    hints?: { startBlock?: number; page?: number },
  ): Promise<CCIPCommit> {
    const commitsAroundSeqNum = await this.connection.getProgramAccounts(
      new PublicKey(commitStore),
      {
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: encodeBase58(BorshAccountsCoder.accountDiscriminator('CommitReport')),
            },
          },
          {
            memcmp: {
              offset: 8 + 1,
              bytes: encodeBase58(toLeArray(request.lane.sourceChainSelector, 8)),
            },
          },
          // dirty trick: memcmp report.min with msg.sequenceNumber's without least-significant byte;
          // this should be ~256 around seqNum, i.e. big chance of a match
          {
            memcmp: {
              offset: 8 + 1 + 8 + 32 + 8 + 1,
              bytes: encodeBase58(toLeArray(request.message.header.sequenceNumber, 8).slice(1)),
            },
          },
        ],
      },
    )
    for (const acc of commitsAroundSeqNum) {
      // const merkleRoot = acc.account.data.subarray(8 + 1 + 8, 8 + 1 + 8 + 32)
      const minSeqNr = acc.account.data.readBigUInt64LE(8 + 1 + 8 + 32 + 8)
      const maxSeqNr = acc.account.data.readBigUInt64LE(8 + 1 + 8 + 32 + 8 + 8)
      if (
        minSeqNr > request.message.header.sequenceNumber ||
        maxSeqNr < request.message.header.sequenceNumber
      )
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
    return super.fetchCommitReport(commitStore, request, hints)
  }

  // specialized override with stricter address-of-interest
  async *fetchExecutionReceipts(
    offRamp: string,
    request: CCIPRequest,
    commit?: CCIPCommit,
    hints?: { page?: number },
  ): AsyncIterableIterator<CCIPExecution> {
    if (!commit) {
      // if no commit, fall back to generic implementation
      yield* super.fetchExecutionReceipts(offRamp, request, commit, hints)
      return
    }
    // otherwise, use `commit_report` PDA as more specialized address
    const [commitReportPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('commit_report'),
        toLeArray(commit.report.sourceChainSelector, 8),
        bytesToBuffer(commit.report.merkleRoot),
      ],
      new PublicKey(offRamp),
    )
    // rest is similar to generic implemenetation
    const onlyLast = !commit.log.blockNumber && !request.tx.timestamp // backwards
    for await (const log of this.getLogs({
      startBlock: commit?.log.blockNumber,
      startTime: request.tx.timestamp,
      ...hints,
      programs: [offRamp],
      address: commitReportPda.toBase58(),
      topics: ['ExecutionStateChanged'],
    })) {
      const receipt = (this.constructor as ChainStatic).decodeReceipt(log)
      if (!receipt || receipt.messageId !== request.message.header.messageId) continue

      const timestamp = log.tx?.timestamp ?? (await this.getBlockTimestamp(log.blockNumber))
      yield { receipt, log, timestamp }
      if (onlyLast || receipt.state === ExecutionState.Success) break
    }
  }

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
    if (!tokenAdminRegistry)
      throw new Error(`Token ${token} is not configured in registry ${registry}`)

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
      pendingAdministrator &&
      !pendingAdministrator.equals(SystemProgram.programId) &&
      !pendingAdministrator.equals(PublicKey.default)
    ) {
      config.pendingAdministrator = pendingAdministrator.toBase58()
    }

    // Get token pool from lookup table if available
    try {
      const lookupTableAddr = new PublicKey(tokenAdminRegistry.data.subarray(73, 73 + 32))
      const lookupTable = await this.connection.getAddressLookupTable(lookupTableAddr)
      if (lookupTable?.value) {
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

  async getTokenPoolConfigs(tokenPool: string): Promise<{
    token: string
    router: string
    tokenPoolProgram: string
    typeAndVersion?: string
  }> {
    // `tokenPool` is actually a State PDA in the tokenPoolProgram
    const tokenPoolState = await this.connection.getAccountInfo(new PublicKey(tokenPool))
    if (!tokenPoolState) throw new Error(`TokenPool State PDA not found at ${tokenPool}`)

    const { config }: { config: { mint: PublicKey; router: PublicKey } } =
      tokenPoolCoder.accounts.decode('state', tokenPoolState.data)
    const tokenPoolProgram = tokenPoolState.owner.toBase58()

    let typeAndVersion
    try {
      ;[, , typeAndVersion] = await this.typeAndVersion(tokenPoolProgram)
    } catch (_) {
      // TokenPool may not have a typeAndVersion
    }

    return {
      token: config.mint.toBase58(),
      router: config.router.toBase58(),
      tokenPoolProgram,
      typeAndVersion,
    }
  }

  async getTokenPoolRemotes(
    tokenPool: string,
    remoteChainSelector?: bigint,
  ): Promise<Record<string, TokenPoolRemote>> {
    // `tokenPool` is actually a State PDA in the tokenPoolProgram
    const tokenPoolState = await this.connection.getAccountInfo(new PublicKey(tokenPool))
    if (!tokenPoolState) throw new Error(`TokenPool State PDA not found at ${tokenPool}`)

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
        throw new Error(
          `ChainConfig not found at ${chainConfigAddr.toBase58()} for tokenPool=${tokenPool} and remoteNetwork=${networkInfo(remoteChainSelector).name}`,
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
        let base: {
          remote: {
            poolAddresses: { address: Buffer }[]
            tokenAddress: { address: Buffer }
            decimals: number
          }
          inboundRateLimit: {
            tokens: BN
            lastUpdated: BN
            cfg: {
              enabled: boolean
              capacity: BN
              rate: BN
            }
          }
          outboundRateLimit: {
            tokens: BN
            lastUpdated: BN
            cfg: {
              enabled: boolean
              capacity: BN
              rate: BN
            }
          }
        }
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

        let inboundRateLimiterState: RateLimiterState = null
        if (base.inboundRateLimit.cfg.enabled) {
          inboundRateLimiterState = {
            tokens: BigInt(base.inboundRateLimit.tokens.toString()),
            capacity: BigInt(base.inboundRateLimit.cfg.capacity.toString()),
            rate: BigInt(base.inboundRateLimit.cfg.rate.toString()),
          }
          const cur =
            inboundRateLimiterState.tokens +
            inboundRateLimiterState.rate *
              BigInt(Math.floor(Date.now() / 1000) - base.inboundRateLimit.lastUpdated.toNumber())
          if (cur < inboundRateLimiterState.capacity) inboundRateLimiterState.tokens = cur
          else inboundRateLimiterState.tokens = inboundRateLimiterState.capacity
        }

        let outboundRateLimiterState: RateLimiterState = null
        if (base.outboundRateLimit.cfg.enabled) {
          outboundRateLimiterState = {
            tokens: BigInt(base.outboundRateLimit.tokens.toString()),
            capacity: BigInt(base.outboundRateLimit.cfg.capacity.toString()),
            rate: BigInt(base.outboundRateLimit.cfg.rate.toString()),
          }
          const cur =
            outboundRateLimiterState.tokens +
            outboundRateLimiterState.rate *
              BigInt(Math.floor(Date.now() / 1000) - base.outboundRateLimit.lastUpdated.toNumber())
          if (cur < outboundRateLimiterState.capacity) outboundRateLimiterState.tokens = cur
          else outboundRateLimiterState.tokens = outboundRateLimiterState.capacity
        }

        remotes[remoteNetwork.name] = {
          remoteToken,
          remotePools,
          inboundRateLimiterState,
          outboundRateLimiterState,
        }
      } catch (err) {
        console.warn('Failed to decode ChainConfig account:', err)
      }
    }

    return remotes
  }

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
      if (!acc.account.data || acc.account.data.length < mintOffset + 32) continue
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

  // cached
  async _getRouterConfig(router: string) {
    const program = new Program(CCIP_ROUTER_IDL, new PublicKey(router), {
      connection: this.connection,
    })

    const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId)

    // feeQuoter is present in router's config, and has a DestChainState account which is updated by
    // the offramps, so we can use it to narrow the search for the offramp
    return program.account.config.fetch(configPda)
  }
}

supportedChains[ChainFamily.Solana] = SolanaChain
