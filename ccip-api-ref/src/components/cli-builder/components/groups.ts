/**
 * Render order for CLI option groups.
 *
 * The CLI Builder renders only the groups listed here, so a schema option whose `group` is absent
 * is silently dropped from the page. `groups.test.ts` asserts the verification group appears.
 */
export const GROUP_ORDER = [
  'verification',
  'message',
  'gas',
  'solana',
  'wallet',
  'output',
  'rpc',
  'other',
] as const
