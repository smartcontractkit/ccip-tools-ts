import { Buffer } from 'buffer'

import { BorshCoder } from '@coral-xyz/anchor'
import {
  type AccountMeta,
  type AddressLookupTableAccount,
  type Connection,
  ComputeBudgetProgram,
  PublicKey,
  SendTransactionError,
  TransactionInstruction,
} from '@solana/web3.js'
import BN from 'bn.js'
import type { BytesLike } from 'ethers'

import { CCIPError } from '../errors/CCIPError.ts'
import { CCIPErrorCode } from '../errors/codes.ts'
import {
  CCIPSolanaAccountResolutionError,
  CCIPSolanaLookupTableNotFoundError,
} from '../errors/index.ts'
import type { AnyMessage, WithLogger } from '../types.ts'
import { bytesToBuffer } from '../utils.ts'
import { IDL as CCIP_COMMON_IDL } from './idl/2.0.0/CCIP_COMMON.ts'
import { IDL as CCIP_OFFRAMP_V2_IDL } from './idl/2.0.0/CCIP_OFFRAMP.ts'
import { IDL as CCIP_ROUTER_V2_IDL } from './idl/2.0.0/CCIP_ROUTER.ts'
import { patchBorsh, sighash } from './patchBorsh.ts'
import { anyToSvmMessage } from './send.ts'
import { simulateTransaction } from './utils.ts'

/*
 * CCIP 2.0 account resolution (see `ccip_common::resolution`).
 *
 * The v2 router and offramp compute the account list of their own instructions on-chain,
 * through a chain of read-only "stage" instructions. Each stage receives the same
 * `ResolveAccountsParams` (caller + final instruction data + the previous stage's metadata),
 * with the accounts the previous stage asked for, and returns a `ResolveAccountsResponse`.
 * Driving the chain to completion and concatenating what every stage saved yields the
 * accounts, lookup tables and resolution metadata of the final instruction.
 */

const commonCoder = new BorshCoder(CCIP_COMMON_IDL)
const routerV2Coder = new BorshCoder(CCIP_ROUTER_V2_IDL)
const offrampV2Coder = new BorshCoder(CCIP_OFFRAMP_V2_IDL)

/** Discriminator of `resolve_accounts_start`, shared by every program implementing resolution. */
export const RESOLVE_ACCOUNTS_START_DISCRIMINATOR = sighash('global', 'resolve_accounts_start')
/** Discriminator of the router's `get_fee_v2`. */
export const GET_FEE_V2_DISCRIMINATOR = sighash('global', 'get_fee_v2')
/** Discriminator of the router's `ccip_send_v2`. */
export const CCIP_SEND_V2_DISCRIMINATOR = sighash('global', 'ccip_send_v2')
/** Discriminator of the offramp's `execute_v2`. */
export const EXECUTE_V2_DISCRIMINATOR = sighash('global', 'execute_v2')

/** Matches the Go reference client; real flows take well under 20 rounds. */
const DEFAULT_MAX_ROUNDS = 64
/** The router and offramp run on a custom heap, so resolution needs the largest heap frame. */
const MAX_HEAP_FRAME_BYTES = 256 * 1024

// Known stage names, only used to make logs and errors readable
const STAGE_NAMES = [
  'resolve_accounts_start',
  // router (ccip_send_v2 / get_fee_v2)
  'resolve_accounts_fee_token_billing_stage',
  'resolve_accounts_executor_stage',
  'resolve_accounts_construct_final_ccv_list_stage',
  'resolve_accounts_ccv_stage',
  'resolve_accounts_token_transfer_retrieve_lut_stage',
  'resolve_accounts_token_transfer_static_accounts_stage',
  'resolve_accounts_nested_token_stage',
  // offramp (execute_v2 / get_ccvs_for_msg)
  'resolve_accounts_get_ccvs_for_msg_stage',
  'resolve_accounts_execute_message_stage',
  'resolve_accounts_execute_token_transfer_retrieve_lut_stage',
  'resolve_accounts_execute_token_transfer_static_accounts_stage',
  'resolve_accounts_execute_nested_token_stage',
  'resolve_accounts_execute_ccv_stage',
]
let stageNames: Map<string, string> | undefined

