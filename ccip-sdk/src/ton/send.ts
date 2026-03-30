import { type Cell, beginCell, toNano } from '@ton/core'
import { type TonClient, Address } from '@ton/ton'
import { zeroPadValue } from 'ethers'

import type { UnsignedTONTx } from './types.ts'
import { CCIPError, CCIPErrorCode, CCIPExtraArgsInvalidError } from '../errors/index.ts'
import {
  type ExtraArgs,
  type SVMExtraArgsV1,
  EVMExtraArgsV2Tag,
  SVMExtraArgsV1Tag,
} from '../extra-args.ts'
import { type AnyMessage, type WithLogger, ChainFamily } from '../types.ts'
import { bigIntReplacer, bytesToBuffer, getAddressBytes } from '../utils.ts'

/** Opcode for Router ccipSend operation */
export const CCIP_SEND_OPCODE = 0x31768d95

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
 * Checks if extraArgs is SVMExtraArgsV1 format.
 */
function isSVMExtraArgs(extraArgs: ExtraArgs): extraArgs is SVMExtraArgsV1 {
  return 'computeUnits' in extraArgs
}

/**
 * Encodes extraArgs as a Cell.
 *
 * Supports two formats based on the destination chain:
 * - GenericExtraArgsV2 (EVMExtraArgsV2) for EVM/TON/Aptos destinations
 * - SVMExtraArgsV1 for Solana destinations
 *
 * @param extraArgs - Extra arguments for CCIP message
 * @returns Cell encoding the extra arguments
 * @throws {@link CCIPExtraArgsInvalidError} if extraArgs format is invalid
 */
export function encodeExtraArgsCell(extraArgs: ExtraArgs): Cell {
  if (isSVMExtraArgs(extraArgs)) {
    return encodeSVMExtraArgsCell(extraArgs)
  }
  return encodeEVMExtraArgsCell(extraArgs)
}

/**
 * Encodes extraArgs as a Cell using the GenericExtraArgsV2 (EVMExtraArgsV2) format.
 *
 * Format per chainlink-ton TL-B:
 * - tag: 32-bit opcode (0x181dcf10)
 * - gasLimit: Maybe<uint256> (1 bit flag + 256 bits if present)
 * - allowOutOfOrderExecution: 1 bit
 */
function encodeEVMExtraArgsCell(extraArgs: ExtraArgs): Cell {
  if (
    Object.keys(extraArgs).filter((k) => k !== '_tag').length !== 2 ||
    !('gasLimit' in extraArgs && 'allowOutOfOrderExecution' in extraArgs)
  )
    throw new CCIPExtraArgsInvalidError(ChainFamily.TON, JSON.stringify(extraArgs, bigIntReplacer))

  let gasLimit: bigint | null = null
  if (extraArgs.gasLimit > 0n) {
    gasLimit = extraArgs.gasLimit
  }

  const builder = beginCell().storeUint(Number(EVMExtraArgsV2Tag), 32) // 0x181dcf10
  builder.storeMaybeUint(gasLimit, 256)
  builder.storeBit(extraArgs.allowOutOfOrderExecution)

  return builder.endCell()
}

/**
 * Encodes extraArgs as a Cell using the SVMExtraArgsV1 format.
 *
 * Format per chainlink-ton TL-B:
 * - tag: 32-bit opcode (0x1f3b3aba)
 * - computeUnits: uint32
 * - accountIsWritableBitmap: uint64
 * - allowOutOfOrderExecution: bool
 * - tokenReceiver: uint256
 * - accounts: SnakedCell<uint256>
 */
function addressToUint256(addr: string): bigint {
  const bytes = getAddressBytes(addr)
  // zeroPadValue returns a hex string, use it directly
  const hex =
    bytes.length <= 32 ? zeroPadValue(bytes, 32) : '0x' + Buffer.from(bytes).toString('hex')
  return BigInt(hex)
}

function encodeSVMExtraArgsCell(extraArgs: SVMExtraArgsV1): Cell {
  // Encode accounts as a snaked cell of uint256 values
  let accountsCell = beginCell().endCell()
  if (extraArgs.accounts.length > 0) {
    const accountBuilder = beginCell()
    for (const account of extraArgs.accounts) {
      accountBuilder.storeUint(addressToUint256(account), 256)
    }
    accountsCell = accountBuilder.endCell()
  }

  // Encode tokenReceiver as uint256
  const tokenReceiver = extraArgs.tokenReceiver ? addressToUint256(extraArgs.tokenReceiver) : 0n

  const builder = beginCell()
    .storeUint(Number(SVMExtraArgsV1Tag), 32) // 0x1f3b3aba
    .storeUint(Number(extraArgs.computeUnits), 32)
    .storeUint(Number(extraArgs.accountIsWritableBitmap), 64)
    .storeBit(extraArgs.allowOutOfOrderExecution)
    .storeUint(tokenReceiver, 256) // uint256
    .storeRef(accountsCell) // SnakedCell<uint256>

  return builder.endCell()
}

/**
 * Builds the Router ccipSend message cell.
 *
 * Relies on TL-B structure (Router_CCIPSend) from chainlink-ton repo.
 *
 * @param destChainSelector - Destination chain selector
 * @param message - CCIP message containing receiver, data, tokenAmounts, and extraArgs
 * @param feeTokenAddress - Fee token jetton address, or null for native TON
 * @param queryId - TON query ID for the message (default: 0)
 * @returns Cell containing the encoded Router ccipSend message
 */
export function buildCcipSendCell(
  destChainSelector: bigint,
  message: AnyMessage,
  feeTokenAddress: Address | null = null,
  queryId = 0n,
): Cell {
  // Get receiver bytes — use getAddressBytes to handle hex, base58 (Solana), TON raw formats
  const receiverBytes = getAddressBytes(message.receiver)
  const paddedReceiver = bytesToBuffer(
    receiverBytes.length <= 32 ? zeroPadValue(receiverBytes, 32) : receiverBytes,
  )

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
  const feeReceiverBytes = getAddressBytes(message.receiver)
  const paddedFeeReceiver = bytesToBuffer(
    feeReceiverBytes.length <= 32 ? zeroPadValue(feeReceiverBytes, 32) : feeReceiverBytes,
  )
  const receiverSlice = beginCell().storeBuffer(paddedFeeReceiver).endCell()
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
