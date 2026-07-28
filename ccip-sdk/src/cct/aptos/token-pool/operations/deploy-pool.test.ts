import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DeployPool } from './deploy-pool.ts'
import type { AptosChain } from '../../../../aptos/index.ts'
import {
  CCIPPoolDeployParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../../../errors/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

/** A test sender address (32-byte hex). */
const SENDER = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

/** A test fungible-asset metadata address. */
const TOKEN = '0x00000000000000000000000000000000000000000000000000000000deadbeef'

/** A minimal chain stub — validation rejects before any RPC/CLI is reached. */
const chain = {} as unknown as AptosChain

describe('Aptos TokenPool deployPool', () => {
  it('rejects an empty tokenAddress with CCTParamsInvalidError before any RPC', async () => {
    await assert.rejects(
      () =>
        new DeployPool().generate(chain, {
          poolType: 'burn-mint',
          tokenAddress: '',
          localTokenDecimals: 8,
          routerAddress: '0xabc',
          mcmsAddress: '0x123',
          sender: SENDER,
        }),
      CCTParamsInvalidError,
    )
  })

  it('rejects an invalid poolType via validatePoolParams', async () => {
    await assert.rejects(
      () =>
        new DeployPool().generate(chain, {
          // @ts-expect-error deliberately invalid poolType for the rejection path
          poolType: 'nope',
          tokenAddress: TOKEN,
          localTokenDecimals: 8,
          routerAddress: '0xabc',
          mcmsAddress: '0x123',
          sender: SENDER,
        }),
      CCIPPoolDeployParamsInvalidError,
    )
  })

  it('rejects a non-Aptos wallet on execute with CCIPWalletInvalidError', async () => {
    await assert.rejects(
      () =>
        new DeployPool().execute(chain, {
          poolType: 'burn-mint',
          tokenAddress: TOKEN,
          localTokenDecimals: 8,
          routerAddress: '0xabc',
          mcmsAddress: '0x123',
          wallet: {},
        }),
      CCIPWalletInvalidError,
    )
  })
})
