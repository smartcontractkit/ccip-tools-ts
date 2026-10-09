import { Buffer } from 'buffer'

import {
  type AccountMeta,
  type AddressLookupTableAccount,
  type Connection,
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import type BN from 'bn.js'
import { hexlify, keccak256 } from 'ethers'

import { CCIPError } from '../errors/CCIPError.ts'
import { CCIPErrorCode } from '../errors/codes.ts'
import {
  CCIPSolanaExecutionBufferIncompleteError,
  CCIPTransactionTooLargeError,
} from '../errors/index.ts'
import { ChainFamily } from '../networks.ts'
import type {
  CCIPMessage,
  CCIPVersion,
  ExecutionInput,
  VerificationPolicy,
  WithLogger,
} from '../types.ts'
import { bytesToBuffer, getAddressBytes, getDataBytes } from '../utils.ts'
import { sighash, sizedCoder } from './coder.ts'
import { buildLookupTableIxs } from './exec.ts'
import { IDL as CCIP_OFFRAMP_V2_IDL } from './idl/2.0.0/CCIP_OFFRAMP.ts'
import {
  type ExecutionInputsV2,
  MAX_HEAP_FRAME_BYTES,
  resolveExecuteV2,
  resolveGetCcvsForMsg,
} from './resolution.ts'
import type { UnsignedSolanaTx, Wallet } from './types.ts'
import {
  SIMULATION_PAYER,
  getExecutionInputsBufferPda,
  isTransactionTooLargeError,
  simulateAndSendTxs,
  simulateTransaction,
} from './utils.ts'

/*
 * CCIP 2.0 execution path.
 *
 * `execute_v2` is permissionless: whoever signs it pays for it, and is the `caller` its accounts
 * are resolved for. Its inputs (the encoded message, and a verifier result per CCV) go either
 * inline in the instruction, or, when they don't fit a transaction, in an execution inputs buffer
 * written beforehand. Buffered inputs are read by account resolution too, so, unlike CCIP 1.6's,
 * the buffer must be on-chain before the final instruction can be built.
 */

const offrampV2Coder = sizedCoder(CCIP_OFFRAMP_V2_IDL)

/** Discriminator of the offramp's `buffer_execution_inputs`. */
export const BUFFER_EXECUTION_INPUTS_DISCRIMINATOR = sighash('global', 'buffer_execution_inputs')
/** Discriminator of the offramp's `close_execution_inputs_buffer`. */
export const CLOSE_EXECUTION_INPUTS_BUFFER_DISCRIMINATOR = sighash(
  'global',
  'close_execution_inputs_buffer',
)

// Fits a `buffer_execution_inputs` in a v0 transaction with room to spare
const BUFFER_CHUNK_SIZE = 800
// The offramp tracks a buffer's chunks in a u64 bitmap
const MAX_BUFFER_CHUNKS = 64

/** Execution input of a CCIP 2.0 message. */
export type ExecutionInputV2 = ExecutionInput<CCIPMessage<typeof CCIPVersion.V2_0>>

type ExecutionInputsBuffer = {
  bufferId: number[]
  authority: PublicKey
  chunkBitmap: BN
  numChunks: number
  chunkLength: number
  data: Buffer
}

function requestHeapFrameIx(): TransactionInstruction {
  return ComputeBudgetProgram.requestHeapFrame({ bytes: MAX_HEAP_FRAME_BYTES })
}

/**
 * Converts an execution input to the `execute_v2` inputs: one CCV per verification, paired with
 * its verifier result.
 * @param input - Encoded message and verifications, as in `ExecutionInput`.
 * @returns The `ExecutionInputsV2`.
 */
export function toExecutionInputsV2(input: ExecutionInputV2): ExecutionInputsV2 {
  return {
    encodedMessage: input.encodedMessage,
    // sources may report the CCV program in hex instead of base58
    ccvs: input.verifications.map(({ destAddress }) => new PublicKey(getAddressBytes(destAddress))),
    verifierResults: input.verifications.map(({ ccvData }) => ccvData),
  }
}

// The message ID makes an arbitrary but easy to track buffer ID
function executionInputsBufferId(input: ExecutionInputV2): Buffer {
  return bytesToBuffer(keccak256(getDataBytes(input.encodedMessage)))
}

/**
 * Reads a message's CCV policy from the offramp, simulating its resolved `get_ccvs_for_msg` view.
 * @param ctx - Context with the Solana connection and logger.
 * @param offramp - Offramp program.
 * @param encodedMessage - MessageV1-encoded message.
 * @returns The CCVs `execute_v2` will require verifier results from.
 */
export async function getVerificationPolicyV2(
  ctx: { connection: Connection } & WithLogger,
  offramp: PublicKey,
  encodedMessage: string,
): Promise<VerificationPolicy> {
  const { instruction, lookupTables } = await resolveGetCcvsForMsg(ctx, {
    offramp,
    encodedMessage,
  })
  const simResult = await simulateTransaction(ctx, {
    payerKey: SIMULATION_PAYER,
    instructions: [requestHeapFrameIx(), instruction],
    addressLookupTableAccounts: lookupTables,
  })
  const returnData = simResult.returnData
  if (!returnData?.data[0] || returnData.programId !== offramp.toBase58()) {
    throw new CCIPError(
      CCIPErrorCode.SOLANA_SIMULATION_NO_RETURN_DATA,
      'No return data from get_ccvs_for_msg simulation',
      { context: { offramp: offramp.toBase58() } },
    )
  }
  const { requiredCcvs, optionalCcvs, optionalThreshold } = offrampV2Coder.types.decode<{
    requiredCcvs: PublicKey[]
    optionalCcvs: PublicKey[]
    optionalThreshold: number
  }>('GetCcvsForMsgResponse', bytesToBuffer(returnData.data[0]))
  return {
    requiredCCVs: requiredCcvs.map((ccv) => ccv.toBase58()),
    optionalCCVs: optionalCcvs.map((ccv) => ccv.toBase58()),
    optionalThreshold,
  }
}

// The resolved `execute_v2` after its heap frame request, which must share its transaction; with
// `forceLookupTable`, sandwiched between the creation and deactivation of a lookup table with its
// accounts, like CCIP 1.6's `manuallyExecute`
async function wrapExecuteV2Ix(
  ctx: { connection: Connection } & WithLogger,
  caller: PublicKey,
  instruction: TransactionInstruction,
  lookupTables: AddressLookupTableAccount[],
  { forceLookupTable }: { forceLookupTable?: boolean } = {},
): Promise<UnsignedSolanaTx> {
  const instructions = [requestHeapFrameIx(), instruction]
  let mainIndex = 1
  if (forceLookupTable) {
    const alt = await buildLookupTableIxs(
      ctx,
      caller,
      instruction.keys.map(({ pubkey }) => pubkey),
    )
    instructions.unshift(...alt.initialIxs)
    mainIndex += alt.initialIxs.length
    instructions.push(...alt.finalIxs)
    lookupTables = [...lookupTables, alt.lookupTable]
  }
  return { family: ChainFamily.Solana, instructions, lookupTables, mainIndex }
}

// Accounts of `buffer_execution_inputs` and `close_execution_inputs_buffer`, the last two for
// their CPI events
function bufferingAccounts(
  offramp: PublicKey,
  caller: PublicKey,
  buffer: PublicKey,
): AccountMeta[] {
  const pda = (seed: string) => PublicKey.findProgramAddressSync([Buffer.from(seed)], offramp)[0]
  return [
    { pubkey: buffer, isSigner: false, isWritable: true },
    { pubkey: pda('config'), isSigner: false, isWritable: false },
    { pubkey: caller, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: pda('__event_authority'), isSigner: false, isWritable: false },
    { pubkey: offramp, isSigner: false, isWritable: false },
  ]
}

/**
 * Builds the instruction closing an execution inputs buffer, refunding its rent to `caller`.
 * @param offramp - Offramp program.
 * @param caller - Account that wrote the buffer.
 * @param bufferId - ID the inputs were buffered under.
 * @returns The `close_execution_inputs_buffer` instruction.
 */
export function closeExecutionInputsBufferIx(
  offramp: PublicKey,
  caller: PublicKey,
  bufferId: Buffer,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: offramp,
    keys: bufferingAccounts(
      offramp,
      caller,
      getExecutionInputsBufferPda(offramp, bufferId, caller),
    ),
    data: Buffer.concat([
      CLOSE_EXECUTION_INPUTS_BUFFER_DISCRIMINATOR,
      offrampV2Coder.types.encode('CloseExecutionInputsBufferParams', {
        bufferId: Array.from(bufferId),
      }),
    ]),
  })
}

