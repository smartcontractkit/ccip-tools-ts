import type { SVMExtraArgsV1 } from '../extra-args.ts'
import type { CCIPMessage_V1_6 } from '../types.ts'

// SourceTokenData adds `destGasAmount` (decoded from source's `destExecData`);
// not sure why they kept the "gas" name in Solana, but let's just be keep consistent
export type CCIPMessage_V1_6_Solana = CCIPMessage_V1_6 & SVMExtraArgsV1
