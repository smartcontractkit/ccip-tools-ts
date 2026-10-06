import { Buffer } from 'buffer'

import type { IdlTypes } from '@coral-xyz/anchor'
import {
  type AddressLookupTableAccount,
  type Connection,
  ComputeBudgetProgram,
  PublicKey,
  SendTransactionError,
  TransactionInstruction,
} from '@solana/web3.js'
import type BN from 'bn.js'

import { CCIPError } from '../errors/CCIPError.ts'
import { CCIPErrorCode } from '../errors/codes.ts'
import {
  type SolanaV2LaneUnavailableReason,
  CCIPArgumentInvalidError,
  CCIPSolanaFeeResultInvalidError,
  CCIPSolanaV2LaneUnavailableError,
} from '../errors/index.ts'
import type { ExtraArgs, GenericExtraArgsV3 } from '../extra-args.ts'
import { ChainFamily } from '../networks.ts'
import { type AnyMessage, type WithLogger, CCIPVersion } from '../types.ts'
import { bytesToBuffer, toLeArray } from '../utils.ts'
import { newProgram, sighash, sizedCoder } from './coder.ts'
import { IDL as CCIP_ROUTER_V2_IDL } from './idl/2.0.0/CCIP_ROUTER.ts'
import {
  MAX_HEAP_FRAME_BYTES,
  fetchLookupTables,
  resolveCcipSendV2,
  resolveGetFeeV2,
} from './resolution.ts'
import { generateApproveIxs } from './send.ts'
import type { UnsignedSolanaTx } from './types.ts'
import { SIMULATION_PAYER, customInstructionErrorCode, simulateTransaction } from './utils.ts'

/*
 * CCIP 2.0 send path, and the choice between it and the 1.6 one.
 *
 * Solana is the only family whose router exposes both a 1.6 (`ccip_send`) and a 2.0
 * (`ccip_send_v2`) entrypoint, side by side and per lane, so the SDK picks one off-chain. 2.0 is
 * preferred whenever it's possible; legacy extraArgs fall back to 1.6 when it isn't, while
 * GenericExtraArgsV3 (which only 2.0 lanes accept) can't.
 */

const routerV2Coder = sizedCoder(CCIP_ROUTER_V2_IDL)

/** Discriminator of the router's `observe_dest_chain_v2`. */
export const OBSERVE_DEST_CHAIN_V2_DISCRIMINATOR = sighash('global', 'observe_dest_chain_v2')

// Anchor errors `observe_dest_chain_v2` fails with when there's no 2.0 lane to observe
const INSTRUCTION_FALLBACK_NOT_FOUND = 101 // the router doesn't have 2.0 support yet
const ACCOUNT_NOT_INITIALIZED = 3012 // no `dest_chain_state_v2` account for the lane
// `dest_chain_state_v2` is still system-owned, but was prefunded (anyone can send lamports to it)
const ACCOUNT_OWNED_BY_WRONG_PROGRAM = 3007

// WIP: account resolution doesn't return the deployment's fixed ccip_send lookup table yet (an
// upstream oversight, to be fixed in the router), and 2.0 token transfers only fit a v0
// transaction with it. Until it's discoverable, it's hardcoded here per 2.0 router; remove this
// once resolution returns it.
const CCIP_SEND_V2_LOOKUP_TABLES: Readonly<Record<string, string>> = {
  // CCIP 2.0 staging deployment on Solana devnet
  CcipP6NhMw34e7hNJXmNytvzmSYrwQ1TcFgfQAxJhNqm: '61yGrR9h9YU7wq5b3LiYSdePou1iAg5giaVMBig8fK6m',
}

const MAX_UINT32 = 0xffff_ffffn

/** `observe_dest_chain_v2`'s view of a 2.0 lane. */
export type DestChainV2Observation = IdlTypes<
  typeof CCIP_ROUTER_V2_IDL
>['RouterDestChainV2Observation']

