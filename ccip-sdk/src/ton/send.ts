import { type Cell, beginCell, toNano } from '@ton/core'
import { type TonClient, Address } from '@ton/ton'
import { getBytes } from 'ethers'

import type { UnsignedTONTx } from './types.ts'
import { CCIPError, CCIPErrorCode } from '../errors/index.ts'
import { EVMExtraArgsV2Tag } from '../extra-args.ts'
import type { AnyMessage, WithLogger } from '../types.ts'
import { bytesToBuffer, getDataBytes } from '../utils.ts'

/** Opcode for Router ccipSend operation */
// TODO: new env deployment changes opcode to 0x31768d95, we'll need to update once live.
export const CCIP_SEND_OPCODE = 0x38a69e3b

/** Default gas buffer to add to fee for transaction execution */
export const DEFAULT_GAS_BUFFER = toNano('0.5')

/** Default gas limit for destination chain execution */
export const DEFAULT_GAS_LIMIT = 200_000n

/**
 * WRAPPED_NATIVE address for TON - sentinel address representing native TON.
 * Used as feeToken for native TON payments in FeeQuoter calls.
 */
export const WRAPPED_NATIVE = Address.parse(
  '0:0000000000000000000000000000000000000000000000000000000000000001',
)

/**
 * Pads an address buffer to 32 bytes (left-padded with zeros).
 * EVM addresses are 20 bytes, but CCIP cross-chain encoding uses 32 bytes.
 */
function padAddressTo32Bytes(addressBytes: Buffer): Buffer {
  if (addressBytes.length >= 32) {
    return addressBytes.subarray(0, 32)
  }
  const padded = Buffer.alloc(32)
  addressBytes.copy(padded, 32 - addressBytes.length) // right-align (left-pad with zeros)
  return padded
}

/**
 * Encodes token amounts as a snaked cell.
 * Empty cell for no tokens.
 */
function encodeTokenAmounts(
  tokenAmounts: readonly { token: string; amount: bigint }[] | undefined,
): Cell {
  if (!tokenAmounts || tokenAmounts.length === 0) {
    return beginCell().endCell()
  }

  const builder = beginCell()
  for (const ta of tokenAmounts) {
    builder.storeRef(
      beginCell().storeAddress(Address.parse(ta.token)).storeUint(ta.amount, 256).endCell(),
    )
  }
  return builder.endCell()
}

/**
 * Encodes extraArgs as a Cell using the GenericExtraArgsV2 (EVMExtraArgsV2) format.
 *
 * Format per chainlink-ton TL-B:
 * - tag: 32-bit opcode (0x181dcf10)
 * - gasLimit: Maybe<uint256> (1 bit flag + 256 bits if present)
 * - allowOutOfOrderExecution: 1 bit (must be true)
 */
function encodeExtraArgsCell(extraArgs: AnyMessage['extraArgs']): Cell {
  const allowOutOfOrderExecution = true

  let gasLimit = 0n
  let hasGasLimit = false

  if ('gasLimit' in extraArgs && extraArgs.gasLimit > 0n) {
    hasGasLimit = true
    gasLimit = extraArgs.gasLimit
  }

  const builder = beginCell()
    .storeUint(Number(EVMExtraArgsV2Tag), 32) // 0x181dcf10
    .storeBit(hasGasLimit)

  if (hasGasLimit) {
    builder.storeUint(gasLimit, 256)
  }

  return builder.storeBit(allowOutOfOrderExecution).endCell()
}

/**
 * Builds the Router ccipSend message cell.
 *
 * Relies on TL-B structure (Router_CCIPSend) from chainlink-ton repo.
 */
export function buildCcipSendCell(
  destChainSelector: bigint,
  message: AnyMessage,
  feeTokenAddress: Address | null = null,
  queryId = 0n,
): Cell {
  // Get receiver bytes and pad to 32 bytes for cross-chain encoding
  const receiverBytes = Buffer.from(getBytes(getDataBytes(message.receiver)))
  const paddedReceiver = padAddressTo32Bytes(receiverBytes)

  // Data cell (ref 0)
  const dataCell = beginCell()
    .storeBuffer(bytesToBuffer(message.data || '0x'))
    .endCell()

  // Token amounts snaked cell (ref 1)
  const tokenAmountsCell = encodeTokenAmounts(message.tokenAmounts)

  // ExtraArgs cell (ref 2)
  const extraArgsCell = encodeExtraArgsCell(message.extraArgs)

  return beginCell()
    .storeUint(CCIP_SEND_OPCODE, 32) // opcode
    .storeUint(Number(queryId), 64) // queryID
    .storeUint(destChainSelector, 64) // destChainSelector
    .storeUint(paddedReceiver.length, 8) // receiver length in bytes
    .storeBuffer(paddedReceiver) // receiver bytes (32 bytes, left-padded)
    .storeRef(dataCell) // ref 0: data
    .storeRef(tokenAmountsCell) // ref 1: tokenAmounts
    .storeAddress(feeTokenAddress) // null = addr_none for native TON
    .storeRef(extraArgsCell) // ref 2: extraArgs
    .endCell()
}

