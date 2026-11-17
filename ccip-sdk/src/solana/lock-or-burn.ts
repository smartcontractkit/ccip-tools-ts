import { Buffer } from 'buffer'

import type { IdlTypes } from '@coral-xyz/anchor'
import {
  MULTISIG_SIZE,
  createMintToInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  unpackMint,
  unpackMultisig,
} from '@solana/spl-token'
import {
  type AccountMeta,
  type AddressLookupTableAccount,
  type Connection,
  type SimulatedTransactionResponse,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js'
import BN from 'bn.js'

import { CCIPError } from '../errors/CCIPError.ts'
import { CCIPErrorCode } from '../errors/codes.ts'
import {
  CCIPSolanaLookupTableNotFoundError,
  CCIPSourcePoolRevertError,
  CCIPTokenNotConfiguredError,
} from '../errors/index.ts'
import { type FinalityRequested, encodeFinality } from '../extra-args.ts'
import type { WithLogger } from '../types.ts'
import { bytesToBuffer, toLeArray } from '../utils.ts'
import { sighash, sizedCoder } from './coder.ts'
import { IDL as BURN_MINT_TOKEN_POOL_V2_IDL } from './idl/2.0.0/BURN_MINT_TOKEN_POOL.ts'
import { getTokenAdminRegistryConfig } from './token-admin-registry.ts'
import {
  deriveTokenPoolChainConfigOverridePda,
  deriveTokenPoolChainConfigV2Pda,
} from './token-pool.ts'
import { SIMULATION_PAYER, getInstructionError, simulateTransaction } from './utils.ts'

// Every 2.0 pool implements the same pool interface; the router itself encodes its pool CPIs with
// the burn-mint pool's types (`nested_token.rs`), and so does this module.
const poolCoder = sizedCoder(BURN_MINT_TOKEN_POOL_V2_IDL)
type PoolTypes = IdlTypes<typeof BURN_MINT_TOKEN_POOL_V2_IDL>

const LOCK_OR_BURN_V1_DISCRIMINATOR = sighash('global', 'lock_or_burn_tokens')
const LOCK_OR_BURN_V2_DISCRIMINATOR = sighash('global', 'lock_or_burn_tokens_v2')
const NESTED_RESOLVE_ACCOUNTS_START_DISCRIMINATOR = sighash(
  'global',
  'nested_resolve_accounts_start',
)
const DERIVE_ACCOUNTS_LOCK_OR_BURN_DISCRIMINATOR = sighash(
  'global',
  'derive_accounts_lock_or_burn_tokens',
)

// `ccip_common::v2::TOKEN_POOL_LUT_REQUIRED_ENTRIES`: every token's lookup table starts with
// [lookup_table, token_admin_registry, pool_program, pool_config, pool_token_account, pool_signer,
//  token_program, mint, fee_token_config, ccip_router_pool_signer]; extras follow.
const LUT_REQUIRED_ENTRIES = 10
const LUT_POOL_PROGRAM = 2
const LUT_POOL_CONFIG = 3
const LUT_POOL_TOKEN_ACCOUNT = 4
const LUT_POOL_SIGNER = 5
const LUT_TOKEN_PROGRAM = 6
const LUT_MINT = 7
const LUT_ROUTER_POOL_SIGNER = 9

// Anchor numbers program-defined errors from 6000 (`ERROR_CODE_OFFSET`)
const ANCHOR_USER_ERROR_START = 6000

// Bounds the pool's account resolution, which a misbehaving pool could otherwise loop forever
const MAX_RESOLUTION_ROUNDS = 16

/** The pool's `lockOrBurn` interface the router calls, which decides the instruction and inputs. */
export type SolanaPoolInterface = 'v1' | 'v2'

/** Options for {@link simulateLockOrBurn}. */
export type SolanaSimulateLockOrBurnOpts = {
  /** Router program: the pools' only authorized caller, through its `external_token_pools_signer`. */
  router: PublicKey
  /**
   * Whether the router sends the message over its CCIP 2.0 entrypoint (`ccip_send_v2`), which
   * calls a 2.0 pool's `lock_or_burn_tokens_v2`. Otherwise (1.6 `ccip_send`, or a pool on the
   * 1.6-compatible interface) the router calls `lock_or_burn_tokens`.
   */
  laneV2: boolean
  /** RMN Remote program from the router's config; the 1.6-compatible `lockOrBurn` takes its accounts. */
  rmnRemote: PublicKey
  /** Destination chain selector. */
  destChainSelector: bigint
  /** Token mint. */
  mint: PublicKey
  /** Amount, in the mint's decimals. */
  amount: bigint
  /**
   * Message sender. Without one, the simulation uses a placeholder, so a pool revert (e.g. a
   * sender allowlist) isn't a verdict on the real send and is rethrown raw.
   */
  originalSender?: PublicKey
  /** Token receiver on the destination chain, as raw bytes. */
  receiver: Uint8Array
  /** Requested finality (2.0 pools only). */
  finality?: FinalityRequested
  /** Message-level `GenericExtraArgsV3.tokenArgs` (2.0 pools only). */
  tokenArgs?: Uint8Array
}

/** Result of {@link simulateLockOrBurn}: the pool's `LockOrBurnOut`, plus where it came from. */
export type SolanaLockOrBurnSimResult = {
  /** Pool interface the router would call, and the simulation did. */
  poolInterface: SolanaPoolInterface
  /** Pool state account, which the router reports as the message's `sourcePoolAddress`. */
  sourcePoolAddress: PublicKey
  /** Destination token address as raw bytes, as returned by the pool. */
  destTokenAddress: Buffer
  /** `destPoolData`, consumed by the destination pool's `releaseOrMint` as `sourcePoolData`. */
  destPoolData: Buffer
  /** Amount the message carries: post-fee for 2.0 pools, the input amount otherwise. */
  destTokenAmount: bigint
}

/**
 * Simulates the source pool's `lockOrBurn` for a prospective token transfer, the way the router
 * calls it in a send, to obtain the `destPoolData` and post-fee amount the message would carry.
 *
 * The router signs its pool CPIs with its `external_token_pools_signer` PDA, and transfers the
 * amount into the pool's token account just before. A simulation with signature verification off
 * stands in for both: it lists that PDA as a signer of a top-level `lockOrBurn`, and prepends a
 * `mintTo` signed by the mint authority (or, if the mint has none, a transfer signed by the
 * sender). This is the Solana counterpart of the EVM `eth_call` from the OnRamp with a balance
 * state override. The pool's accounts are the ones the router passes: the token's lookup table
 * entries, plus whatever the pool resolves on-chain.
 *
 * The simulation also runs the pool's own checks (rate limits, finality, allowlist, curses), so a
 * revert there is the verdict the real send would get, thrown as {@link CCIPSourcePoolRevertError}.
 * Everything else, such as a failed balance setup or a token program error, says nothing about the
 * real send, and is rethrown raw.
 *
 * @param ctx - Context with the Solana connection and logger.
 * @param opts - {@link SolanaSimulateLockOrBurnOpts}
 * @returns The pool's `LockOrBurnOut`, with the pool interface used and the source pool address.
 * @throws {@link CCIPSourcePoolRevertError} if the pool itself rejects the transfer
 * @throws {@link CCIPTokenNotConfiguredError} if the token has no pool lookup table
 * @throws {@link CCIPSolanaLookupTableNotFoundError} if the token's lookup table is missing or short
 */
export async function simulateLockOrBurn(
  ctx: { connection: Connection } & WithLogger,
  opts: SolanaSimulateLockOrBurnOpts,
): Promise<SolanaLockOrBurnSimResult> {
  const { connection } = ctx
  const { router, mint, destChainSelector, amount } = opts
  const registry = await getTokenAdminRegistryConfig(connection, router, mint)
  if (!registry.lookupTable)
    throw new CCIPTokenNotConfiguredError(mint.toBase58(), router.toBase58())
  const lookupTable = (await connection.getAddressLookupTable(registry.lookupTable)).value
  const addresses = lookupTable?.state.addresses ?? []
  if (!lookupTable || addresses.length < LUT_REQUIRED_ENTRIES)
    throw new CCIPSolanaLookupTableNotFoundError(registry.lookupTable.toBase58())

  const entry = (i: number): AccountMeta => ({
    pubkey: addresses[i]!,
    isSigner: false,
    isWritable: registry.writableIndexes.includes(i),
  })
  const poolProgram = addresses[LUT_POOL_PROGRAM]!
  const poolConfig = addresses[LUT_POOL_CONFIG]!
  const routerPoolSigner = addresses[LUT_ROUTER_POOL_SIGNER]!
  const sender = opts.originalSender ?? PublicKey.default
  const chainConfig: AccountMeta = {
    pubkey: PublicKey.findProgramAddressSync(
      [Buffer.from('ccip_tokenpool_chainconfig'), toLeArray(destChainSelector, 8), mint.toBuffer()],
      poolProgram,
    )[0],
    isSigner: false,
    isWritable: true,
  }
  // The router's fixed pool accounts: `transfer_token_v2` / `transfer_token_legacy`
  const fixed = [
    { pubkey: routerPoolSigner, isSigner: true, isWritable: false },
    entry(LUT_POOL_CONFIG),
    entry(LUT_TOKEN_PROGRAM),
    entry(LUT_MINT),
    entry(LUT_POOL_SIGNER),
    entry(LUT_POOL_TOKEN_ACCOUNT),
  ]
  const lutExtras = addresses
    .slice(LUT_REQUIRED_ENTRIES)
    .map((_, i) => entry(LUT_REQUIRED_ENTRIES + i))
  const resolves = registry.accountResolution !== 'NoResolution'
  const resolverCtx = { ...ctx, poolProgram, poolConfig, routerPoolSigner }
  const lookupTables = [lookupTable]

  const poolInterface: SolanaPoolInterface =
    opts.laneV2 && registry.interfaceVersion > 1 ? 'v2' : 'v1'
  let keys: AccountMeta[], data: Buffer
  if (poolInterface === 'v2') {
    const finality = encodeFinality(opts.finality ?? 0n)
    const lockOrBurn: PoolTypes['LockOrBurnInV2'] = {
      receiver: Buffer.from(opts.receiver),
      remoteChainSelector: new BN(destChainSelector.toString()),
      originalSender: sender,
      amount: new BN(amount.toString()),
      localToken: mint,
      requestedFinalityConfig: { flags: finality >>> 16, blockDepth: finality & 0xffff },
      tokenArgs: Buffer.from(opts.tokenArgs ?? []),
    }
    const resolved = resolves
      ? await resolvePoolAccountsV2(resolverCtx, router, lockOrBurn)
      : { accounts: [], lookupTables: [] }
    lookupTables.push(...resolved.lookupTables)
    keys = [
      ...fixed,
      chainConfig,
      {
        pubkey: deriveTokenPoolChainConfigV2Pda(poolProgram, destChainSelector, mint),
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: deriveTokenPoolChainConfigOverridePda(poolProgram, destChainSelector, mint),
        isSigner: false,
        isWritable: true,
      },
      // only the 2.0 router skips the extras for `WithoutExtendedLookupTable`; the 1.6 one
      // passes every entry (`instructions_v1/v1/onramp/derive.rs`)
      ...(registry.accountResolution === 'WithoutExtendedLookupTable' ? [] : lutExtras),
      ...resolved.accounts,
    ]
    data = Buffer.concat([
      LOCK_OR_BURN_V2_DISCRIMINATOR,
      poolCoder.types.encode('LockOrBurnInV2', lockOrBurn),
    ])
  } else {
    const lockOrBurn: PoolTypes['LockOrBurnInV1'] = {
      receiver: Buffer.from(opts.receiver),
      remoteChainSelector: new BN(destChainSelector.toString()),
      originalSender: sender,
      amount: new BN(amount.toString()),
      localToken: mint,
      // The 1.6 router's per-sender nonce, read only by CCTP v1 as a PDA seed; nonces start at 1,
      // so 0 seeds an account no real message uses
      msgTotalNonce: new BN(0),
    }
    const resolved = resolves
      ? await resolvePoolAccountsV1(resolverCtx, lockOrBurn)
      : { accounts: [], lookupTables: [] }
    lookupTables.push(...resolved.lookupTables)
    const rmn = (seed: string) => ({
      pubkey: PublicKey.findProgramAddressSync([Buffer.from(seed)], opts.rmnRemote)[0],
      isSigner: false,
      isWritable: false,
    })
    keys = [
      ...fixed,
      { pubkey: opts.rmnRemote, isSigner: false, isWritable: false },
      rmn('curses'),
      rmn('config'),
      chainConfig,
      ...lutExtras,
      ...resolved.accounts,
    ]
    data = Buffer.concat([
      LOCK_OR_BURN_V1_DISCRIMINATOR,
      poolCoder.types.encode('LockOrBurnInV1', lockOrBurn),
    ])
  }

  const lockOrBurnIx = new TransactionInstruction({ programId: poolProgram, keys, data })
  const funding = await fundPoolIx(connection, {
    mint,
    tokenProgram: addresses[LUT_TOKEN_PROGRAM]!,
    poolTokenAccount: addresses[LUT_POOL_TOKEN_ACCOUNT]!,
    amount,
    sender: opts.originalSender,
  })
  const simulate = (instructions: TransactionInstruction[]) =>
    simulateTransaction(ctx, {
      payerKey: SIMULATION_PAYER,
      instructions,
      addressLookupTableAccounts: lookupTables,
    })

  let result: SimulatedTransactionResponse
  try {
    result = await simulate(funding ? [funding, lockOrBurnIx] : [lockOrBurnIx])
  } catch (err) {
    if (funding && getInstructionError(err)?.index === 0) {
      // the balance setup itself failed (e.g. a paused or hooked mint): try without it, as the
      // pool may not need the balance (CCTP v2) or may already hold it (lock-release)
      ctx.logger?.debug('lockOrBurn balance setup failed; simulating without it:', err)
      try {
        result = await simulate([lockOrBurnIx])
      } catch (retryErr) {
        throw asPoolRevert(retryErr, 0, { ...opts, poolProgram, poolConfig })
      }
    } else {
      throw asPoolRevert(err, funding ? 1 : 0, { ...opts, poolProgram, poolConfig })
    }
  }

  const returnData = result.returnData
  if (!returnData?.data[0] || returnData.programId !== poolProgram.toBase58()) {
    throw new CCIPError(
      CCIPErrorCode.SOLANA_SIMULATION_NO_RETURN_DATA,
      'No return data from the token pool lockOrBurn simulation',
      { context: { poolProgram: poolProgram.toBase58(), mint: mint.toBase58() } },
    )
  }
  const out = bytesToBuffer(returnData.data[0])
  if (poolInterface === 'v2') {
    const decoded = poolCoder.types.decode<PoolTypes['LockOrBurnOutV2']>('LockOrBurnOutV2', out)
    return {
      poolInterface,
      sourcePoolAddress: poolConfig,
      destTokenAddress: decoded.destTokenAddress.address,
      destPoolData: decoded.destPoolData,
      destTokenAmount: BigInt(decoded.destTokenAmount.toString()),
    }
  }
  const decoded = poolCoder.types.decode<PoolTypes['LockOrBurnOutV1']>('LockOrBurnOutV1', out)
  return {
    poolInterface,
    sourcePoolAddress: poolConfig,
    destTokenAddress: decoded.destTokenAddress.address,
    destPoolData: decoded.destPoolData,
    destTokenAmount: amount,
  }
}

type ResolverContext = { connection: Connection } & WithLogger & {
    poolProgram: PublicKey
    poolConfig: PublicKey
    routerPoolSigner: PublicKey
  }

type ResolvedPoolAccounts = { accounts: AccountMeta[]; lookupTables: AddressLookupTableAccount[] }

/**
 * Runs a 2.0 pool's `nested_resolve_accounts_start` rounds as the router's nested token stage does
 * (`ccip_send/resolve_accounts/nested_token.rs`): the first round gets the pool state account and
 * a `TokenPoolCpiResolutionInputs::LockOrBurn`, later ones what the pool asked for.
 */
async function resolvePoolAccountsV2(
  ctx: ResolverContext,
  router: PublicKey,
  lockOrBurn: PoolTypes['LockOrBurnInV2'],
): Promise<ResolvedPoolAccounts> {
  // `TokenPoolCpiResolutionInputs::LockOrBurn` is the enum's variant 0
  let inputs: Buffer = Buffer.concat([
    Buffer.from([0]),
    poolCoder.types.encode('LockOrBurnInV2', lockOrBurn),
  ])
  let askWith = [ctx.poolConfig]
  const accounts: AccountMeta[] = []
  const tables: PublicKey[] = []
  for (let round = 0; round < MAX_RESOLUTION_ROUNDS; round++) {
    const params: PoolTypes['NestedResolveAccountsParams'] = {
      caller: ctx.routerPoolSigner,
      callerProgram: router,
      cpiResolutionInputs: inputs,
    }
    const response = await simulatePoolView<PoolTypes['NestedResolveAccountsResponse']>(
      ctx,
      askWith,
      Buffer.concat([
        NESTED_RESOLVE_ACCOUNTS_START_DISCRIMINATOR,
        poolCoder.types.encode('NestedResolveAccountsParams', params),
      ]),
      'NestedResolveAccountsResponse',
    )
    // the router drops the signer bit of nested accounts (`normalize_nested_accounts`)
    for (const meta of response.accountsToSave)
      accounts.push({ pubkey: meta.pubkey, isSigner: false, isWritable: meta.isWritable })
    tables.push(...response.lookupTablesToSave)
    if (!response.nextCpiResolutionInputs.length)
      return { accounts, lookupTables: await fetchTables(ctx.connection, tables) }
    inputs = Buffer.from(response.nextCpiResolutionInputs)
    askWith = response.askAgainWith
  }
  throw new CCIPError(
    CCIPErrorCode.SOLANA_SIMULATION_NO_RETURN_DATA,
    `Token pool account resolution did not finish in ${MAX_RESOLUTION_ROUNDS} rounds`,
    { context: { poolProgram: ctx.poolProgram.toBase58() } },
  )
}

/**
 * Runs a pool's `derive_accounts_lock_or_burn_tokens` stages as the 1.6 router's nested token
 * derivation does (`instructions_v1/v1/onramp/derive.rs`), starting at stage `Start`.
 */
async function resolvePoolAccountsV1(
  ctx: ResolverContext,
  lockOrBurn: PoolTypes['LockOrBurnInV1'],
): Promise<ResolvedPoolAccounts> {
  let stage = 'Start'
  let askWith: PublicKey[] = []
  const accounts: AccountMeta[] = []
  const tables: PublicKey[] = []
  for (let round = 0; round < MAX_RESOLUTION_ROUNDS; round++) {
    const stageBytes = Buffer.from(stage)
    const response = await simulatePoolView<PoolTypes['DeriveAccountsResponse']>(
      ctx,
      askWith,
      Buffer.concat([
        DERIVE_ACCOUNTS_LOCK_OR_BURN_DISCRIMINATOR,
        toLeArray(stageBytes.length, 4),
        stageBytes,
        poolCoder.types.encode('LockOrBurnInV1', lockOrBurn),
      ]),
      'DeriveAccountsResponse',
    )
    for (const meta of response.accountsToSave)
      accounts.push({ pubkey: meta.pubkey, isSigner: meta.isSigner, isWritable: meta.isWritable })
    tables.push(...response.lookUpTablesToSave)
    if (!response.nextStage)
      return { accounts, lookupTables: await fetchTables(ctx.connection, tables) }
    stage = response.nextStage
    askWith = response.askAgainWith.map((meta) => meta.pubkey)
  }
  throw new CCIPError(
    CCIPErrorCode.SOLANA_SIMULATION_NO_RETURN_DATA,
    `Token pool account derivation did not finish in ${MAX_RESOLUTION_ROUNDS} stages`,
    { context: { poolProgram: ctx.poolProgram.toBase58() } },
  )
}

/** Simulates a read-only pool instruction and decodes its return data as `returnType`. */
async function simulatePoolView<T>(
  ctx: ResolverContext,
  accounts: PublicKey[],
  data: Buffer,
  returnType: string,
): Promise<T> {
  const ix = new TransactionInstruction({
    programId: ctx.poolProgram,
    keys: accounts.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })),
    data,
  })
  const { returnData } = await simulateTransaction(ctx, {
    payerKey: SIMULATION_PAYER,
    instructions: [ix],
  })
  if (!returnData?.data[0] || returnData.programId !== ctx.poolProgram.toBase58()) {
    throw new CCIPError(
      CCIPErrorCode.SOLANA_SIMULATION_NO_RETURN_DATA,
      `No return data from the token pool's ${returnType} simulation`,
      { context: { poolProgram: ctx.poolProgram.toBase58() } },
    )
  }
  return poolCoder.types.decode<T>(returnType, bytesToBuffer(returnData.data[0]))
}

