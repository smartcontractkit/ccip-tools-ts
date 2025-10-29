import type { ChainFamily, ChainStatic } from './chain.ts'

// global record; can be mutated when implementing or extending a Chain family support
export const supportedChains: Partial<Record<ChainFamily, ChainStatic>> = {}
