import { bcs } from '@mysten/sui/bcs'
import type { BytesLike } from 'ethers'

import { CCIPMessageInvalidError } from '../../errors/specialized.ts'
import { decodeExtraArgs } from '../../extra-args.ts'
import type { ExecutionReport } from '../../types.ts'
import { bytesToBuffer, networkInfo } from '../../utils.ts'
import type { CCIPMessage_V1_6_Sui } from '../types.ts'

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

/**
 * Serializes an execution report for Sui manual execution.
 * @param executionReport - The execution report to serialize.
 * @returns Serialized execution report as Uint8Array.
 */
export function serializeExecutionReport(
  executionReport: ExecutionReport<CCIPMessage_V1_6_Sui>,
): Uint8Array {
  const { message, offchainTokenData, proofs } = executionReport

  if (!message) {
    throw new CCIPMessageInvalidError('Message is undefined in execution report')
  }

  const decodedExtraArgs = decodeExtraArgs(
    message.extraArgs,
    networkInfo(message.destChainSelector).family,
  )

  if (!decodedExtraArgs || decodedExtraArgs._tag !== 'SuiExtraArgsV1') {
    throw new CCIPMessageInvalidError('Expected Sui extra args')
  }

  type TokenAmount = {
    sourcePoolAddress: string
    destTokenAddress: string
    destGasAmount?: bigint
    extraData: string
    amount: bigint
  }

  const reportData = {
    source_chain_selector: message.sourceChainSelector,
    message_id: Array.from(bytesToBuffer(message.messageId)),
    header_source_chain_selector: message.sourceChainSelector,
    dest_chain_selector: message.destChainSelector,
    sequence_number: message.sequenceNumber,
    nonce: message.nonce,
    sender: Array.from(bytesToBuffer(message.sender)),
    data: Array.from(bytesToBuffer(message.data)),
    receiver: message.receiver,
    gas_limit: decodedExtraArgs.gasLimit,
    token_receiver: decodedExtraArgs.tokenReceiver,
    token_amounts: message.tokenAmounts.map((token: TokenAmount) => ({
      source_pool_address: Array.from(bytesToBuffer(token.sourcePoolAddress)),
      dest_token_address: token.destTokenAddress,
      dest_gas_amount: Number(token.destGasAmount || 0n), // Use actual destGasAmount from token data
      extra_data: Array.from(bytesToBuffer(token.extraData)),
      amount: BigInt(token.amount),
    })),
    offchain_token_data: offchainTokenData.map((data) => {
      if (!data) {
        return bytesToBuffer('')
      }
      // Extract the actual data bytes from the object
      const dataBytes = data._tag ? data[data._tag] : '0x'
      return Array.from(bytesToBuffer(dataBytes))
    }),
    proofs: proofs.map((proof: BytesLike) => {
      const proofBytes = bytesToBuffer(proof)
      // Ensure each proof is exactly 32 bytes
      if (proofBytes.length !== 32) {
        throw new CCIPMessageInvalidError(
          `Invalid proof length: expected 32 bytes, got ${proofBytes.length}`,
        )
      }
      return Array.from(proofBytes)
    }),
  }

  return ExecutionReportBCS.serialize(reportData).toBytes()
}
