import { type Builder, Address, Cell, beginCell } from '@ton/core'
import type { KeyPair } from '@ton/crypto'
import type { WalletContractV4 } from '@ton/ton'
import type { BytesLike } from 'ethers'

import type { GenericExtraArgsV2 } from '../extra-args.ts'
import type { CCIPMessage_V1_6, ExecutionReport } from '../types.ts'

/**
 *
 */
export type CCIPMessage_V1_6_TON = CCIPMessage_V1_6 & GenericExtraArgsV2

/**
 * TON wallet with keypair for signing transactions
 */
export interface TONWallet {
  contract: WalletContractV4
  keyPair: KeyPair
}

// asSnakeData helper for encoding variable-length arrays
function asSnakeData<T>(array: T[], builderFn: (item: T) => Builder): Cell {
  const cells: Builder[] = []
  let builder = beginCell()

  for (const value of array) {
    const itemBuilder = builderFn(value)
    if (itemBuilder.refs > 3) {
      throw new Error('Cannot pack more than 3 refs per item; store it in a separate ref cell.')
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

function convertProofsToBigInt(proofs: readonly BytesLike[]): bigint[] {
  return proofs.map((proof) => {
    if (typeof proof === 'string') {
      return BigInt(proof.startsWith('0x') ? proof : '0x' + proof)
    }
    if (proof instanceof Uint8Array) {
      return BigInt('0x' + Buffer.from(proof).toString('hex'))
    }
    throw new Error(`Unsupported proof type: ${typeof proof}`)
  })
}

/**
 *
 */
export function serializeExecutionReport(execReport: ExecutionReport<CCIPMessage_V1_6_TON>): Cell {
  return beginCell()
    .storeUint(execReport.message.header.sourceChainSelector, 64)
    .storeRef(asSnakeData([execReport.message], serializeMessage))
    .storeRef(Cell.EMPTY)
    .storeRef(
      asSnakeData(convertProofsToBigInt(execReport.proofs), (proof: bigint) => {
        return beginCell().storeUint(proof, 256)
      }),
    )
    .storeUint(execReport.proofFlagBits, 256)
    .endCell()
}

function serializeMessage(message: CCIPMessage_V1_6_TON): Builder {
  return beginCell()
    .storeRef(serializeHeader(message.header))
    .storeRef(serializeSender(message.sender))
    .storeRef(serializeData(message.data))
    .storeAddress(Address.parse(message.receiver))
    .storeCoins(message.gasLimit)
    .storeMaybeRef(
      message.tokenAmounts?.length > 0 ? serializeTokenAmounts(message.tokenAmounts) : null,
    )
}

function serializeHeader(header: CCIPMessage_V1_6['header']): Builder {
  return beginCell()
    .storeUint(BigInt(header.messageId), 256)
    .storeUint(header.sourceChainSelector, 64)
    .storeUint(header.destChainSelector, 64)
    .storeUint(header.sequenceNumber, 64)
    .storeUint(header.nonce, 64)
}

function serializeSender(sender: string): Builder {
  const senderBytes = Buffer.from(sender.slice(2), 'hex')
  return beginCell().storeUint(senderBytes.length, 8).storeBuffer(senderBytes)
}

function serializeData(data: string): Builder {
  return beginCell().storeBuffer(Buffer.from(data.slice(2), 'hex'))
}

function serializeTokenAmounts(tokenAmounts: CCIPMessage_V1_6['tokenAmounts']): Builder {
  const builder = beginCell()
  for (const ta of tokenAmounts) {
    builder.storeRef(
      beginCell()
        .storeRef(serializeSourcePool(ta.sourcePoolAddress))
        .storeAddress(Address.parse(ta.destTokenAddress))
        .storeUint(BigInt(ta.amount), 256)
        .storeRef(
          beginCell()
            .storeBuffer(Buffer.from(ta.extraData.slice(2), 'hex'))
            .endCell(),
        )
        .endCell(),
    )
  }
  return builder
}

function serializeSourcePool(address: string): Builder {
  const bytes = Buffer.from(address.slice(2), 'hex')
  return beginCell().storeUint(bytes.length, 8).storeBuffer(bytes)
}
