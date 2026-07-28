import type { AptosChain } from '../../../../aptos/index.ts'

/** A test sender address (32-byte hex). */
export const SENDER = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

/** A test fungible-asset metadata (token) address. */
export const TOKEN = '0x0000000000000000000000000000000000000000000000000000000089fd6b14'

/** A test pool object address (used as `authority`). */
export const AUTHORITY = '0x00000000000000000000000000000000000000000000000000000000deadbeef'

/**
 * Builds a minimal AptosChain stub sufficient for grant/revoke `buildUnsigned`.
 *
 * Stubs pool-module discovery (`_getAccountModulesNames` + `provider.view`),
 * account sequence lookup (`getAccountInfo`), and transaction building
 * (`transaction.build.simple`) so operations run fully offline. `provider.view`
 * returns a single address so `get_store_address` / `resolveTokenCodeObject`
 * resolve to a canned value.
 */
export function stubChain(): AptosChain {
  const fakeTx = { bcsToBytes: () => new Uint8Array([1, 2, 3]) }
  const provider = {
    async view() {
      return ['0xmanaged_token'] as [string]
    },
    async getAccountInfo() {
      return { sequence_number: '0' }
    },
    transaction: {
      build: {
        async simple() {
          return fakeTx
        },
      },
    },
  }
  return {
    provider,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    async _getAccountModulesNames() {
      return ['managed_token_pool']
    },
  } as unknown as AptosChain
}
