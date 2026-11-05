/**
 * Solana CCT reads: {@link Query} bound to a {@link SolanaChain}. The read-only counterpart of
 * {@link SolanaOperation} — no wallet, no instructions, no submit.
 *
 * @packageDocumentation
 */

import type { SolanaChain } from '../../solana/index.ts'
import { Query } from '../query.ts'

/** Shared base for read-only Solana CCT queries; see {@link Query}. */
export abstract class SolanaQuery<P extends object, R, Parsed = P> extends Query<
  SolanaChain,
  P,
  R,
  Parsed
> {}