/** The router entrypoint a message goes through, with the message to send through it. */
export type SolanaSendLane =
  | {
      version: typeof CCIPVersion.V2_0
      message: AnyMessage & { extraArgs: GenericExtraArgsV3 }
    }
  | { version: typeof CCIPVersion.V1_6; message: AnyMessage }

function destChainStateV2Pda(router: PublicKey, destChainSelector: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('dest_chain_state_v2'), toLeArray(destChainSelector, 8)],
    router,
  )[0]
}

function requestHeapFrameIx(): TransactionInstruction {
  return ComputeBudgetProgram.requestHeapFrame({ bytes: MAX_HEAP_FRAME_BYTES })
}

/**
 * Whether extraArgs are GenericExtraArgsV3, which only CCIP 2.0 lanes accept.
 * @param extraArgs - Message extraArgs.
 * @returns True for GenericExtraArgsV3.
 */
export function isGenericExtraArgsV3(extraArgs: ExtraArgs): extraArgs is GenericExtraArgsV3 {
  return 'finality' in extraArgs
}

/**
 * Converts a message's extraArgs to the GenericExtraArgsV3 a CCIP 2.0 lane requires: 2.0 lanes
 * reject any other extraArgs tag. Legacy args only carry their `gasLimit` over, with every other
 * field left to the lane defaults; `allowOutOfOrderExecution` is dropped, as 2.0 has no ordered
 * execution.
 * @param extraArgs - Message extraArgs, as populated by `buildMessageForDest`.
 * @returns The V3 args, or undefined if they can't be expressed as V3 without losing
 *   information (a gasLimit over uint32, Sui receiver objects or token receiver, other
 *   families' args), making the message 1.6-only.
 */
export function toGenericExtraArgsV3(extraArgs: ExtraArgs): GenericExtraArgsV3 | undefined {
  if (isGenericExtraArgsV3(extraArgs)) return extraArgs
  if ('receiverObjectIds' in extraArgs) {
    // SuiExtraArgsV1: `buildMessageForDest` moves token transfers' receiver to `tokenReceiver`
    if (extraArgs.receiverObjectIds.length || !/^(0x)?0*$/i.test(extraArgs.tokenReceiver)) return
  } else if (
    Object.keys(extraArgs).some(
      (key) => !['gasLimit', 'allowOutOfOrderExecution', '_tag'].includes(key),
    )
  ) {
    return
  }
  const { gasLimit } = extraArgs as { gasLimit?: bigint }
  if (gasLimit == null || gasLimit < 0n || gasLimit > MAX_UINT32) return
  return {
    gasLimit,
    finality: 'finalized',
    ccvs: [],
    ccvArgs: [],
    executor: '',
    executorArgs: '0x',
    tokenReceiver: '',
    tokenArgs: '0x',
  }
}

/**
 * Observes a lane's CCIP 2.0 configuration by simulating the router's read-only
 * `observe_dest_chain_v2`.
 * @param ctx - Context with the Solana connection and logger.
 * @param opts - Router and destination chain selector.
 * @returns The lane's observation, or why the router has no 2.0 lane to it.
 * @throws the simulation error if it fails for another reason (RPC failures included)
 */
export async function observeDestChainV2(
  ctx: { connection: Connection } & WithLogger,
  { router, destChainSelector }: { router: PublicKey; destChainSelector: bigint },
): Promise<{ observation: DestChainV2Observation } | { reason: SolanaV2LaneUnavailableReason }> {
  const ix = new TransactionInstruction({
    programId: router,
    keys: [
      {
        pubkey: destChainStateV2Pda(router, destChainSelector),
        isSigner: false,
        isWritable: false,
      },
    ],
    data: Buffer.concat([OBSERVE_DEST_CHAIN_V2_DISCRIMINATOR, toLeArray(destChainSelector, 8)]),
  })
  let simResult
  try {
    simResult = await simulateTransaction(ctx, {
      payerKey: SIMULATION_PAYER,
      instructions: [ix],
    })
  } catch (error) {
    if (!(error instanceof SendTransactionError)) throw error
    const custom = customInstructionErrorCode(error)
    if (custom === ACCOUNT_NOT_INITIALIZED || custom === ACCOUNT_OWNED_BY_WRONG_PROGRAM)
      return { reason: 'lane-not-configured' }
    if (custom === INSTRUCTION_FALLBACK_NOT_FOUND) return { reason: 'router-without-v2-support' }
    throw error
  }
  const returnData = simResult.returnData
  if (!returnData?.data[0] || returnData.programId !== router.toBase58()) {
    throw new CCIPError(
      CCIPErrorCode.SOLANA_SIMULATION_NO_RETURN_DATA,
      'No return data from observe_dest_chain_v2 simulation',
      { context: { router: router.toBase58(), destChainSelector } },
    )
  }
  return {
    observation: routerV2Coder.types.decode<DestChainV2Observation>(
      'RouterDestChainV2Observation',
      bytesToBuffer(returnData.data[0]),
    ),
  }
}

