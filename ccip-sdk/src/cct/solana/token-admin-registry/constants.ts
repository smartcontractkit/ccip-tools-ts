/** Authorization paths used to register a token in the TokenAdminRegistry. */
export const REGISTER_ADMIN_METHODS = {
  OWNER: 'owner',
  CCIP_ADMIN: 'ccip-admin',
} as const

/** Standard BurnMint/LockRelease pool ALT writable positions. */
export const DEFAULT_WRITABLE_INDEXES = [3, 4, 7] as const