/**
 * Human-readable name of a resolution stage.
 * @param discriminator - Stage instruction discriminator.
 * @returns The stage instruction name, or the discriminator in hex if unknown.
 */
export function resolutionStageName(discriminator: Uint8Array): string {
  stageNames ??= new Map(STAGE_NAMES.map((name) => [sighash('global', name).toString('hex'), name]))
  const hex = Buffer.from(discriminator).toString('hex')
  return stageNames.get(hex) ?? `0x${hex}`
}

/** Inputs every resolution stage receives. */
export type ResolveAccountsParams = {
  /** Account expected to sign the final instruction. */
  caller: PublicKey
  /** Final instruction data, discriminator included. */
  ixData: Buffer
  /** Metadata returned by the previous stage; empty on the first one. */
  metadata: Buffer
}

/** What a resolution stage returns. */
export type ResolveAccountsResponse = {
  /** Accounts (all readonly) to pass to the next stage. */
  askAgainWith: PublicKey[]
  /** Accounts to append to the final instruction's account list. */
  accountsToSave: AccountMeta[]
  /** Lookup tables the final transaction can use. */
  lookupTablesToSave: PublicKey[]
  /** Next stage to call, or null when resolution is complete. */
  nextIxDiscriminator: Buffer | null
  /** Metadata for the next stage; for the last stage, the final instruction's `resolution_metadata`. */
  metadata: Buffer
}

/** Outcome of a completed resolution. */
export type ResolvedAccounts = {
  /** Every stage's `accountsToSave`, in order and not deduplicated: the layout is positional. */
  accounts: AccountMeta[]
  /** Every stage's `lookupTablesToSave`, in order. */
  lookupTables: PublicKey[]
  /** Metadata returned by the last stage. */
  metadata: Buffer
  /** Number of stages simulated. */
  rounds: number
}

/**
 * Builds a resolution stage instruction. Stages are addressed by raw discriminator (whatever the
 * previous stage returned), so this doesn't go through an Anchor `Program`.
 * @param programId - Program implementing resolution.
 * @param discriminator - Stage instruction discriminator.
 * @param params - Stage inputs.
 * @param accounts - Stage accounts, passed as readonly non-signers.
 * @returns The stage instruction.
 */
export function encodeResolveAccountsIx(
  programId: PublicKey,
  discriminator: Uint8Array,
  params: ResolveAccountsParams,
  accounts: readonly PublicKey[],
): TransactionInstruction {
  patchBorsh()
  return new TransactionInstruction({
    programId,
    keys: accounts.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })),
    data: Buffer.concat([
      Buffer.from(discriminator),
      commonCoder.types.encode('ResolveAccountsParams', params),
    ]),
  })
}

/**
 * Decodes a stage's Borsh-encoded return data.
 * @param data - Raw return data.
 * @returns The decoded response.
 */
export function decodeResolveAccountsResponse(data: Buffer): ResolveAccountsResponse {
  const response = commonCoder.types.decode<{
    askAgainWith: PublicKey[]
    accountsToSave: AccountMeta[]
    lookupTablesToSave: PublicKey[]
    nextIxDiscriminator: number[] | null
    metadata: Buffer
  }>('ResolveAccountsResponse', data)
  return {
    ...response,
    accountsToSave: response.accountsToSave.map(({ pubkey, isSigner, isWritable }) => ({
      pubkey,
      isSigner,
      isWritable,
    })),
    nextIxDiscriminator: response.nextIxDiscriminator
      ? Buffer.from(response.nextIxDiscriminator)
      : null,
  }
}

