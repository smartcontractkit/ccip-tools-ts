import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AbiCoder, ZeroAddress, concat, dataLength } from 'ethers'

import { DeployCrossChainPoolToken } from './deploy-cross-chain-pool-token.ts'
import { CROSS_CHAIN_POOL_TOKEN_BYTECODE } from '../bytecodes/CrossChainPoolToken.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

const CCIP_ADMIN = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'
const ROUTER = '0xd7bf0e3d34b4c4f7d5f3c4c6b2a1e0f9c8b7a6d5'
const RMN_PROXY = '0xaabbccddeeff00112233445566778899aabbccdd'
const HOOKS = '0x1111111111111111111111111111111111111111'
const TUPLE =
  'tuple(string name, string symbol, uint256 maxSupply, uint256 preMint, address preMintRecipient, uint8 decimals, address ccipAdmin)'

// Stub chain whose provider answers Router.getArmProxy() with RMN_PROXY.
const stubChain = {
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  provider: {
    call: () => Promise.resolve(AbiCoder.defaultAbiCoder().encode(['address'], [RMN_PROXY])),
  },
} as unknown as EVMChain

function expectedData(args: {
  name: string
  symbol: string
  maxSupply: bigint
  preMint: bigint
  preMintRecipient: string
  decimals: number
  ccipAdmin: string
  advancedPoolHooks: string
  rmnProxy: string
  router: string
}) {
  const encoded = AbiCoder.defaultAbiCoder().encode(
    [TUPLE, 'address', 'address', 'address'],
    [
      {
        name: args.name,
        symbol: args.symbol,
        maxSupply: args.maxSupply,
        preMint: args.preMint,
        preMintRecipient: args.preMintRecipient,
        decimals: args.decimals,
        ccipAdmin: args.ccipAdmin,
      },
      args.advancedPoolHooks,
      args.rmnProxy,
      args.router,
    ],
  )
  return concat([CROSS_CHAIN_POOL_TOKEN_BYTECODE, encoded])
}

describe('EVM cct deployCrossChainPoolToken', () => {
  const op = new DeployCrossChainPoolToken()

  it('encodes a no-premint deploy — byte-identical, to=null (creation)', async () => {
    const unsigned = await op.generate(stubChain, {
      name: 'My Token',
      symbol: 'MTK',
      decimals: 18,
      routerAddress: ROUTER,
      ccipAdmin: CCIP_ADMIN,
    })
    const expected = expectedData({
      name: 'My Token',
      symbol: 'MTK',
      maxSupply: 0n,
      preMint: 0n,
      preMintRecipient: ZeroAddress, // zero exactly when preMint is 0
      decimals: 18,
      ccipAdmin: CCIP_ADMIN,
      advancedPoolHooks: ZeroAddress, // defaults to zero
      rmnProxy: RMN_PROXY,
      router: ROUTER,
    })
    assert.equal(unsigned.family, ChainFamily.EVM)
    assert.equal(unsigned.transactions.length, 1)
    assert.equal(unsigned.transactions[0]!.to, null)
    assert.equal(unsigned.transactions[0]!.data, expected)
    assert.ok(dataLength(unsigned.transactions[0]!.data) > 0)
  })

  it('defaults preMintRecipient to ccipAdmin when preMint > 0 and honors advancedPoolHooks', async () => {
    const unsigned = await op.generate(stubChain, {
      name: 'T',
      symbol: 'T',
      decimals: 8,
      initialSupply: 1000n,
      maxSupply: 5000n,
      routerAddress: ROUTER,
      ccipAdmin: CCIP_ADMIN,
      advancedPoolHooks: HOOKS,
    })
    const expected = expectedData({
      name: 'T',
      symbol: 'T',
      maxSupply: 5000n,
      preMint: 1000n,
      preMintRecipient: CCIP_ADMIN,
      decimals: 8,
      ccipAdmin: CCIP_ADMIN,
      advancedPoolHooks: HOOKS,
      rmnProxy: RMN_PROXY,
      router: ROUTER,
    })
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('requires ccipAdmin on the unsigned path', async () => {
    await assert.rejects(
      () => op.generate(stubChain, { name: 'T', symbol: 'T', decimals: 18, routerAddress: ROUTER }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'ccipAdmin',
    )
  })

  it('rejects an invalid routerAddress', async () => {
    await assert.rejects(
      () =>
        op.generate(stubChain, {
          name: 'T',
          symbol: 'T',
          decimals: 18,
          routerAddress: 'nope',
          ccipAdmin: CCIP_ADMIN,
        }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'routerAddress',
    )
  })

  it('rejects initialSupply > maxSupply', async () => {
    await assert.rejects(
      () =>
        op.generate(stubChain, {
          name: 'T',
          symbol: 'T',
          decimals: 18,
          maxSupply: 100n,
          initialSupply: 200n,
          routerAddress: ROUTER,
          ccipAdmin: CCIP_ADMIN,
        }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'initialSupply',
    )
  })
})
