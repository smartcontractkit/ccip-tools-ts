import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type TransactionReceipt, AbiCoder, ZeroAddress, concat, dataLength } from 'ethers'

import { DeployToken } from './deploy-token.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { CROSS_CHAIN_TOKEN_BYTECODE } from '../bytecodes/CrossChainToken.ts'

const OWNER = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'
const TUPLE =
  'tuple(string name, string symbol, uint256 maxSupply, uint256 preMint, address preMintRecipient, uint8 decimals, address ccipAdmin)'
const stubChain = {
  logger: { debug() {}, info() {}, warn() {}, error() {} },
} as unknown as EVMChain

function expectedData(args: {
  name: string
  symbol: string
  maxSupply: bigint
  preMint: bigint
  preMintRecipient: string
  decimals: number
  ccipAdmin: string
  burnMintRoleAdmin: string
  owner: string
}) {
  const encoded = AbiCoder.defaultAbiCoder().encode(
    [TUPLE, 'address', 'address'],
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
      args.burnMintRoleAdmin,
      args.owner,
    ],
  )
  return concat([CROSS_CHAIN_TOKEN_BYTECODE, encoded])
}

describe('EVM cct deployToken', () => {
  const op = new DeployToken()

  it('encodes a no-premint deploy — byte-identical, to=null (creation)', async () => {
    const unsigned = await op.generate(stubChain, {
      name: 'My Token',
      symbol: 'MTK',
      decimals: 18,
      ownerAddress: OWNER,
    })
    const expected = expectedData({
      name: 'My Token',
      symbol: 'MTK',
      maxSupply: 0n,
      preMint: 0n,
      preMintRecipient: ZeroAddress, // zero exactly when preMint is 0
      decimals: 18,
      ccipAdmin: OWNER,
      burnMintRoleAdmin: OWNER,
      owner: OWNER,
    })
    assert.equal(unsigned.family, ChainFamily.EVM)
    assert.equal(unsigned.transactions[0]!.to, null)
    assert.equal(unsigned.transactions[0]!.data, expected)
    assert.ok(dataLength(unsigned.transactions[0]!.data) > 0)
  })

  it('defaults preMintRecipient to owner when preMint > 0', async () => {
    const unsigned = await op.generate(stubChain, {
      name: 'T',
      symbol: 'T',
      decimals: 8,
      initialSupply: 1000n,
      maxSupply: 5000n,
      ownerAddress: OWNER,
    })
    const expected = expectedData({
      name: 'T',
      symbol: 'T',
      maxSupply: 5000n,
      preMint: 1000n,
      preMintRecipient: OWNER,
      decimals: 8,
      ccipAdmin: OWNER,
      burnMintRoleAdmin: OWNER,
      owner: OWNER,
    })
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('requires ownerAddress on the unsigned path', async () => {
    await assert.rejects(
      () => op.generate(stubChain, { name: 'T', symbol: 'T', decimals: 18 }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'ownerAddress',
    )
  })

  it('signed deploy returns a verification handle with the exact encoded ctor args', async () => {
    const DEPLOYED = '0xbEEF000000000000000000000000000000000000'
    const receipt = { contractAddress: DEPLOYED, status: 1 } as unknown as TransactionReceipt
    const wallet = {
      signTransaction() {},
      getAddress: async () => OWNER,
      populateTransaction: async (tx: unknown) => tx,
      sendTransaction: async () => ({ hash: '0xhash', wait: async () => receipt }),
    }
    const chain = {
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      nextNonce: async () => 0,
      rollbackNonce() {},
      provider: {},
    } as unknown as EVMChain

    const result = await op.execute(chain, {
      name: 'My Token',
      symbol: 'MTK',
      decimals: 18,
      ownerAddress: OWNER,
      wallet,
    })

    const encodedArgs = AbiCoder.defaultAbiCoder().encode(
      [TUPLE, 'address', 'address'],
      [
        {
          name: 'My Token',
          symbol: 'MTK',
          maxSupply: 0n,
          preMint: 0n,
          preMintRecipient: ZeroAddress,
          decimals: 18,
          ccipAdmin: OWNER,
        },
        OWNER,
        OWNER,
      ],
    )
    assert.equal(result.tokenAddress, DEPLOYED)
    assert.deepEqual(result.verification, {
      contract: 'CrossChainToken',
      encodedConstructorArgs: encodedArgs,
    })
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
          ownerAddress: OWNER,
        }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'initialSupply',
    )
  })
})
