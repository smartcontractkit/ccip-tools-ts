import { bcs } from '@mysten/sui/bcs'
import { dataSlice, getBytes } from 'ethers'

export const SUIExtraArgsV1Tag = '0x21ea4ca9' as const

export interface SUIExtraArgsV1 {
  gasLimit: bigint
  allowOutOfOrderExecution: boolean
  tokenReceiver: string
  receiverObjectIds: string[]
}

/**
 * BCS struct definition for Sui extra args v1.
 * Matches the Move contract's encode_sui_extra_args_v1 format:
 * - gas_limit: u64
 * - allow_out_of_order_execution: bool
 * - token_receiver: vector<u8> (32 bytes)
 * - receiver_object_ids: vector<vector<u8>> (array of 32-byte addresses)
 */
const SuiExtraArgsV1Struct = bcs.struct('SuiExtraArgsV1', {
  gasLimit: bcs.u64(),
  allowOutOfOrderExecution: bcs.bool(),
  tokenReceiver: bcs.vector(bcs.u8()),
  receiverObjectIds: bcs.vector(bcs.vector(bcs.u8())),
})

const toHexString = (bytes: number[]) => '0x' + Buffer.from(bytes).toString('hex')

export function decodeSuiExtraArgs(data: string): SUIExtraArgsV1 {
  if (!data.startsWith(SUIExtraArgsV1Tag)) {
    throw new Error(`Invalid Sui extra args tag. Expected ${SUIExtraArgsV1Tag}`)
  }

  const argsData = getBytes(dataSlice(data, 4))
  const decoded = SuiExtraArgsV1Struct.parse(argsData)

  const tokenReceiver = toHexString(decoded.tokenReceiver)
  const receiverObjectIds = decoded.receiverObjectIds.map(toHexString)

  return {
    gasLimit: BigInt(decoded.gasLimit),
    allowOutOfOrderExecution: decoded.allowOutOfOrderExecution,
    tokenReceiver,
    receiverObjectIds,
  }
}
