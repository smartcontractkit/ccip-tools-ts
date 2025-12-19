import { type Builder, Address, Cell, beginCell } from '@ton/core'
import type { KeyPair } from '@ton/crypto'
import type { WalletContractV4 } from '@ton/ton'
import { toBigInt } from 'ethers'

import { CCIPDataFormatUnsupportedError } from '../errors/specialized.ts'
import type { EVMExtraArgsV2 } from '../extra-args.ts'
import type { CCIPMessage_V1_6, ChainFamily, ExecutionReport } from '../types.ts'
import { bytesToBuffer } from '../utils.ts'

/** TON-specific CCIP v1.6 message type with EVMExtraArgsV2 (GenericExtraArgsV2) */
export type CCIPMessage_V1_6_TON = CCIPMessage_V1_6 & EVMExtraArgsV2

/** Opcode for OffRamp_ManuallyExecute message on TON */
export const MANUALLY_EXECUTE_OPCODE = 0xa00785cf

/**
 * TON wallet with keypair for signing transactions
 */
export interface TONWallet {
  contract: WalletContractV4
  keyPair: KeyPair
}

/**
 * Unsigned TON transaction data.
 * Contains the payload needed to construct a transaction.
 * Value is determined at execution time, not included here.
 */
export type UnsignedTONTx = {
  family: typeof ChainFamily.TON
  /** Target contract address */
  to: string
  /** Message payload as BOC-serialized Cell */
  body: Cell
}

/** Typeguard for TON Wallet */
export function isTONWallet(wallet: unknown): wallet is TONWallet {
  return (
    typeof wallet === 'object' &&
    wallet !== null &&
    'contract' in wallet &&
    'keyPair' in wallet &&
    typeof wallet.contract === 'object' &&
    wallet.contract !== null &&
    'address' in wallet.contract &&
    typeof wallet.keyPair === 'object' &&
    wallet.keyPair !== null &&
    'secretKey' in wallet.keyPair
  )
}

// asSnakeData helper for encoding variable-length arrays
function asSnakeData<T>(array: T[], builderFn: (item: T) => Builder): Cell {
  const cells: Builder[] = []
  let builder = beginCell()

  for (const value of array) {
    const itemBuilder = builderFn(value)
    if (itemBuilder.refs > 3) {
      throw new CCIPDataFormatUnsupportedError(
        'Cannot pack more than 3 refs per item; store it in a separate ref cell.',
      )
    }
    if (builder.availableBits < itemBuilder.bits || builder.availableRefs <= 1) {
      cells.push(builder)
      builder = beginCell()
    }
    builder.storeBuilder(itemBuilder)
  }
  cells.push(builder)

  // Build the linked structure from the end
  let current = cells[cells.length - 1].endCell()
  for (let i = cells.length - 2; i >= 0; i--) {
    const b = cells[i]
    b.storeRef(current)
    current = b.endCell()
  }
  return current
}

/**
 * Serializes an execution report into a TON Cell for OffRamp execution.
 * @param execReport - Execution report containing message, proofs, and proof flag bits.
 * @returns BOC-serialized Cell containing the execution report.
 */
export function serializeExecutionReport(
  execReport: ExecutionReport<CCIPMessage_V1_6_TON>,
): Builder {
  return beginCell()
    .storeUint(execReport.message.sourceChainSelector, 64)
    .storeRef(asSnakeData([execReport.message], serializeMessage))
    .storeRef(Cell.EMPTY) // TODO: FIXME: offchainTokenData empty for now, add when implemented
    .storeRef(
      asSnakeData(execReport.proofs.map(toBigInt), (proof: bigint) => {
        return beginCell().storeUint(proof, 256)
      }),
    )
    .storeUint(execReport.proofFlagBits, 256)
}

function serializeMessage(message: CCIPMessage_V1_6_TON): Builder {
  return beginCell()
    .storeUint(BigInt(message.messageId), 256)
    .storeUint(message.sourceChainSelector, 64)
    .storeUint(message.destChainSelector, 64)
    .storeUint(message.sequenceNumber, 64)
    .storeUint(message.nonce, 64)
    .storeRef(
      beginCell()
        .storeUint(bytesToBuffer(message.sender).length, 8)
        .storeBuffer(bytesToBuffer(message.sender))
        .endCell(),
    )
    .storeRef(beginCell().storeBuffer(bytesToBuffer(message.data)).endCell())
    .storeAddress(Address.parse(message.receiver))
    .storeCoins(message.gasLimit)
    .storeMaybeRef(
      message.tokenAmounts?.length > 0 ? serializeTokenAmounts(message.tokenAmounts) : null,
    )
}

function serializeTokenAmounts(tokenAmounts: CCIPMessage_V1_6['tokenAmounts']): Cell {
  const builder = beginCell()
  for (const ta of tokenAmounts) {
    builder.storeRef(
      beginCell()
        .storeRef(serializeSourcePool(ta.sourcePoolAddress))
        .storeAddress(Address.parse(ta.destTokenAddress))
        .storeUint(BigInt(ta.amount), 256)
        .storeRef(beginCell().storeBuffer(bytesToBuffer(ta.extraData)).endCell())
        .endCell(),
    )
  }
  return builder.endCell()
}

function serializeSourcePool(address: string): Cell {
  const bytes = bytesToBuffer(address)
  return beginCell().storeUint(bytes.length, 8).storeBuffer(bytes).endCell()
}
