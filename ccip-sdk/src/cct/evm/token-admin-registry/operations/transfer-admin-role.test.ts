import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface } from 'ethers'

import { TransferAdminRole } from './transfer-admin-role.ts'
import TokenAdminRegistryABI from '../../../../evm/abi/TokenAdminRegistry_1_5.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

const TOKEN = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'
const NEW_ADMIN = '0x1234567890AbcdEF1234567890aBcdef12345678'
const ROUTER = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59'
const TAR = '0xa3c796d480638d7476792230da1E2ADa86e031b0'
const stubChain = {
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  getTokenAdminRegistryFor: () => Promise.resolve(TAR),
} as unknown as EVMChain

describe('EVM cct transferAdminRole', () => {
  const op = new TransferAdminRole()

  it('encodes transferAdminRole against the resolved TAR — byte-identical to a direct ethers encode', async () => {
    const unsigned = await op.generate(stubChain, {
      tokenAddress: TOKEN,
      newAdmin: NEW_ADMIN,
      address: ROUTER,
    })
    const expected = new Interface(TokenAdminRegistryABI).encodeFunctionData('transferAdminRole', [
      TOKEN,
      NEW_ADMIN,
    ])
    assert.equal(unsigned.family, ChainFamily.EVM)
    assert.equal(unsigned.transactions[0]!.to, TAR)
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('applies sender to from', async () => {
    const unsigned = await op.generate(stubChain, {
      tokenAddress: TOKEN,
      newAdmin: NEW_ADMIN,
      address: ROUTER,
      sender: TOKEN,
    })
    assert.equal(unsigned.transactions[0]!.from, TOKEN)
  })

  it('rejects invalid newAdmin before RPC', async () => {
    await assert.rejects(
      () =>
        op.generate(stubChain, {
          tokenAddress: TOKEN,
          newAdmin: 'nope',
          address: ROUTER,
        }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'newAdmin',
    )
  })
})
