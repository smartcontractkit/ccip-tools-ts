import { AptosChain } from './aptos/index.ts'
import { type ChainStatic, ChainFamily } from './chain.ts'
import { EVMChain } from './evm/index.ts'
import { SolanaChain } from './solana/index.ts'

export const supportedChains = {
  [ChainFamily.Aptos]: AptosChain,
  [ChainFamily.EVM]: EVMChain,
  [ChainFamily.Solana]: SolanaChain,
} as const satisfies Partial<Record<ChainFamily, ChainStatic>>
