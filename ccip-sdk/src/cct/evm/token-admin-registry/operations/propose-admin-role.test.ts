import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface } from 'ethers'

import { ProposeAdminRole } from './propose-admin-role.ts'
import RegistryModuleOwnerCustomABI from '../../../../evm/abi/RegistryModuleOwnerCustom_1_6.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

const TOKEN = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'
const REGISTRY = '0xa3c796d480638d7476792230da1E2ADa86e031b0'
const stubChain = {
  logger: { debug() {}, info() {}, warn() {}, error() {} },
} as unknown as EVMChain

describe('EVM cct proposeAdminRole', () => {
  const op = new ProposeAdminRole()

  it('encodes registerAdminViaOwner by default — byte-identical to a direct ethers encode', async () => {
    const unsigned = await op.generate(stubChain, {
      tokenAddress: TOKEN,
      registryModuleAddress: REGISTRY,
    })
    const expected = new Interface(RegistryModuleOwnerCustomABI).encodeFunctionData(
      'registerAdminViaOwner',
      [TOKEN],
    )
    assert.equal(unsigned.family, ChainFamily.EVM)
    assert.equal(unsigned.transactions[0]!.to, REGISTRY)
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('selects the function for each registration method', async () => {
    for (const [method, fn] of [
      ['getCCIPAdmin', 'registerAdminViaGetCCIPAdmin'],
      ['accessControlDefaultAdmin', 'registerAccessControlDefaultAdmin'],
    ] as const) {
      const unsigned = await op.generate(stubChain, {
        tokenAddress: TOKEN,
        registryModuleAddress: REGISTRY,
        registrationMethod: method,
      })
      const expected = new Interface(RegistryModuleOwnerCustomABI).encodeFunctionData(fn, [TOKEN])
      assert.equal(unsigned.transactions[0]!.data, expected)
    }
  })

  it('applies sender to from', async () => {
    const unsigned = await op.generate(stubChain, {
      tokenAddress: TOKEN,
      registryModuleAddress: REGISTRY,
      sender: TOKEN,
    })
    assert.equal(unsigned.transactions[0]!.from, TOKEN)
  })

  it('rejects invalid addresses before RPC', async () => {
    await assert.rejects(
      () => op.generate(stubChain, { tokenAddress: 'nope', registryModuleAddress: REGISTRY }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'tokenAddress',
    )
  })
})