/**
 * Gets the fee for sending a CCIP message by calling FeeQuoter.validatedFee.
 *
 * @param ctx - Context with TonClient provider and logger
 * @param router - Router contract address
 * @param destChainSelector - Destination chain selector
 * @param message - CCIP message to quote
 * @returns Fee amount in nanotons
 */
export async function getFee(
  ctx: { provider: TonClient } & WithLogger,
  router: string,
  destChainSelector: bigint,
  message: AnyMessage,
): Promise<bigint> {
  const { provider, logger = console } = ctx
  const routerAddress = Address.parse(router)

  // FeeQuoter requires WRAPPED_NATIVE for native TON
  const feeTokenAddress = message.feeToken ? Address.parse(message.feeToken) : WRAPPED_NATIVE

  // Get FeeQuoter address via OnRamp
  let feeQuoterAddress: Address
  try {
    const { stack: onRampStack } = await provider.runMethod(routerAddress, 'onRamp', [
      { type: 'int', value: destChainSelector },
    ])
    const onRampAddress = onRampStack.readAddress()
    logger.debug('OnRamp:', onRampAddress.toString())

    const { stack: feeQuoterStack } = await provider.runMethod(onRampAddress, 'feeQuoter', [
      { type: 'int', value: destChainSelector },
    ])
    feeQuoterAddress = feeQuoterStack.readAddress()
    logger.debug('FeeQuoter:', feeQuoterAddress.toString())
  } catch (e) {
    throw new CCIPError(
      CCIPErrorCode.CONTRACT_TYPE_INVALID,
      `Could not get FeeQuoter address: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  // Build stack parameters for validatedFee call
  const receiverBytes = Buffer.from(getBytes(getDataBytes(message.receiver)))
  const paddedReceiver = padAddressTo32Bytes(receiverBytes)
  const receiverSlice = beginCell().storeBuffer(paddedReceiver).endCell()
  const dataCell = beginCell()
    .storeBuffer(bytesToBuffer(message.data || '0x'))
    .endCell()
  const tokenAmountsCell = encodeTokenAmounts(message.tokenAmounts)
  const extraArgsCell = encodeExtraArgsCell(message.extraArgs)
  const feeTokenSlice = beginCell().storeAddress(feeTokenAddress).endCell()

  const { stack: feeStack } = await provider.runMethod(feeQuoterAddress, 'validatedFee', [
    { type: 'int', value: 0n },
    { type: 'int', value: destChainSelector },
    { type: 'slice', cell: receiverSlice },
    { type: 'cell', cell: dataCell },
    { type: 'cell', cell: tokenAmountsCell },
    { type: 'slice', cell: feeTokenSlice },
    { type: 'cell', cell: extraArgsCell },
  ])

  const fee = feeStack.readBigNumber()
  if (fee < 0n) {
    throw new CCIPError(CCIPErrorCode.MESSAGE_INVALID, `Invalid fee: ${fee}`)
  }
  logger.debug('CCIP fee:', fee.toString(), 'nanotons')
  return fee
}

/**
 * Generates an unsigned CCIP send transaction for the Router.
 *
 * @param ctx - Context with TonClient provider and logger
 * @param _sender - Sender address (unused, for interface compatibility)
 * @param router - Router contract address
 * @param destChainSelector - Destination chain selector
 * @param message - CCIP message with fee included
 * @param opts - Optional gas buffer override
 * @returns Unsigned transaction ready for signing
 */
export function generateUnsignedCcipSend(
  ctx: { provider: TonClient } & WithLogger,
  _sender: string,
  router: string,
  destChainSelector: bigint,
  message: AnyMessage & { fee: bigint },
  opts?: { gasBuffer?: bigint },
): Omit<UnsignedTONTx, 'family'> {
  const { logger = console } = ctx
  const gasBuffer = opts?.gasBuffer ?? DEFAULT_GAS_BUFFER

  // Router accepts addr_none for native TON (unlike FeeQuoter which needs WRAPPED_NATIVE)
  const feeTokenAddress = message.feeToken ? Address.parse(message.feeToken) : null

  const ccipSendCell = buildCcipSendCell(destChainSelector, message, feeTokenAddress)
  const totalValue = message.fee + gasBuffer

  logger.debug('Generating ccipSend tx to router:', router)
  logger.debug('Total value:', totalValue.toString(), 'nanotons')

  return {
    to: router,
    body: ccipSendCell,
    value: totalValue,
  }
}