/**
 * Builds the instructions writing execution inputs to their buffer, in chunks. Picks up where an
 * earlier attempt left the buffer: chunks it already holds are skipped, and a buffer holding other
 * inputs is closed first.
 * @param ctx - Context with the Solana connection, to read the buffer's current state, and logger.
 * @param opts - Offramp, account that will sign `execute_v2`, buffer ID and execution inputs.
 * @returns The instructions, in order; empty if the buffer already holds the inputs
 * @throws {@link CCIPTransactionTooLargeError} if the inputs exceed the buffer's capacity
 */
export async function bufferExecutionInputsIxs(
  ctx: { connection: Connection } & WithLogger,
  {
    offramp,
    caller,
    bufferId,
    inputs,
  }: { offramp: PublicKey; caller: PublicKey; bufferId: Buffer; inputs: ExecutionInputsV2 },
): Promise<TransactionInstruction[]> {
  const serialized = offrampV2Coder.types.encode('ExecutionInputsV2', {
    encodedMessage: bytesToBuffer(inputs.encodedMessage),
    ccvs: inputs.ccvs,
    verifierResults: inputs.verifierResults.map((result) => bytesToBuffer(result)),
  })
  const numChunks = Math.ceil(serialized.length / BUFFER_CHUNK_SIZE)
  if (numChunks > MAX_BUFFER_CHUNKS) {
    throw new CCIPTransactionTooLargeError(
      `Execution inputs of ${serialized.length} bytes exceed the offramp buffer's ${MAX_BUFFER_CHUNKS} chunks of ${BUFFER_CHUNK_SIZE} bytes`,
    )
  }
  const chunk = (index: number) =>
    serialized.subarray(index * BUFFER_CHUNK_SIZE, (index + 1) * BUFFER_CHUNK_SIZE)
  const buffer = getExecutionInputsBufferPda(offramp, bufferId, caller)
  const keys = bufferingAccounts(offramp, caller, buffer)

  const instructions: TransactionInstruction[] = []
  let filled = 0n // bitmap of the chunks already in the buffer
  const account = await ctx.connection.getAccountInfo(buffer)
  if (account) {
    const existing = offrampV2Coder.accounts.decode<ExecutionInputsBuffer>('buffer', account.data)
    const bitmap = BigInt(existing.chunkBitmap.toString())
    const resumable =
      existing.data.length === serialized.length &&
      existing.numChunks === numChunks &&
      existing.chunkLength === chunk(0).length &&
      Array.from({ length: numChunks }).every(
        (_, i) =>
          !(bitmap & (1n << BigInt(i))) ||
          existing.data
            .subarray(i * BUFFER_CHUNK_SIZE, (i + 1) * BUFFER_CHUNK_SIZE)
            .equals(chunk(i)),
      )
    if (resumable) filled = bitmap
    else instructions.push(closeExecutionInputsBufferIx(offramp, caller, bufferId))
  }

  for (let i = 0; i < numChunks; i++) {
    if (filled & (1n << BigInt(i))) continue
    instructions.push(
      new TransactionInstruction({
        programId: offramp,
        keys,
        data: Buffer.concat([
          BUFFER_EXECUTION_INPUTS_DISCRIMINATOR,
          offrampV2Coder.types.encode('BufferExecutionInputsParams', {
            bufferId: Array.from(bufferId),
            totalLength: serialized.length,
            chunk: chunk(i),
            chunkIndex: i,
            numChunks,
          }),
        ]),
      }),
    )
  }
  return instructions
}

