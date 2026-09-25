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

// families the SDK implements, by class name: they register when their module is evaluated, and
// bundlers drop the modules an app never uses (an unused import doesn't register a family, an
// explicit assignment does)
const CLASS_NAMES: Partial<Record<string, string>> = {
  EVM: 'EVMChain',
  SVM: 'SolanaChain',
  APTOS: 'AptosChain',
  SUI: 'SuiChain',
  TON: 'TONChain',
  CANTON: 'CantonChain',
}

/**
 * Recovery hint for a family the SDK implements but the app didn't register.
 * @param family - the missing family; defaults the example to EVM
 * @returns recovery text
 */
export function notRegisteredRecovery(family: string = 'EVM'): string {
  const name = CLASS_NAMES[family] ?? 'EVMChain'
  const key = CLASS_NAMES[family] ? family : 'EVM'
  return `Register the family explicitly, e.g. \`import { ${name}, supportedChains } from '@chainlink/ccip-sdk'\` then \`supportedChains.${key} ??= ${name}\` (an unused import is tree-shaken and registers nothing), or \`import '@chainlink/ccip-sdk/all'\` to register every family.`
}

/**
 * Families the SDK implements that aren't registered in {@link supportedChains}.
 * @returns missing families
 */
export function unregisteredFamilies(): string[] {
  return Object.keys(CLASS_NAMES).filter((family) => !(family in supportedChains))
}

/**
 * Registered Chain class for a family.
 * @param family - chain family
 * @returns class registered in {@link supportedChains}
 * @throws {@link CCIPChainFamilyUnsupportedError} if no class is registered for `family`
 */
export function getChainStatic<F extends ChainFamily>(family: F): ChainStatic<F> {
  const C = supportedChains[family]
  if (C) return C
  const registered = Object.keys(supportedChains)
  // a family the SDK doesn't implement: nothing to import
  if (!CLASS_NAMES[family])
    throw new CCIPChainFamilyUnsupportedError(family, { context: { registered } })
  throw new CCIPChainFamilyUnsupportedError(family, {
    registered,
    recovery: notRegisteredRecovery(family),
  })
}

/**
 * Registered Chain classes: the one for `family`, or every registered one.
 * @param family - optional chain family
 * @returns classes registered in {@link supportedChains}
 * @throws {@link CCIPChainFamilyUnsupportedError} if `family` is not registered, or, without
 *   `family`, if no family is registered
 */
export function getChainStatics(family?: ChainFamily): ChainStatic[] {
  if (family) return [getChainStatic(family)]
  const chains = Object.values(supportedChains)
  if (!chains.length) {
    throw new CCIPChainFamilyUnsupportedError(undefined, {
      registered: [],
      recovery: notRegisteredRecovery(),
    })
  }
  return chains
}
