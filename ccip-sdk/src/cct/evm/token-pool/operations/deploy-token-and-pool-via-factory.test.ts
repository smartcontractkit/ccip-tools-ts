import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AbiCoder, ZeroAddress, concat } from 'ethers'

import { DeployTokenAndPoolViaFactory } from './deploy-token-and-pool-via-factory.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { CROSS_CHAIN_TOKEN_BYTECODE } from '../../token/bytecodes/CrossChainToken.ts'
import { BURN_MINT_TOKEN_POOL_BYTECODE } from '../bytecodes/BurnMintTokenPool.ts'
import { LOCK_RELEASE_TOKEN_POOL_BYTECODE } from '../bytecodes/LockReleaseTokenPool.ts'
import { FACTORY_POOL_TYPE, tokenPoolFactoryInterface } from '../token-pool-factory-abi.ts'

const FACTORY = '0x1111111111111111111111111111111111111111'
const OWNER = '0xdddddddddddddddddddddddddddddddddddddddd'
const RECIPIENT = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const SALT = '0x' + '22'.repeat(32)
const TOKEN_TUPLE =
  'tuple(string name, string symbol, uint256 maxSupply, uint256 preMint, address preMintRecipient, uint8 decimals, address ccipAdmin)'

/** Minimal stub chain — buildUnsigned is pure encoding (no RPC / staticCall). */
function stubChain(): EVMChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  } as unknown as EVMChain
}

/** Rebuilds the CrossChainToken init code the way the op does, for byte-parity checks. */
function tokenInitCode(
  ccipAdmin: string,
  burnMintRoleAdmin: string,
  futureOwner: string,
  preMint: bigint,
  preMintRecipient: string,
): string {
  const tokenArgs = AbiCoder.defaultAbiCoder().encode(
    [TOKEN_TUPLE, 'address', 'address'],
    [
      {
        name: 'My Token',
        symbol: 'MTK',
        maxSupply: 1000n,
        preMint,
        preMintRecipient,
        decimals: 18,
        ccipAdmin,
      },
      burnMintRoleAdmin,
      futureOwner,
    ],
  )
  return concat([CROSS_CHAIN_TOKEN_BYTECODE, tokenArgs])
}

describe('EVM cct deployTokenAndPoolViaFactory', () => {
  const op = new DeployTokenAndPoolViaFactory()

  it('burn-mint: byte-identical factory-call calldata; factory is ccipAdmin + role admin', async () => {
    const unsigned = await op.generate(stubChain(), {
      factoryAddress: FACTORY,
      name: 'My Token',
      symbol: 'MTK',
      decimals: 18,
      maxSupply: 1000n,
      poolType: 'burn-mint',
      salt: SALT,
      futureOwner: OWNER,
    })
    const expected = tokenPoolFactoryInterface.encodeFunctionData('deployTokenAndTokenPool', [
      [],
      18,
      FACTORY_POOL_TYPE['burn-mint'],
      tokenInitCode(FACTORY, FACTORY, OWNER, 0n, ZeroAddress),
      BURN_MINT_TOKEN_POOL_BYTECODE,
      ZeroAddress,
      SALT,
      OWNER,
    ])
    assert.equal(unsigned.family, ChainFamily.EVM)
    assert.equal(unsigned.transactions[0]!.to, FACTORY)
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('lock-release: role admin is futureOwner; pre-mint recipient defaults to futureOwner', async () => {
    const unsigned = await op.generate(stubChain(), {
      factoryAddress: FACTORY,
      name: 'My Token',
      symbol: 'MTK',
      decimals: 18,
      maxSupply: 1000n,
      preMint: 500n,
      poolType: 'lock-release',
      salt: SALT,
      futureOwner: OWNER,
    })
    const expected = tokenPoolFactoryInterface.encodeFunctionData('deployTokenAndTokenPool', [
      [],
      18,
      FACTORY_POOL_TYPE['lock-release'],
      tokenInitCode(FACTORY, OWNER, OWNER, 500n, OWNER),
      LOCK_RELEASE_TOKEN_POOL_BYTECODE,
      ZeroAddress,
      SALT,
      OWNER,
    ])
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('honours an explicit preMintRecipient when preMint > 0', async () => {
    const unsigned = await op.generate(stubChain(), {
      factoryAddress: FACTORY,
      name: 'My Token',
      symbol: 'MTK',
      decimals: 18,
      maxSupply: 1000n,
      preMint: 500n,
      preMintRecipient: RECIPIENT,
      poolType: 'burn-mint',
      salt: SALT,
      futureOwner: OWNER,
    })
    const expected = tokenPoolFactoryInterface.encodeFunctionData('deployTokenAndTokenPool', [
      [],
      18,
      FACTORY_POOL_TYPE['burn-mint'],
      tokenInitCode(FACTORY, FACTORY, OWNER, 500n, RECIPIENT),
      BURN_MINT_TOKEN_POOL_BYTECODE,
      ZeroAddress,
      SALT,
      OWNER,
    ])
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('requires futureOwner on the unsigned path', async () => {
    await assert.rejects(
      () =>
        op.generate(stubChain(), {
          factoryAddress: FACTORY,
          name: 'My Token',
          symbol: 'MTK',
          decimals: 18,
          maxSupply: 1000n,
          poolType: 'burn-mint',
          salt: SALT,
        }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'futureOwner',
    )
  })

  it('rejects preMint exceeding maxSupply', async () => {
    await assert.rejects(
      () =>
        op.generate(stubChain(), {
          factoryAddress: FACTORY,
          name: 'My Token',
          symbol: 'MTK',
          decimals: 18,
          maxSupply: 100n,
          preMint: 200n,
          poolType: 'burn-mint',
          futureOwner: OWNER,
        }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'preMint',
    )
  })

  it('rejects an empty symbol', async () => {
    await assert.rejects(
      () =>
        op.generate(stubChain(), {
          factoryAddress: FACTORY,
          name: 'My Token',
          symbol: '',
          decimals: 18,
          maxSupply: 1000n,
          poolType: 'burn-mint',
          futureOwner: OWNER,
        }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'symbol',
    )
  })
})
