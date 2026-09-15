import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { EVMChain } from '../../../../evm/index.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import { TOKEN_POOL_INTERFACES, TokenPoolVersion } from '../contracts.ts'
import {
  type GetTokenTransferFeeConfigParams,
  GetTokenTransferFeeConfig,
} from './get-token-transfer-fee-config.ts'

const POOL = '0x' + '11'.repeat(20)
const TOKEN = '0x' + '22'.repeat(20)
const IFACE = TOKEN_POOL_INTERFACES.BurnMint[TokenPoolVersion.V2_0_0]
const CONFIG = {
  destGasOverhead: 100_000,
  destBytesOverhead: 32,
  finalityFeeUSDCents: 10,
  fastFinalityFeeUSDCents: 20,
  finalityTransferFeeBps: 25,
  fastFinalityTransferFeeBps: 50,
  isEnabled: true,
}

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
        if (data.slice(0, 10) === IFACE.getFunction('getToken')!.selector)
          return IFACE.encodeFunctionResult('getToken', [TOKEN])
        assert.equal(data.slice(0, 10), IFACE.getFunction('getTokenTransferFeeConfig')!.selector)
        assert.deepEqual(Array.from(IFACE.decodeFunctionData('getTokenTransferFeeConfig', data)), [
          TOKEN,
          1n,
          '0x00000000',
          '0x',
        ])
        return IFACE.encodeFunctionResult('getTokenTransferFeeConfig', [CONFIG])
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => Promise.resolve(parseTypeAndVersion(`BurnMintTokenPool ${version}`)),
  } as unknown as EVMChain
}

const op = new GetTokenTransferFeeConfig()
const query = (chain: EVMChain, overrides: Partial<GetTokenTransferFeeConfigParams> = {}) =>
  op.query(chain, {
    poolAddress: POOL,
    remoteChainSelector: 1n,
    ...overrides,
  })

describe('GetTokenTransferFeeConfig (cct/evm)', () => {
  describe('query', () => {
    it('reads and decodes a v2.0.0 pool config', async () => {
      assert.deepEqual(await query(stubChain()), CONFIG)
    })
  })

  describe('validation', () => {
    it('rejects an invalid address before RPC', async () => {
      let called = false
      await assert.rejects(
        () => query(stubChain({ onCall: () => (called = true) }), { poolAddress: 'bad' }),
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
