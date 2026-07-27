import type { SolanaChain } from '../../solana/index.ts'

/** Shared base for read-only Solana CCT queries. */
export abstract class SolanaQuery<P extends object, R> {
  abstract query(chain: SolanaChain, params: P): Promise<R>
}