// The observation only counts the allowed senders, so the list is read from the lane's PDA
async function isSenderAllowlisted(
  connection: Connection,
  {
    router,
    destChainSelector,
    sender,
  }: {
    router: PublicKey
    destChainSelector: bigint
    sender: PublicKey
  },
): Promise<boolean> {
  const program = newProgram(CCIP_ROUTER_V2_IDL, router, { connection })
  const { config } = await program.account.destChainCcipV2.fetch(
    destChainStateV2Pda(router, destChainSelector),
  )
  return config.allowedSenders.some((allowed) => allowed.equals(sender))
}

/**
 * Chooses the router entrypoint for a message:
 * - 2.0 whenever it's possible: the extraArgs are, or convert to, GenericExtraArgsV3 (see
 *   {@link toGenericExtraArgsV3}), the lane is configured for 2.0, and, if the lane's allowlist is
 *   enabled, the sender is allowlisted;
 * - otherwise 1.6, for legacy extraArgs;
 * - GenericExtraArgsV3 has no 1.6 fallback, and throws instead.
 *
 * On a lane with its allowlist enabled the choice depends on the sender, so it's required there:
 * a quote without it could come from another entrypoint than the send, and differ from its fee.
 * @param ctx - Context with the Solana connection and logger.
 * @param opts - Router, destination selector, message (as populated by `buildMessageForDest`),
 *   and its sender, if known.
 * @returns The entrypoint version, and the message to send through it (with V3 extraArgs for 2.0).
 * @throws {@link CCIPSolanaV2LaneUnavailableError} if the message requires 2.0 and it isn't possible
 * @throws {@link CCIPArgumentInvalidError} if the lane's allowlist is enabled and `sender` is missing
 */
export async function selectSendLane(
  ctx: { connection: Connection } & WithLogger,
  {
    router,
    destChainSelector,
    message,
    sender,
  }: { router: PublicKey; destChainSelector: bigint; message: AnyMessage; sender?: PublicKey },
): Promise<SolanaSendLane> {
  const { logger = console } = ctx
  const extraArgs = toGenericExtraArgsV3(message.extraArgs)
  if (!extraArgs) {
    logger.debug('extraArgs have no GenericExtraArgsV3 equivalent, sending over CCIP 1.6')
    return { version: CCIPVersion.V1_6, message }
  }

  const lane = await observeDestChainV2(ctx, { router, destChainSelector })
  let reason: SolanaV2LaneUnavailableReason | undefined
  if ('reason' in lane) reason = lane.reason
  else if (lane.observation.allowListEnabled) {
    // the allowlist decides the entrypoint, so without the sender a quote could miss the send's fee
    if (!sender) {
      throw new CCIPArgumentInvalidError(
        'sender',
        `required for the CCIP 2.0 lane from router ${router.toBase58()} to ${destChainSelector}: its sender allowlist decides whether the message goes over 2.0 or 1.6, at different fees`,
        { context: { router: router.toBase58(), destChainSelector } },
      )
    }
    if (!(await isSenderAllowlisted(ctx.connection, { router, destChainSelector, sender })))
      reason = 'sender-not-allowed'
  }
  if (!reason) return { version: CCIPVersion.V2_0, message: { ...message, extraArgs } }

  if (isGenericExtraArgsV3(message.extraArgs)) {
    throw new CCIPSolanaV2LaneUnavailableError(reason, {
      router: router.toBase58(),
      destChainSelector,
      ...(sender && { sender: sender.toBase58() }),
    })
  }
  logger.debug('No CCIP 2.0 lane', { reason }, 'falling back to CCIP 1.6')
  return { version: CCIPVersion.V1_6, message }
}