/**
 * Generates the unsigned instructions writing a CCIP 2.0 message's execution inputs to their
 * buffer, under the message ID, for an external signer to send ahead of
 * {@link generateUnsignedExecuteV2}, which resolves `execute_v2` from the complete buffer. Each
 * instruction carries a chunk of up to 800 bytes, so needs its own v0 transaction.
 * @param ctx - Context with the Solana connection, to read the buffer's current state, and logger.
 * @param caller - Account that will sign and pay for the buffering and `execute_v2`.
 * @param offramp - Offramp program.
 * @param input - Encoded message and verifications.
 * @returns Solana unsigned txs, without `mainIndex`; no instructions if the buffer already holds
 *   the inputs
 * @throws {@link CCIPTransactionTooLargeError} if the inputs exceed the buffer's capacity
 */
export async function generateUnsignedExecuteBufferV2(
  ctx: { connection: Connection } & WithLogger,
  caller: PublicKey,
  offramp: PublicKey,
  input: ExecutionInputV2,
): Promise<UnsignedSolanaTx> {
  const instructions = await bufferExecutionInputsIxs(ctx, {
    offramp,
    caller,
    bufferId: executionInputsBufferId(input),
    inputs: toExecutionInputsV2(input),
  })
  return { family: ChainFamily.Solana, instructions }
}

