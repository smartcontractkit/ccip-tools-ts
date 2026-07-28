import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DeployToken } from './deploy-token.ts'
import { SENDER, stubChain } from './test-helpers.ts'
import { CCIPTokenDeployParamsInvalidError } from '../../../../errors/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

describe('Aptos ManagedToken deployToken', () => {
  it('rejects an empty name via validateParams (before any CLI compile)', async () => {
    await assert.rejects(
      () =>
        new DeployToken().generate(stubChain(), {
          name: '',
          symbol: 'MTK',
          decimals: 8,
          sender: SENDER,
        }),
      CCIPTokenDeployParamsInvalidError,
    )
  })

  it('rejects a negative initialSupply via validateParams', async () => {
    await assert.rejects(
      () =>
        new DeployToken().generate(stubChain(), {
          name: 'My Token',
          symbol: 'MTK',
          decimals: 8,
          initialSupply: -1n,
          sender: SENDER,
        }),
      CCIPTokenDeployParamsInvalidError,
    )
  })

  it('rejects non-integer decimals via the CCT front-check', async () => {
    await assert.rejects(
      () =>
        new DeployToken().generate(stubChain(), {
          name: 'My Token',
          symbol: 'MTK',
          decimals: -1,
          sender: SENDER,
        }),
      CCTParamsInvalidError,
    )
  })
})
