import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { toBeHex } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import { type TokenPoolFamily, TOKEN_POOL_INTERFACES, TokenPoolVersion } from '../contracts.ts'
import {
  type GetAllowedFinalityConfigParams,
  GetAllowedFinalityConfig,
} from './get-allowed-finality-config.ts'

const POOL = '0x' + '11'.repeat(20)
const POOL_TYPE: Record<TokenPoolFamily, string> = {
  BurnMint: 'BurnMintTokenPool',
  LockRelease: 'LockReleaseTokenPool',
}

function stubChain({
  family = 'BurnMint',
  version = TokenPoolVersion.V2_0_0,
  allowedFinality = toBeHex(0x00010005, 4),
  onCall,
}: {
  family?: TokenPoolFamily
  version?: TokenPoolVersion
  allowedFinality?: string
  onCall?: () => void
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES[family][TokenPoolVersion.V2_0_0]
  return {
    provider: {
      call: async ({ data }: { data: string }) => {
        onCall?.()
        assert.equal(data.slice(0, 10), iface.getFunction('getAllowedFinalityConfig')!.selector)
        return iface.encodeFunctionResult('getAllowedFinalityConfig', [allowedFinality])
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => Promise.resolve(parseTypeAndVersion(`${POOL_TYPE[family]} ${version}`)),
  } as unknown as EVMChain
}

const op = new GetAllowedFinalityConfig()
const query = (chain: EVMChain, poolAddress = POOL) =>
  op.query(chain, { poolAddress } satisfies GetAllowedFinalityConfigParams)

describe('GetAllowedFinalityConfig (cct/evm)', () => {
  describe('query', () => {
    for (const family of ['BurnMint', 'LockRelease'] as const) {
      it(`decodes FTF depth and FCR from a ${family} v2.0.0 pool`, async () => {
        assert.deepEqual(await query(stubChain({ family })), {
          finalityDepth: 5,
          finalitySafe: true,
        })
      })
    }

    it('omits finalitySafe when FCR is disabled', async () => {
      assert.deepEqual(await query(stubChain({ allowedFinality: toBeHex(7, 4) })), {
        finalityDepth: 7,
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
