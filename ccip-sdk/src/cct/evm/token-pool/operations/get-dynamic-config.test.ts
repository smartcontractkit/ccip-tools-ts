import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { EVMChain } from '../../../../evm/index.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import { TOKEN_POOL_INTERFACES, TokenPoolVersion } from '../contracts.ts'
import { type GetDynamicConfigParams, GetDynamicConfig } from './get-dynamic-config.ts'

const POOL = '0x' + '11'.repeat(20)
const ROUTER = '0x' + '22'.repeat(20)
const RATE_LIMIT_ADMIN = '0x' + '33'.repeat(20)
const FEE_ADMIN = '0x' + '44'.repeat(20)
const IFACE = TOKEN_POOL_INTERFACES.BurnMint[TokenPoolVersion.V2_0_0]

function stubChain({
  version = TokenPoolVersion.V2_0_0,
  onCall,
}: {
  version?: TokenPoolVersion
  onCall?: () => void
} = {}): EVMChain {
  return {
    provider: {
      call: async ({ data }: { data: string }) => {
        onCall?.()
        assert.equal(data.slice(0, 10), IFACE.getFunction('getDynamicConfig')!.selector)
        return IFACE.encodeFunctionResult('getDynamicConfig', [ROUTER, RATE_LIMIT_ADMIN, FEE_ADMIN])
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => Promise.resolve(parseTypeAndVersion(`BurnMintTokenPool ${version}`)),
  } as unknown as EVMChain
}

const op = new GetDynamicConfig()
const query = (chain: EVMChain, poolAddress = POOL) =>
  op.query(chain, { poolAddress } satisfies GetDynamicConfigParams)

describe('GetDynamicConfig (cct/evm)', () => {
  describe('query', () => {
    it('reads a v2.0.0 pool config', async () => {
      assert.deepEqual(await query(stubChain()), {
        router: ROUTER,
        rateLimitAdmin: RATE_LIMIT_ADMIN,
        feeAdmin: FEE_ADMIN,
      })
    })
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