// Names the failure from the program's own error when possible: `ccip_common` errors are shared by
// every program implementing resolution, and Anchor logs the name of any other program error
function describeSimulationError(error: SendTransactionError): string {
  const simulationError = (error as { simulationError?: unknown }).simulationError
  const custom = (
    simulationError as { InstructionError?: [number, { Custom?: number }] } | undefined
  )?.InstructionError?.[1]?.Custom
  const known = CCIP_COMMON_IDL.errors.find(({ code }) => code === custom)
  if (known) return `${known.name} (${known.code}): ${known.msg}`
  const anchorError = error.logs
    ?.map((log) => log.match(/Error Code: (\w+)\. Error Number: (\d+)\. Error Message: (.*)$/))
    .findLast((match) => match)
  if (anchorError) return `${anchorError[1]} (${anchorError[2]}): ${anchorError[3]}`
  return `simulation failed: ${JSON.stringify(simulationError ?? error.message)}`
}

/**
 * Runs the account resolution flow for an instruction of a CCIP 2.0 program, simulating one
 * stage per round until the program reports resolution as complete.
 * @param ctx - Context with the Solana connection and logger.
 * @param opts - Resolution inputs:
 *   - `programId`: router or offramp implementing resolution;
 *   - `caller`: account expected to sign the final instruction;
 *   - `ixData`: final instruction data (discriminator included), with empty resolution metadata;
 *   - `extraAccounts`: accounts the start stage needs after the config PDA, if any;
 *   - `payer`: simulation fee payer (must exist on-chain), defaults to `caller`;
 *   - `maxRounds`: upper bound on simulated stages.
 * @returns The accumulated accounts, lookup tables and final metadata.
 * @throws {@link CCIPSolanaAccountResolutionError} if a stage fails, returns foreign data, or resolution doesn't terminate
 */
export async function resolveAccounts(
  { connection, logger = console }: { connection: Connection } & WithLogger,
  {
    programId,
    caller,
    ixData,
    extraAccounts = [],
    payer = caller,
    maxRounds = DEFAULT_MAX_ROUNDS,
  }: {
    programId: PublicKey
    caller: PublicKey
    ixData: Buffer
    extraAccounts?: readonly PublicKey[]
    payer?: PublicKey
    maxRounds?: number
  },
): Promise<ResolvedAccounts> {
  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)
  const heapFrameIx = ComputeBudgetProgram.requestHeapFrame({ bytes: MAX_HEAP_FRAME_BYTES })

  const accounts: AccountMeta[] = []
  const lookupTables: PublicKey[] = []
  let discriminator: Buffer = RESOLVE_ACCOUNTS_START_DISCRIMINATOR
  let askWith: readonly PublicKey[] = [config, ...extraAccounts]
  let metadata: Buffer = Buffer.alloc(0)

  for (let round = 1; ; round++) {
    const context = {
      programId: programId.toBase58(),
      round,
      stage: resolutionStageName(discriminator),
    }
    if (round > maxRounds) {
      throw new CCIPSolanaAccountResolutionError(
        `resolution did not complete within ${maxRounds} rounds`,
        context,
      )
    }

    const ix = encodeResolveAccountsIx(
      programId,
      discriminator,
      { caller, ixData, metadata },
      askWith,
    )
    const simResult = await simulateTransaction(
      { connection, logger },
      { payerKey: payer, instructions: [heapFrameIx, ix] },
    ).catch((error: unknown) => {
      // network and RPC errors keep their own (possibly transient) type
      if (!(error instanceof SendTransactionError)) throw error
      throw new CCIPSolanaAccountResolutionError(describeSimulationError(error), context, {
        cause: error,
      })
    })

    const returnData = simResult.returnData
    if (!returnData?.data[0]) {
      throw new CCIPError(
        CCIPErrorCode.SOLANA_SIMULATION_NO_RETURN_DATA,
        `No return data from ${context.stage} simulation`,
        { context },
      )
    }
    // return data is last-writer-wins: a nested CPI's leftover would decode as garbage
    if (returnData.programId !== context.programId) {
      throw new CCIPSolanaAccountResolutionError(
        `return data came from ${returnData.programId}`,
        context,
      )
    }

    let response
    try {
      response = decodeResolveAccountsResponse(bytesToBuffer(returnData.data[0]))
    } catch (error) {
      throw new CCIPSolanaAccountResolutionError('malformed resolution response', context, {
        cause: error as Error,
      })
    }
    logger.debug('Account resolution round', context, {
      accountsToSave: response.accountsToSave.length,
      lookupTablesToSave: response.lookupTablesToSave.map((table) => table.toBase58()),
      next: response.nextIxDiscriminator && resolutionStageName(response.nextIxDiscriminator),
    })

    accounts.push(...response.accountsToSave)
    lookupTables.push(...response.lookupTablesToSave)
    metadata = response.metadata
    if (!response.nextIxDiscriminator) return { accounts, lookupTables, metadata, rounds: round }

    discriminator = response.nextIxDiscriminator
    askWith = response.askAgainWith
  }
}