async function fetchTables(
  connection: Connection,
  tables: PublicKey[],
): Promise<AddressLookupTableAccount[]> {
  return Promise.all(
    tables.map(async (table) => {
      const { value } = await connection.getAddressLookupTable(table)
      if (!value) throw new CCIPSolanaLookupTableNotFoundError(table.toBase58())
      return value
    }),
  )
}

/**
 * The instruction standing in for the router's transfer into the pool: a `mintTo` the pool's token
 * account signed by the mint authority (each required signer of a multisig one), or, for a mint
 * without one, a transfer from the sender's associated token account signed by the sender.
 *
 * @returns The instruction, or undefined if neither applies (or the mint can't be read)
 */
async function fundPoolIx(
  connection: Connection,
  {
    mint,
    tokenProgram,
    poolTokenAccount,
    amount,
    sender,
  }: {
    mint: PublicKey
    tokenProgram: PublicKey
    poolTokenAccount: PublicKey
    amount: bigint
    sender?: PublicKey
  },
): Promise<TransactionInstruction | undefined> {
  let mintInfo
  try {
    mintInfo = unpackMint(mint, await connection.getAccountInfo(mint), tokenProgram)
  } catch {
    return
  }
  const authority = mintInfo.mintAuthority
  if (authority) {
    const authorityAccount = await connection.getAccountInfo(authority)
    let signers: PublicKey[] = []
    if (
      authorityAccount?.owner.equals(tokenProgram) &&
      authorityAccount.data.length === MULTISIG_SIZE
    ) {
      const multisig = unpackMultisig(authority, authorityAccount, tokenProgram)
      signers = [
        multisig.signer1,
        multisig.signer2,
        multisig.signer3,
        multisig.signer4,
        multisig.signer5,
        multisig.signer6,
        multisig.signer7,
        multisig.signer8,
        multisig.signer9,
        multisig.signer10,
        multisig.signer11,
      ].slice(0, multisig.m)
    }
    return createMintToInstruction(mint, poolTokenAccount, authority, amount, signers, tokenProgram)
  }
  if (!sender) return
  return createTransferCheckedInstruction(
    getAssociatedTokenAddressSync(mint, sender, true, tokenProgram),
    mint,
    poolTokenAccount,
    sender,
    amount,
    mintInfo.decimals,
    [],
    tokenProgram,
  )
}

