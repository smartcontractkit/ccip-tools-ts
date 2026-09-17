import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { EVMChain } from '../../../../evm/index.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import { type TokenPoolFamily, TOKEN_POOL_INTERFACES, TokenPoolVersion } from '../contracts.ts'
import { type GetDynamicConfigParams, GetDynamicConfig } from './get-dynamic-config.ts'

const POOL = '0x' + '11'.repeat(20)
const ROUTER = '0x' + '22'.repeat(20)
const RATE_LIMIT_ADMIN = '0x' + '33'.repeat(20)
const FEE_ADMIN = '0x' + '44'.repeat(20)
const POOL_TYPE: Record<TokenPoolFamily, string> = {
  BurnMint: 'BurnMintTokenPool',
  LockRelease: 'LockReleaseTokenPool',
}

function stubChain({
  family = 'BurnMint',
  version = TokenPoolVersion.V2_0_0,
  onCall,
}: {
  family?: TokenPoolFamily
  version?: TokenPoolVersion
  onCall?: () => void
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES[family][TokenPoolVersion.V2_0_0]
  return {
    provider: {
      call: async ({ data }: { data: string }) => {
        onCall?.()
        assert.equal(data.slice(0, 10), iface.getFunction('getDynamicConfig')!.selector)
        return iface.encodeFunctionResult('getDynamicConfig', [ROUTER, RATE_LIMIT_ADMIN, FEE_ADMIN])
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => Promise.resolve(parseTypeAndVersion(`${POOL_TYPE[family]} ${version}`)),
  } as unknown as EVMChain
}

const op = new GetDynamicConfig()
const query = (chain: EVMChain, poolAddress = POOL) =>
  op.query(chain, { poolAddress } satisfies GetDynamicConfigParams)

describe('GetDynamicConfig (cct/evm)', () => {
  describe('query', () => {
    for (const family of ['BurnMint', 'LockRelease'] as const) {
      it(`reads a ${family} v2.0.0 pool config`, async () => {
        assert.deepEqual(await query(stubChain({ family })), {
          router: ROUTER,
          rateLimitAdmin: RATE_LIMIT_ADMIN,
          feeAdmin: FEE_ADMIN,
        })
      })
    }
  })

  describe('validation', () => {
    it('rejects an invalid address before RPC', async () => {
      let called = false
      await assert.rejects(
        () => query(stubChain({ onCall: () => (called = true) }), 'bad'),
        CCTParamsInvalidError,
      )
      assert.equal(called, false)
    })
  })

  describe('version', () => {
    it('rejects pre-v2.0.0 pools', async () => {
      await assert.rejects(
        () => query(stubChain({ version: TokenPoolVersion.V1_6_1 })),
        (err: unknown) =>
          err instanceof CCTOperationUnsupportedError &&
          err.context.version === TokenPoolVersion.V1_6_1,
      )
    })
  })
})
