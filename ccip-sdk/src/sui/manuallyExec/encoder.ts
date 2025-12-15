import { bcs } from '@mysten/sui/bcs'
import { type BytesLike, AbiCoder } from 'ethers'

import type { CCIPMessage, CCIPVersion, ExecutionReport } from '../../types.ts'

const Any2SuiTokenTransferBCS = bcs.struct('Any2SuiTokenTransfer', {
  source_pool_address: bcs.vector(bcs.u8()),
  dest_token_address: bcs.Address,
  dest_gas_amount: bcs.u32(),
  extra_data: bcs.vector(bcs.u8()),
  amount: bcs.u256(),
})

const ExecutionReportBCS = bcs.struct('ExecutionReport', {
  source_chain_selector: bcs.u64(),
  message_id: bcs.fixedArray(32, bcs.u8()),
  header_source_chain_selector: bcs.u64(),
  dest_chain_selector: bcs.u64(),
  sequence_number: bcs.u64(),
  nonce: bcs.u64(),
  sender: bcs.vector(bcs.u8()),
  data: bcs.vector(bcs.u8()),
  receiver: bcs.Address,
  gas_limit: bcs.u256(),
  token_receiver: bcs.Address,
  token_amounts: bcs.vector(Any2SuiTokenTransferBCS),
  offchain_token_data: bcs.vector(bcs.vector(bcs.u8())),
  proofs: bcs.vector(bcs.fixedArray(32, bcs.u8())),
})

export function serializeExecutionReport(
  executionReport: ExecutionReport<CCIPMessage<typeof CCIPVersion.V1_6>>,
): Uint8Array {
  const { message, offchainTokenData, proofs } = executionReport

  if (!message) {
    throw new Error('Message is undefined in execution report')
  }

  const decodedExtraArgs = decodeSuiExtraArgs(message.extraArgs)

  type TokenAmount = {
    sourcePoolAddress: string
    destTokenAddress: string
    destGasAmount?: bigint
    extraData: string
    amount: bigint
  }

  const reportData = {
    source_chain_selector: executionReport.message.header.sourceChainSelector,
    message_id: Array.from(Buffer.from(executionReport.message.header.messageId.slice(2), 'hex')),
    header_source_chain_selector: executionReport.message.header.sourceChainSelector,
    dest_chain_selector: executionReport.message.header.destChainSelector,
    sequence_number: executionReport.message.header.sequenceNumber,
    nonce: executionReport.message.header.nonce,
    sender: Array.from(Buffer.from(executionReport.message.sender.slice(2), 'hex')),
    data: Array.from(Buffer.from(executionReport.message.data.slice(2), 'hex')),
    receiver: executionReport.message.receiver,
    gas_limit: decodedExtraArgs.gasLimit,
    token_receiver: decodedExtraArgs.tokenReceiver,
    token_amounts: executionReport.message.tokenAmounts.map((token: TokenAmount) => ({
      source_pool_address: Array.from(Buffer.from(token.sourcePoolAddress.slice(2), 'hex')),
      dest_token_address: token.destTokenAddress,
      dest_gas_amount: Number(token.destGasAmount || 0n), // Use actual destGasAmount from token data
      extra_data: Array.from(Buffer.from(token.extraData.slice(2), 'hex')),
      amount: BigInt(token.amount),
    })),
    offchain_token_data: offchainTokenData.map((data) => {
      if (!data) {
        return Array.from(Buffer.from('', 'hex'))
      }
      // Extract the actual data bytes from the object
      const dataBytes = data._tag ? data[data._tag] : '0x'
      if (typeof dataBytes === 'string') {
        const hex = dataBytes.startsWith('0x') ? dataBytes.slice(2) : dataBytes
        return Array.from(Buffer.from(hex, 'hex'))
      }
      return Array.from(Buffer.from(dataBytes))
    }),
    proofs: proofs.map((proof: BytesLike) => {
      const proofStr = typeof proof === 'string' ? proof : Buffer.from(proof).toString('hex')
      const proofBytes = Buffer.from(
        proofStr.startsWith('0x') ? proofStr.slice(2) : proofStr,
        'hex',
      )
      // Ensure each proof is exactly 32 bytes
      if (proofBytes.length !== 32) {
        const proofHex =
          typeof proof === 'string' ? proof : `0x${Buffer.from(proof).toString('hex')}`
        throw new Error(
          `Invalid proof length: expected 32 bytes, got ${proofBytes.length} bytes for proof ${proofHex}`,
        )
      }
      return Array.from(proofBytes)
    }),
  }

  return ExecutionReportBCS.serialize(reportData).toBytes()
}

export const SUI_EXTRA_ARGS_V1_TAG = '0x21ea4ca9' as const

export interface SUIExtraArgsV1 {
  gasLimit: bigint
  allowOutOfOrderExecution: boolean
  tokenReceiver: string
  receiverObjectIds: string[]
}

export function decodeSuiExtraArgs(data: string): SUIExtraArgsV1 {
  if (!data.startsWith(SUI_EXTRA_ARGS_V1_TAG)) {
    throw new Error(`Invalid Sui extra args tag. Expected ${SUI_EXTRA_ARGS_V1_TAG}`)
  }

  const abiData = '0x' + data.slice(10)
  const decoded = AbiCoder.defaultAbiCoder().decode(
    ['tuple(uint256,bool,bytes32,bytes32[])'],
    abiData,
  )

  const tuple = decoded[0] as readonly [bigint, boolean, string, string[]]

  return {
    gasLimit: tuple[0],
    allowOutOfOrderExecution: tuple[1],
    tokenReceiver: tuple[2],
    receiverObjectIds: tuple[3], // Already an array of hex strings
  }
}
