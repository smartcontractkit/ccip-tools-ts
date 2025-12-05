import type { SVMExtraArgsV1 } from '../extra-args.ts'
import type { CCIPMessage_V1_6 } from '../types.ts'

/** Solana-specific CCIP v1.6 message type with SVM extra args. */
export type CCIPMessage_V1_6_Solana = CCIPMessage_V1_6 & SVMExtraArgsV1