/**
 * Fetches address lookup tables, skipping duplicates.
 * @param connection - Solana connection.
 * @param keys - Lookup table addresses.
 * @returns The lookup table accounts, in first-seen order.
 * @throws {@link CCIPSolanaLookupTableNotFoundError} if a table doesn't exist
 */
export async function fetchLookupTables(
  connection: Connection,
  keys: readonly PublicKey[],
): Promise<AddressLookupTableAccount[]> {
  const unique = [...new Map(keys.map((key) => [key.toBase58(), key])).values()]
  return Promise.all(
    unique.map(async (key) => {
      const { value } = await connection.getAddressLookupTable(key)
      if (!value) throw new CCIPSolanaLookupTableNotFoundError(key.toBase58())
      return value
    }),
  )
}

/** A fully resolved instruction, ready to be put in a v0 transaction. */
export type ResolvedInstruction = {
  /** Final instruction, with the resolved accounts and resolution metadata. */
  instruction: TransactionInstruction
  /** Lookup tables returned by resolution, to compile the transaction with. */
  lookupTables: AddressLookupTableAccount[]
  /** Resolution metadata embedded in the instruction data. */
  metadata: Buffer
}

async function resolveInstruction(
  ctx: { connection: Connection } & WithLogger,
  {
    programId,
    discriminator,
    encodeArgs,
    ...opts
  }: {
    programId: PublicKey
    caller: PublicKey
    payer?: PublicKey
    extraAccounts?: readonly PublicKey[]
    discriminator: Buffer
    encodeArgs: (resolutionMetadata: Buffer) => Buffer
  },
): Promise<ResolvedInstruction> {
  patchBorsh()
  const resolved = await resolveAccounts(ctx, {
    ...opts,
    programId,
    ixData: Buffer.concat([discriminator, encodeArgs(Buffer.alloc(0))]),
  })
  const instruction = new TransactionInstruction({
    programId,
    keys: resolved.accounts,
    data: Buffer.concat([discriminator, encodeArgs(resolved.metadata)]),
  })
  const lookupTables = await fetchLookupTables(ctx.connection, resolved.lookupTables)
  return { instruction, lookupTables, metadata: resolved.metadata }
}

/**
 * Resolves the router's `get_fee_v2` instruction for a message. The instruction returns a
 * `GetFeeResultV2` when simulated.
 * @param ctx - Context with the Solana connection and logger.
 * @param opts - Router, destination selector, message sender and message; `payer` overrides
 *   the simulation fee payer when `sender` isn't funded.
 * @returns The resolved `get_fee_v2` instruction and its lookup tables.
 */