// `execute_v2` resolved from a complete execution inputs buffer
async function resolveBufferedExecuteV2(
  ctx: { connection: Connection } & WithLogger,
  caller: PublicKey,
  offramp: PublicKey,
  bufferId: Buffer,
  opts?: { forceLookupTable?: boolean },
): Promise<UnsignedSolanaTx> {
  const { instruction, lookupTables } = await resolveExecuteV2(ctx, { offramp, caller, bufferId })
  return wrapExecuteV2Ix(ctx, caller, instruction, lookupTables, opts)
}

/**
 * Generates unsigned instructions to execute a CCIP 2.0 message: a heap frame request and the
 * resolved `execute_v2`, which must share a transaction. If `caller`'s execution inputs buffer for
 * the message is complete (see {@link generateUnsignedExecuteBufferV2}), `execute_v2` reads the
 * inputs from it, and closes it; otherwise, they go inline.
 * @param ctx - Context with the Solana connection and logger.
 * @param caller - Account that will sign and pay for `execute_v2`.
 * @param offramp - Offramp program.
 * @param input - Encoded message and verifications.
 * @param opts - `forceBuffer` requires the inputs to come from the buffer; `forceLookupTable`
 *   creates (before) and deactivates (after) a lookup table with `execute_v2`'s accounts.
 * @returns Solana unsigned txs; `mainIndex` points at `execute_v2`
 * @throws {@link CCIPSolanaExecutionBufferIncompleteError} with `forceBuffer`, if the buffer isn't
 *   complete: `execute_v2`'s accounts can only be resolved from a complete buffer
 * @throws {@link CCIPTransactionTooLargeError} if the inputs are too large to resolve inline
 */
export async function generateUnsignedExecuteV2(
  ctx: { connection: Connection } & WithLogger,
  caller: PublicKey,
  offramp: PublicKey,
  input: ExecutionInputV2,
  { forceBuffer, forceLookupTable }: { forceBuffer?: boolean; forceLookupTable?: boolean } = {},
): Promise<UnsignedSolanaTx> {
  const bufferId = executionInputsBufferId(input)
  const inputs = toExecutionInputsV2(input)
  let pending
  try {
    pending = await bufferExecutionInputsIxs(ctx, { offramp, caller, bufferId, inputs })
  } catch (err) {
    // inputs beyond the buffer's capacity can only go inline
    if (forceBuffer || !(err instanceof CCIPTransactionTooLargeError)) throw err
  }
  if (pending && !pending.length) {
    return resolveBufferedExecuteV2(ctx, caller, offramp, bufferId, { forceLookupTable })
  }
  if (pending && forceBuffer) {
    const stale = !!pending[0]?.data
      .subarray(0, CLOSE_EXECUTION_INPUTS_BUFFER_DISCRIMINATOR.length)
      .equals(CLOSE_EXECUTION_INPUTS_BUFFER_DISCRIMINATOR)
    throw new CCIPSolanaExecutionBufferIncompleteError({
      buffer: getExecutionInputsBufferPda(offramp, bufferId, caller).toBase58(),
      bufferId: hexlify(bufferId),
      missingChunks: pending.length - (stale ? 1 : 0),
      stale,
    })
  }

  let resolved
  try {
    resolved = await resolveExecuteV2(ctx, { offramp, caller, execInputs: inputs })
  } catch (err) {
    if (!isTransactionTooLargeError(err)) throw err
    throw new CCIPTransactionTooLargeError(
      'Execution inputs too large to execute inline: buffer them first, with the instructions of SolanaChain.generateUnsignedExecuteBuffer, then generate the execution with forceBuffer',
      {
        cause: err instanceof Error ? err : undefined,
        context: err instanceof CCIPError ? err.context : undefined,
      },
    )
  }
  return wrapExecuteV2Ix(ctx, caller, resolved.instruction, resolved.lookupTables, {
    forceLookupTable,
  })
}