/**
 * Turns a failed `lockOrBurn` simulation into a {@link CCIPSourcePoolRevertError} when the pool
 * program itself rejected the transfer, at the `lockOrBurn` instruction, for a known sender.
 * Returns any other error unchanged.
 */
function asPoolRevert(
  err: unknown,
  lockOrBurnIndex: number,
  opts: SolanaSimulateLockOrBurnOpts & { poolProgram: PublicKey; poolConfig: PublicKey },
): unknown {
  const failed = getInstructionError(err)
  if (!opts.originalSender || failed?.index !== lockOrBurnIndex) return err
  if (typeof failed.error !== 'object' || failed.error === null || !('Custom' in failed.error))
    return err
  const code = (failed.error as { Custom: number }).Custom
  // only the pool's own errors are verdicts: Anchor's framework errors (below 6000, e.g. an
  // account constraint) may as well come from an account this simulation got wrong
  if (code < ANCHOR_USER_ERROR_START) return err
  const logs = (err as { logs?: string[] }).logs ?? []
  // the innermost failure is logged first: a token program error inside the pool's CPI is the
  // balance setup's shortfall, not the pool's verdict
  const failedProgram = logs
    .map((log) => /^Program (\w+) failed: /.exec(log)?.[1])
    .find((program) => program != null)
  if (failedProgram !== opts.poolProgram.toBase58()) return err
  const anchorError = logs
    .map((log) => /Error Code: (\w+)\. Error Number: (\d+)\. Error Message: (.*?)\.?$/.exec(log))
    .find((match) => match != null)
  const detail = anchorError
    ? `${anchorError[1]} (${anchorError[2]}): ${anchorError[3]}`
    : `custom program error ${code}`
  return new CCIPSourcePoolRevertError(detail, {
    cause: err instanceof Error ? err : undefined,
    // a drained bucket refills; a capacity below the amount doesn't
    isTransient: anchorError?.[1] === 'RLRateLimitReached',
    context: {
      revert: code,
      ...(anchorError && { error: anchorError[1] }),
      tokenPool: opts.poolConfig.toBase58(),
      poolProgram: opts.poolProgram.toBase58(),
      token: opts.mint.toBase58(),
      router: opts.router.toBase58(),
      amount: opts.amount.toString(),
      destChainSelector: opts.destChainSelector.toString(),
    },
  })
}