export function resolveGetFeeV2(
  ctx: { connection: Connection } & WithLogger,
  {
    router,
    destChainSelector,
    sender,
    message,
    payer,
  }: {
    router: PublicKey
    destChainSelector: bigint
    sender: PublicKey
    message: AnyMessage
    payer?: PublicKey
  },
): Promise<ResolvedInstruction> {
  const svmMessage = anyToSvmMessage(message)
  return resolveInstruction(ctx, {
    programId: router,
    caller: sender,
    payer,
    discriminator: GET_FEE_V2_DISCRIMINATOR,
    encodeArgs: (resolutionMetadata) =>
      routerV2Coder.types.encode('GetFeeParams', {
        destChainSelector: new BN(destChainSelector.toString()),
        sender,
        message: svmMessage,
        resolutionMetadata,
      }),
  })
}

/**
 * Resolves the router's `ccip_send_v2` instruction for a message.
 * @param ctx - Context with the Solana connection and logger.
 * @param opts - Router, destination selector, message and its sender (the signer).
 * @returns The resolved `ccip_send_v2` instruction and its lookup tables.
 */
export function resolveCcipSendV2(
  ctx: { connection: Connection } & WithLogger,
  {
    router,
    destChainSelector,
    sender,
    message,
  }: {
    router: PublicKey
    destChainSelector: bigint
    sender: PublicKey
    message: AnyMessage
  },
): Promise<ResolvedInstruction> {
  const svmMessage = anyToSvmMessage(message)
  return resolveInstruction(ctx, {
    programId: router,
    caller: sender,
    discriminator: CCIP_SEND_V2_DISCRIMINATOR,
    encodeArgs: (resolutionMetadata) =>
      routerV2Coder.types.encode('CcipSendV2Params', {
        destChainSelector: new BN(destChainSelector.toString()),
        message: svmMessage,
        resolutionMetadata,
      }),
  })
}

/** `execute_v2` inputs, as they'd go in the instruction (or in the execution buffer). */
export type ExecutionInputsV2 = {
  encodedMessage: BytesLike
  ccvs: readonly PublicKey[]
  verifierResults: readonly BytesLike[]
}

/**
 * Resolves the offramp's `execute_v2` instruction, either with the execution inputs inline or
 * reading them from a previously written execution buffer.
 * @param ctx - Context with the Solana connection and logger.
 * @param opts - Offramp, executing signer, and either `execInputs` or the `bufferId` the inputs
 *   were buffered under (by the same `caller`).
 * @returns The resolved `execute_v2` instruction and its lookup tables.
 */
export function resolveExecuteV2(
  ctx: { connection: Connection } & WithLogger,
  {
    offramp,
    caller,
    ...inputs
  }: { offramp: PublicKey; caller: PublicKey } & (
    | { execInputs: ExecutionInputsV2 }
    | { bufferId: BytesLike }
  ),
): Promise<ResolvedInstruction> {
  let execInputs = null
  const extraAccounts: PublicKey[] = []
  if ('execInputs' in inputs) {
    execInputs = {
      encodedMessage: bytesToBuffer(inputs.execInputs.encodedMessage),
      ccvs: inputs.execInputs.ccvs,
      verifierResults: inputs.execInputs.verifierResults.map((result) => bytesToBuffer(result)),
    }
  } else {
    // buffered execution: the start stage reads the inputs from the buffer
    const [buffer] = PublicKey.findProgramAddressSync(
      [Buffer.from('execution_report_buffer'), bytesToBuffer(inputs.bufferId), caller.toBuffer()],
      offramp,
    )
    extraAccounts.push(buffer)
  }
  return resolveInstruction(ctx, {
    programId: offramp,
    caller,
    extraAccounts,
    discriminator: EXECUTE_V2_DISCRIMINATOR,
    encodeArgs: (resolutionMetadata) =>
      offrampV2Coder.types.encode('ExecuteParams', { execInputs, resolutionMetadata }),
  })
}
