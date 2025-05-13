import type { Idl } from '@coral-xyz/anchor'
import { CcipVersion } from '../../version.ts'
import { CCIP_COMMON_IDL as CCIP_COMMON_IDL_V1_6_0 } from './1.6.0/CCIP_COMMON'
import { CCIP_OFFRAMP_IDL as CCIP_OFFRAMP_IDL_V1_6_0 } from './1.6.0/CCIP_OFFRAMP'
import { CCIP_ROUTER_IDL as CCIP_ROUTER_IDL_V1_6_0 } from './1.6.0/CCIP_ROUTER'

export type SupportedSolanaCCIPVersion = CcipVersion.V1_6_0

type SolanaVersionMap = Record<
  SupportedSolanaCCIPVersion,
  {
    OFFRAMP: {
      idl: Idl
    }
    ROUTER: {
      idl: Idl
    }
    COMMON: {
      idl: Idl
    }
  }
>

export const CCIP_SOLANA_VERSION_MAP = {
  [CcipVersion.V1_6_0]: {
    OFFRAMP: {
      idl: CCIP_OFFRAMP_IDL_V1_6_0,
    },
    ROUTER: {
      idl: CCIP_ROUTER_IDL_V1_6_0,
    },
    COMMON: {
      idl: CCIP_COMMON_IDL_V1_6_0,
    },
  },
} as const satisfies SolanaVersionMap
