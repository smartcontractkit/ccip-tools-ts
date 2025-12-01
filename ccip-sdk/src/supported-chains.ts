import type { ChainStatic } from './chain.ts'
import type { ChainFamily } from './types.ts'

// global record; can be mutated when implementing or extending a Chain family support
export const supportedChains: Partial<{ [F in ChainFamily]: ChainStatic<F> }> = {}
