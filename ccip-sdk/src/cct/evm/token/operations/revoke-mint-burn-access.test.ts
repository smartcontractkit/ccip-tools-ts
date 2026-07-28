import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, id } from 'ethers'

import { RevokeMintBurnAccess } from './revoke-mint-burn-access.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import CrossChainTokenABI from '../../../../evm/abi/CrossChainToken.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

const TOKEN = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'
const AUTHORITY = '0xa3c796d480638d7476792230da1E2ADa86e031b0'
const MINTER_ROLE = id('MINTER_ROLE')
const BURNER_ROLE = id('BURNER_ROLE')
const canonical = new Interface(CrossChainTokenABI)
const stubChain = {
  logger: { debug() {}, info() {}, warn() {}, error() {} },
} as unknown as EVMChain

describe('EVM cct revokeMintBurnAccess', () => {
  const op = new RevokeMintBurnAccess()

  it('encodes revokeRole(MINTER_ROLE, authority) for role=mint', async () => {
    const unsigned = await op.generate(stubChain, {
      tokenAddress: TOKEN,
      authority: AUTHORITY,
      role: 'mint',
    })
    const expected = canonical.encodeFunctionData('revokeRole', [MINTER_ROLE, AUTHORITY])
    assert.equal(unsigned.family, ChainFamily.EVM)
    assert.equal(unsigned.transactions[0]!.to, TOKEN)
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('encodes revokeRole(BURNER_ROLE, authority) for role=burn', async () => {
    const unsigned = await op.generate(stubChain, {
      tokenAddress: TOKEN,
      authority: AUTHORITY,
      role: 'burn',
    })
    const expected = canonical.encodeFunctionData('revokeRole', [BURNER_ROLE, AUTHORITY])
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('applies sender to from', async () => {
    const unsigned = await op.generate(stubChain, {
      tokenAddress: TOKEN,
      authority: AUTHORITY,
      role: 'mint',
      sender: AUTHORITY,
    })
    assert.equal(unsigned.transactions[0]!.from, AUTHORITY)
  })

  it('rejects invalid tokenAddress before RPC', async () => {
    await assert.rejects(
      () => op.generate(stubChain, { tokenAddress: 'nope', authority: AUTHORITY, role: 'mint' }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'tokenAddress',
    )
  })

  it('rejects invalid authority before RPC', async () => {
    await assert.rejects(
      () => op.generate(stubChain, { tokenAddress: TOKEN, authority: 'nope', role: 'mint' }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'authority',
    )
  })
})