// Resolved lookup tables, plus the deployment's fixed one, if known
async function withSendLookupTables(
  connection: Connection,
  router: PublicKey,
  lookupTables: AddressLookupTableAccount[],
): Promise<AddressLookupTableAccount[]> {
  const fixed = CCIP_SEND_V2_LOOKUP_TABLES[router.toBase58()]
  if (!fixed || lookupTables.some(({ key }) => key.toBase58() === fixed)) return lookupTables
  return [...lookupTables, ...(await fetchLookupTables(connection, [new PublicKey(fixed)]))]
}

/**
 * Quotes a message over a CCIP 2.0 lane, simulating the router's resolved `get_fee_v2`.
 * @param ctx - Context with the Solana connection and logger.
 * @param opts - Router, destination selector, message with V3 extraArgs, and its sender, if known.
 * @returns Fee amount, in the message's fee token (native if omitted).
 * @throws {@link CCIPSolanaFeeResultInvalidError} if the simulation returns no fee
 */
export async function getFeeV2(
  ctx: { connection: Connection } & WithLogger,
  {
    router,
    destChainSelector,
    message,
    // quotes without a sender are only allowed on lanes without an allowlist, see `selectSendLane`
    sender = SIMULATION_PAYER,
  }: { router: PublicKey; destChainSelector: bigint; message: AnyMessage; sender?: PublicKey },
): Promise<bigint> {
  const { instruction, lookupTables } = await resolveGetFeeV2(ctx, {
    router,
    destChainSelector,
    sender,
    message,
  })
  const simResult = await simulateTransaction(ctx, {
    payerKey: sender,
    instructions: [requestHeapFrameIx(), instruction],
    addressLookupTableAccounts: await withSendLookupTables(ctx.connection, router, lookupTables),
  })
  const returnData = simResult.returnData
  if (!returnData?.data[0] || returnData.programId !== router.toBase58()) {
    throw new CCIPSolanaFeeResultInvalidError('No return data from get_fee_v2 simulation')
  }
  const { amount } = routerV2Coder.types.decode<{ amount: BN }>(
    'GetFeeResultV2',
    bytesToBuffer(returnData.data[0]),
  )
  return BigInt(amount.toString())
}

/**
 * Generates unsigned instructions for sending a message over a CCIP 2.0 lane: token approvals,
 * then a heap frame request and the resolved `ccip_send_v2`, which must share a transaction.
 * @param ctx - Context containing connection and logger.
 * @param sender - Wallet sending the message and paying its fees.
 * @param router - Router program address.
 * @param destChainSelector - Destination chain selector.
 * @param message - CCIP message with V3 extraArgs and fee.
 * @param opts - Optional parameters for approval.
 * @returns Solana unsigned txs (instructions and lookup tables); `ccip_send_v2` is last
 */
export async function generateUnsignedCcipSendV2(
  ctx: { connection: Connection } & WithLogger,
  sender: PublicKey,
  router: PublicKey,
  destChainSelector: bigint,
  message: AnyMessage & { fee: bigint },
  opts?: { approveMax?: boolean },
): Promise<UnsignedSolanaTx> {
  const approveIxs = await generateApproveIxs(ctx, sender, router, message, opts)
  const { instruction, lookupTables } = await resolveCcipSendV2(ctx, {
    router,
    destChainSelector,
    sender,
    message,
  })
  return {
    family: ChainFamily.Solana,
    mainIndex: approveIxs.length + 1,
    instructions: [...approveIxs, requestHeapFrameIx(), instruction],
    lookupTables: await withSendLookupTables(ctx.connection, router, lookupTables),
  }
}
