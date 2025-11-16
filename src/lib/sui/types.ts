import { bcs } from '@mysten/sui/bcs'
import { concat } from 'ethers'

import { type SuiExtraArgsV1, SuiExtraArgsV1Tag } from '../extra-args.ts'
import type { CCIPMessage_V1_6 } from '../types.ts'
import { getAddressBytes, getDataBytes } from '../utils.ts'

export type CCIPMessage_V1_6_Sui = CCIPMessage_V1_6 & SuiExtraArgsV1

export const SuiExtraArgsV1Codec = bcs.struct('SuiExtraArgsV1', {
  gasLimit: bcs.u64(),
  allowOutOfOrderExecution: bcs.bool(),
  tokenReceiver: bcs.vector(bcs.u8()),
  receiverObjectIds: bcs.vector(bcs.vector(bcs.u8())),
})

export function encodeSuiExtraArgsV1(args: SuiExtraArgsV1): string {
  const tokenReceiver = getAddressBytes(args.tokenReceiver)
  const receiverObjectIds = args.receiverObjectIds.map((id) => getDataBytes(id))
  const bcsData = SuiExtraArgsV1Codec.serialize({ ...args, tokenReceiver, receiverObjectIds })
  return concat([SuiExtraArgsV1Tag, bcsData.toBytes()])
}
