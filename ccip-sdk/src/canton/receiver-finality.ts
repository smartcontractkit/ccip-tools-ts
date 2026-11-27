import type { FinalityConfig } from '@chainlink/canton-contracts/ccip-codec-v2-2.0.0/CCIP/CodecV2/FinalityConfig'

import type { FinalityRequested } from '../extra-args.ts'

/** Returns true when a CCIPReceiver's finality config accepts messages with `finality`. */
export function receiverFinalityMatches(
  config: FinalityConfig,
  finality: FinalityRequested,
): boolean {
  switch (config.tag) {
    case 'WaitForFinality':
      return finality === 'finalized'
    case 'WaitForSafe':
      return finality === 'safe'
    case 'BlockDepth':
      return typeof finality === 'number' && finality === parseInt(config.value)
  }
}
