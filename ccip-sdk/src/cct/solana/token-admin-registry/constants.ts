/** Authorization paths used to register a token in the TokenAdminRegistry. */
export const REGISTRATION_METHODS = {
  OWNER: 'owner',
  CCIP_ADMIN: 'ccip-admin',
} as const

/**
 * Positions of `poolConfig` (3), `poolTokenAta` (4), and `tokenMint` (7) in the pool ALT built
 * by `createLookupTable`. Custom pools must extend this, e.g. `[...DEFAULT_WRITABLE_INDEXES, n]`.
 */
export const DEFAULT_WRITABLE_INDEXES = [3, 4, 7] as const
