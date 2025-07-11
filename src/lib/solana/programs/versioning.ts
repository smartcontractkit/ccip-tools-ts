import type { Idl } from '@coral-xyz/anchor'
import { CCIPVersion } from '../../types.ts'
import { CCIP_CCTP_TOKEN_POOL_IDL as CCIP_CCTP_TOKEN_POOL_IDL_V1_6_0 } from './1.6.0/CCIP_CCTP_TOKEN_POOL.ts'
import { CCIP_COMMON_IDL as CCIP_COMMON_IDL_V1_6_0 } from './1.6.0/CCIP_COMMON.ts'
import { CCIP_OFFRAMP_IDL as CCIP_OFFRAMP_IDL_V1_6_0 } from './1.6.0/CCIP_OFFRAMP.ts'
import { CCIP_ROUTER_IDL as CCIP_ROUTER_IDL_V1_6_0 } from './1.6.0/CCIP_ROUTER.ts'

export type SupportedSolanaCCIPVersion = typeof CCIPVersion.V1_6

export const SolanaCCIPIdl = {
  OffRamp: 'OffRamp',
  Router: 'Router',
  Common: 'Common',
  CcipCctpTokenPool: 'CcipCctpTokenPool',
} as const
export type SolanaCCIPIdl = (typeof SolanaCCIPIdl)[keyof typeof SolanaCCIPIdl]

type SolanaVersionMap = Record<SupportedSolanaCCIPVersion, Record<SolanaCCIPIdl, Idl>>

export const CCIP_SOLANA_VERSION_MAP = {
  [CCIPVersion.V1_6]: {
    [SolanaCCIPIdl.OffRamp]: CCIP_OFFRAMP_IDL_V1_6_0,
    [SolanaCCIPIdl.Router]: CCIP_ROUTER_IDL_V1_6_0,
    [SolanaCCIPIdl.Common]: CCIP_COMMON_IDL_V1_6_0,
    [SolanaCCIPIdl.CcipCctpTokenPool]: CCIP_CCTP_TOKEN_POOL_IDL_V1_6_0,
  },
} as const satisfies SolanaVersionMap
