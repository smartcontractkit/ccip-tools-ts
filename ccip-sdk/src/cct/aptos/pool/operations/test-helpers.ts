import type { AptosChain } from '../../../../aptos/index.ts'

/** A test sender address (32-byte hex). */
export const SENDER = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

/** A test pool object address. */
export const POOL = '0x00000000000000000000000000000000000000000000000000000000deadbeef'

/** A test remote pool address (EVM-style 20-byte hex). */
export const REMOTE_POOL = '0xd7BF0d8E6C242b6Dde4490Ab3aFc8C1e811ec9aD'

/** A test remote token address (EVM-style 20-byte hex). */
export const REMOTE_TOKEN = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'

/** A test new-owner address. */
export const NEW_OWNER = '0x0000000000000000000000000000000000000000000000000000abcdef123456'

/** A test remote chain selector. */
export const SELECTOR = 16015286601757825753n

/** A disabled rate limiter config. */
export const DISABLED_RATE_LIMITER = {
  isEnabled: false,
  capacity: '0',
  rate: '0',
} as const

/**
 * Builds a minimal AptosChain stub sufficient for pool `buildUnsigned`.
 *
 * Stubs pool-module discovery (`_getAccountModulesNames` + `provider.view`),
 * account sequence lookup (`getAccountInfo`), and transaction building
 * (`transaction.build.simple`) so operations run fully offline.
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
