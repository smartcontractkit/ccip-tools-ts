import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getMintBurnRoles } from './get-mint-burn-roles.ts'
import type { AptosChain } from '../../../aptos/index.ts'

const TOKEN = '0x0000000000000000000000000000000000000000000000000000000089fd6b14'

/**
 * Stub whose `provider.view` returns a single address for `0x1::object::owner`
 * lookups and a member list for the managed-token role view functions.
 */
function stubChain(): AptosChain {
  const provider = {
    async view({ payload }: { payload: { function: string } }) {
      if (payload.function.endsWith('::managed_token::get_allowed_minters')) {
        return [['0x000000000000000000000000000000000000000000000000000000000000aaaa']]
      }
      if (payload.function.endsWith('::managed_token::get_allowed_burners')) {
        return [['0x000000000000000000000000000000000000000000000000000000000000bbbb']]
      }
      // 0x1::object::owner lookups (code-object resolution + owner).
      return ['0x000000000000000000000000000000000000000000000000000000000000code']
    },
  }
  return {
    provider,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  } as unknown as AptosChain
}

describe('Aptos token getMintBurnRoles', () => {
  it('reads managed-token minter/burner allowlists', async () => {
    const roles = await getMintBurnRoles(stubChain(), TOKEN)

    assert.equal(roles.tokenModule, 'managed')
    assert.deepEqual(roles.allowedMinters, [
      '0x000000000000000000000000000000000000000000000000000000000000aaaa',
    ])
    assert.deepEqual(roles.allowedBurners, [
      '0x000000000000000000000000000000000000000000000000000000000000bbbb',
    ])
    assert.equal(roles.owner, '0x000000000000000000000000000000000000000000000000000000000000code')
  })
})
