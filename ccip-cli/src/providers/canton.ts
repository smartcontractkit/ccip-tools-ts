import { type CantonWallet, CCIPArgumentInvalidError } from '@chainlink/ccip-sdk/src/index.ts'

/**
 * Loads a Canton wallet from the provided options.
 *
 * A Canton "wallet" is simply a Daml party ID. The party can be supplied via:
 *  - `--wallet <party>` (if the value contains `::`, it's treated as a party ID)
 *  - `--canton-party <party>` (explicit Canton party flag)
 *
 * @param opts - CLI options containing wallet and/or canton-party values.
 * @returns A {@link CantonWallet} with the resolved party ID.
 * @throws {@link CCIPArgumentInvalidError} if no valid party ID can be resolved.
 */
export function loadCantonWallet(opts: { wallet?: unknown; cantonParty?: string }): CantonWallet {
  // Prefer --wallet if it looks like a Daml party ID (contains `::`)
  if (typeof opts.wallet === 'string' && opts.wallet.includes('::')) {
    return { party: opts.wallet }
  }
  // Fall back to --canton-party
  if (opts.cantonParty) {
    return { party: opts.cantonParty }
  }
  throw new CCIPArgumentInvalidError(
    'wallet',
    'Canton requires a Daml party ID via --wallet <party::hash> or --canton-party <party>',
  )
}
