import type { Chain, ExecuteOpts, ResolvedExecuteOpts } from '../chain.ts'

/**
 * Delegates to {@link Chain.resolveExecuteOpts}.
 * Kept in this module (type-only imports from `chain.ts`) so type-aware ESLint does not treat the
 * callee as an `error` type on `SuiChain` (common when mixing value imports from `chain.ts` here).
 */
export async function resolveExecuteOptsForSui(
  chain: Chain,
  opts: ExecuteOpts,
): Promise<ResolvedExecuteOpts> {
  return chain.resolveExecuteOpts(opts)
}
