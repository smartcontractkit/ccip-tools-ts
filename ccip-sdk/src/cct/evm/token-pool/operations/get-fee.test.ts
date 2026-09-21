import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ZeroAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { encodeFinality } from '../../../../extra-args.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import { type TokenPoolFamily, TOKEN_POOL_INTERFACES, TokenPoolVersion } from '../contracts.ts'
import { type GetFeeParams, GetFee } from './get-fee.ts'

const POOL = '0x' + '11'.repeat(20)
const SELECTOR = 16015286601757825753n
const IFACE = TOKEN_POOL_INTERFACES.BurnMint[TokenPoolVersion.V2_0_0]
const FEE = [10n, 100_000n, 32n, 25n, true]
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
  const iface = TOKEN_POOL_INTERFACES[family][version]
  return {
    provider: {
      call: async ({ data }: { data: string }) => {
        onCall?.()
        const decoded = iface.decodeFunctionData('getFee', data)
        assert.equal(decoded[0], ZeroAddress)
        assert.equal(decoded[1], SELECTOR)
        assert.equal(decoded[2], 0n)
        assert.equal(decoded[3], ZeroAddress)
        assert.equal(decoded[4], '0x00000000')
        assert.equal(decoded[5], '0x')
        return iface.encodeFunctionResult('getFee', FEE)
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => Promise.resolve(parseTypeAndVersion(`${POOL_TYPE[family]} ${version}`)),
  } as unknown as EVMChain
}

const op = new GetFee()
const query = (chain: EVMChain, overrides: Partial<GetFeeParams> = {}) =>
  op.query(chain, { poolAddress: POOL, remoteChainSelector: SELECTOR, ...overrides })

describe('GetFee (cct/evm)', () => {
  describe('query', () => {
    for (const family of ['BurnMint', 'LockRelease'] as const) {
      it(`reads a ${family} v2.0.0 pool fee`, async () => {
        assert.deepEqual(await query(stubChain({ family })), {
          feeUSDCents: 10n,
          destGasOverhead: 100_000,
          destBytesOverhead: 32,
          tokenFeeBps: 25,
          isEnabled: true,
        })
      })
    }

    it('encodes requested finality', async () => {
      const chain = stubChain()
      chain.provider.call = async ({ data }: { data: string }) => {
        const decoded = IFACE.decodeFunctionData('getFee', data)
        assert.equal(decoded[4], '0x' + encodeFinality('safe').toString(16).padStart(8, '0'))
        return IFACE.encodeFunctionResult('getFee', FEE)
      }
      await query(chain, { finality: 'safe' })
    })
  })

  describe('validation', () => {
    for (const [overrides, param] of [
      [{ poolAddress: 'bad' }, 'poolAddress'],
      [{ remoteChainSelector: -1n }, 'remoteChainSelector'],
      [{ remoteChainSelector: 2n ** 64n }, 'remoteChainSelector'],
      [{ finality: 0 }, 'finality'],
    ] as const) {
      it(`rejects ${param} before RPC`, async () => {
        let called = false
        await assert.rejects(
          () => query(stubChain({ onCall: () => (called = true) }), overrides),
          (error: unknown) =>
            error instanceof CCTParamsInvalidError && error.context.param === param,
        )
        assert.equal(called, false)
      })
    }
  })

  describe('version', () => {
    it('rejects pre-v2.0.0 pools', async () => {
      await assert.rejects(
        () => query(stubChain({ version: TokenPoolVersion.V1_6_1 })),
        (error: unknown) =>
          error instanceof CCTOperationUnsupportedError &&
          error.context.version === TokenPoolVersion.V1_6_1,
      )
    })
  })
})
