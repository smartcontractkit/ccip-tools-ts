import type { ChainStatic } from './chain.ts'
import { CCIPChainFamilyUnsupportedError } from './errors/index.ts'
import type { ChainFamily } from './networks.ts'

/**
 * Global registry of Chain classes by family, which family-generic helpers (`decodeAddress`,
 * `decodeExtraArgs`, `decodeMessage`, `getLeafHasher`, ...) dispatch to.
 *
 * SDK chain classes add themselves (`??=`) when their module is evaluated, so they never replace an
 * entry set before; assign to register a derived or custom class, e.g.
 * `supportedChains[ChainFamily.EVM] = MyEVMChain`.
 */
export const supportedChains: Partial<{ [F in ChainFamily]: ChainStatic<F> }> = {}

// chain classes register themselves when their module is evaluated, and bundlers drop the ones an
// app never references
const NOT_REGISTERED_RECOVERY =
  "Reference the family's Chain class (e.g. `import { EVMChain } from '@chainlink/ccip-sdk'`), assign a custom class to `supportedChains`, or import '@chainlink/ccip-sdk/all' to register every family."

/**
 * Registered Chain class for a family.
 * @param family - chain family
 * @returns class registered in {@link supportedChains}
 * @throws {@link CCIPChainFamilyUnsupportedError} if no class is registered for `family`
 */
export function getChainStatic<F extends ChainFamily>(family: F): ChainStatic<F> {
  const C = supportedChains[family]
  if (C) return C
  throw new CCIPChainFamilyUnsupportedError(family, {
    context: { registered: Object.keys(supportedChains) },
    recovery: NOT_REGISTERED_RECOVERY,
  })
}

/**
 * Registered Chain classes: the one for `family`, or every registered one.
 * @param family - optional chain family
 * @returns classes registered in {@link supportedChains}
 * @throws {@link CCIPChainFamilyUnsupportedError} if `family` (or, without it, any family) is not
 *   registered
 */
export function getChainStatics(family?: ChainFamily): ChainStatic[] {
  if (family) return [getChainStatic(family)]
  const chains = Object.values(supportedChains)
  if (!chains.length) {
    throw new CCIPChainFamilyUnsupportedError('(none registered)', {
      recovery: NOT_REGISTERED_RECOVERY,
    })
  }
  return chains
}
