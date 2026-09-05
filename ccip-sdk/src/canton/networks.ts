/**
 * Well-known CCIP network configuration per Canton network.
 *
 * The shared CCIP singletons (TokenAdminRegistry, FeeQuoter, RMNRemote), the
 * protocol operator party, and the public ledger endpoint are deployed once
 * per network by the protocol operator — end users deploying a token pool
 * should never need to know them. Operations accept explicit per-field
 * overrides (needed for devnet / synthetic testing) and fall back to these
 * constants keyed by `chain.network.chainId`.
 *
 * NOTE: Canton instance addresses are tied to the deployed contract — a
 * redeploy or a Daml package upgrade (e.g. ccip-core 2.0.0 → 2.1.0) produces
 * NEW addresses. Keep entries here in lockstep with `contracts-canton-vX.Y.Z`
 * releases of the chainlink-canton contracts repo.
 *
 * @packageDocumentation
 */

/**
 * Well-known CCIP configuration for a Canton network. Contract addresses are
 * `RawInstanceAddress` RAW strings (`"instanceId@party"`, NOT the hashed
 * `0x…` form — the hash is one-way and the choices store the raw value).
 */
export interface CantonNetworkConfig {
  /** CCIP operator party (protocol-level owner of the shared contracts). */
  ccipOwner: string
  /** Token Admin Registry raw instance address. */
  tokenAdminRegistry: string
  /** FeeQuoter raw instance address. */
  feeQuoter: string
  /** RMNRemote raw instance address. */
  rmnRemote: string
  /** Public JSON Ledger API base URL. */
  ledgerUrl?: string
  /** Global CCIP EDS (explicit disclosure service) base URL. */
  edsUrl?: string
}

/**
 * Registry of well-known configuration per Canton chain ID
 * (`canton:LocalNet` / `canton:DevNet` / `canton:TestNet` / `canton:MainNet`).
 *
 * `canton:TestNet` values verified against CV1 (prod testnet) deployment
 * state, Aug 2026. On CV1 the operator parties share one fingerprint across
 * the ccipOwner/rmnOwner/ccvOwner hints.
 *
 * LocalNet/DevNet have no stable deployments — pass explicit overrides there.
 */
export const CANTON_NETWORKS: Readonly<Record<string, CantonNetworkConfig>> = {
  'canton:TestNet': {
    ccipOwner:
      'ccipOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551',
    tokenAdminRegistry:
      'tokenadminregistry-nbehb@ccipOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551',
    feeQuoter:
      'feequoter-koyox@ccipOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551',
    rmnRemote:
      'rmn_remote-pttst@rmnOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551',
    ledgerUrl: 'https://testnet.cv1.bcy-v.metalhosts.com/api/json',
    edsUrl: 'https://eds.testnet.ccip.chain.link',
  },
}

/**
 * Look up the well-known CCIP configuration for a Canton chain ID.
 * Returns `undefined` for networks without a registered deployment
 * (callers decide whether to fall back or throw).
 */
export function getCantonNetworkConfig(chainId: string): CantonNetworkConfig | undefined {
  return CANTON_NETWORKS[chainId]
}