/**
 * Executes a CCIP 2.0 message, signed and paid for by `wallet`. The execution inputs go inline if
 * they fit a transaction; otherwise they are first written to an execution inputs buffer, under
 * the message ID, which `execute_v2` closes upon success. A lookup table with `execute_v2`'s
 * accounts is the last resort.
 *
 * Not atomic: the buffering transactions are confirmed before `execute_v2` is resolved against
 * the buffer, so a failed execution leaves the buffer behind, for a retry to reuse it (or
 * `SolanaChain.cleanUpBuffers` to recover its rent). A complete buffer is executed from directly.
 * @param ctx - Context with the Solana connection and logger.
 * @param wallet - Wallet signing and paying for the transactions.
 * @param opts - Offramp, encoded message and verifications, and options:
 *   - `forceBuffer` - buffer the execution inputs, even if they'd fit inline;
 *   - `forceLookupTable` - create a lookup table with `execute_v2`'s accounts;
 *   - `computeUnits` - compute-unit limit of the `execute_v2` transaction (simulated if unset).
 * @returns Signature of the `execute_v2` transaction
 */
export async function executeV2(
  ctx: { connection: Connection } & WithLogger,
  wallet: Wallet,
  {
    offramp,
    input,
    forceBuffer,
    forceLookupTable,
    computeUnits,
  }: {
    offramp: PublicKey
    input: ExecutionInputV2
    forceBuffer?: boolean
    forceLookupTable?: boolean
    computeUnits?: number
  },
): Promise<string> {
  const { logger = console } = ctx
  const caller = wallet.publicKey
  for (;;) {
    try {
      let unsigned
      if (!forceBuffer) {
        // picks up a complete buffer left by an earlier attempt, if any
        unsigned = await generateUnsignedExecuteV2(ctx, caller, offramp, input, {
          forceLookupTable,
        })
      } else {
        const bufferId = executionInputsBufferId(input)
        const buffering = await generateUnsignedExecuteBufferV2(ctx, caller, offramp, input)
        if (buffering.instructions.length) {
          logger.info(
            `Execution inputs will be pre-buffered through the offramp, under bufferId ${hexlify(bufferId)} at ${getExecutionInputsBufferPda(offramp, bufferId, caller).toBase58()}. This may take some time; if aborted, cleanUpBuffers recovers the rent it locks.`,
          )
          await simulateAndSendTxs(ctx, wallet, buffering)
        }
        // resolved straight from the buffer just written, without reading it back
        unsigned = await resolveBufferedExecuteV2(ctx, caller, offramp, bufferId, {
          forceLookupTable,
        })
      }
      return (await simulateAndSendTxs(ctx, wallet, unsigned, { computeUnits })).hash
    } catch (err) {
      if (!isTransactionTooLargeError(err)) throw err
      // buffer first, as the buffer gets closed upon execution, then lookup tables, which need a
      // grace period (~513 slots) after deactivation before they can be closed
      if (!forceBuffer) forceBuffer = true
      else if (!forceLookupTable) forceLookupTable = true
      else throw err
      logger.debug('Execution too large, retrying with', { forceBuffer, forceLookupTable })
    }
  }
}
