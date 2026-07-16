import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { makeError } from 'ethers'

import { type DeployTokenParams, DeployToken } from './deploy-token.ts'
import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import factoryBytecode from '../../artifacts/bytecode/V1_5_1/factory-burn-mint-erc20.ts'
import factoryBytecodeV1_6_2 from '../../artifacts/bytecode/V1_6_2/factory-burn-mint-erc20.ts'
import crossChainBytecode from '../../artifacts/bytecode/V2_0_0/cross-chain-token.ts'

const SENDER = '0x' + '11'.repeat(20)
const OWNER = '0x' + '11'.repeat(20)
const CCIP_ADMIN = '0x' + '22'.repeat(20)
const ROLE_ADMIN = '0x' + '33'.repeat(20)
const PREMINT_RECIPIENT = '0x' + '44'.repeat(20)
const DEPLOYED = '0x' + '77'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

// Golden vectors: pinned constructor-arg encodings for the fixed inputs below. Independent of
// the SDK encoder — they guard each version's init-code (bytecode + constructor) against drift.

// CrossChainToken v2.0.0 — ctor ((name, symbol, maxSupply, preMint, preMintRecipient, decimals,
// ccipAdmin), burnMintRoleAdmin, owner). This is the default when `version` is omitted.
const V2_INPUTS = {
  name: 'CCIP Test Token',
  symbol: 'CCIPT',
  decimals: 18,
  maxSupply: 0n,
  preMint: 0n,
  preMintRecipient: PREMINT_RECIPIENT,
  ccipAdmin: CCIP_ADMIN,
  burnMintRoleAdmin: ROLE_ADMIN,
  owner: OWNER,
}
const V2_CTOR_ARGS =
  '0000000000000000000000000000000000000000000000000000000000000060' +
  '0000000000000000000000003333333333333333333333333333333333333333' +
  '0000000000000000000000001111111111111111111111111111111111111111' +
  '00000000000000000000000000000000000000000000000000000000000000e0' +
  '0000000000000000000000000000000000000000000000000000000000000120' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000004444444444444444444444444444444444444444' +
  '0000000000000000000000000000000000000000000000000000000000000012' +
  '0000000000000000000000002222222222222222222222222222222222222222' +
  '000000000000000000000000000000000000000000000000000000000000000f' +
  '43434950205465737420546f6b656e0000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000005' +
  '4343495054000000000000000000000000000000000000000000000000000000'
const V2_DEPLOY_DATA = crossChainBytecode + V2_CTOR_ARGS

// FactoryBurnMintERC20 v1.5.1 — ctor (name, symbol, decimals, maxSupply, preMint, owner).
const V1_INPUTS = {
  version: '1.5.1' as const,
  name: 'CCIP Test Token',
  symbol: 'CCIPT',
  decimals: 18,
  maxSupply: 0n,
  preMint: 0n,
  owner: OWNER,
}
const V1_CTOR_ARGS =
  '00000000000000000000000000000000000000000000000000000000000000c0' +
  '0000000000000000000000000000000000000000000000000000000000000100' +
  '0000000000000000000000000000000000000000000000000000000000000012' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000001111111111111111111111111111111111111111' +
  '000000000000000000000000000000000000000000000000000000000000000f' +
  '43434950205465737420546f6b656e0000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000005' +
  '4343495054000000000000000000000000000000000000000000000000000000'
const V1_DEPLOY_DATA = factoryBytecode + V1_CTOR_ARGS

/** Minimal EVMChain stub — deployToken's build path ignores it; execute uses only these. */
function stubChain(): EVMChain {
  return {
    provider: {} as never,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    nextNonce: async () => 0,
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

/** Fake ethers Signer whose deployment receipt carries `contractAddress`. */
function fakeSigner(opts: { contractAddress?: string | null; waitError?: Error }) {
  return {
    signTransaction: () => Promise.resolve('0x'),
    getAddress: () => Promise.resolve(SENDER),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: () =>
      Promise.resolve({
        hash: HASH,
        wait: () =>
          opts.waitError
            ? Promise.reject(opts.waitError)
            : Promise.resolve({
                status: 1,
                contractAddress:
                  opts.contractAddress === undefined ? DEPLOYED : opts.contractAddress,
              }),
      }),
  }
}

describe('DeployToken — CrossChainToken (v2.0.0, default)', () => {
  it('builds a deployment as init-code with no `to` (golden vector, version omitted)', async () => {
    const unsigned = await new DeployToken().generate(stubChain(), { ...V2_INPUTS, sender: SENDER })

    assert.equal(unsigned.family, ChainFamily.EVM)
    assert.equal(unsigned.transactions.length, 1)
    const tx = unsigned.transactions[0]!
    assert.equal(tx.to, undefined, 'deployment tx has no `to`')
    assert.equal(tx.from, SENDER)
    assert.ok(tx.data!.startsWith(crossChainBytecode), 'data starts with creation bytecode')
    assert.equal(tx.data, V2_DEPLOY_DATA)
  })

  it('deploys the same data whether version is omitted or set to 2.0.0', async () => {
    const omitted = await new DeployToken().generate(stubChain(), V2_INPUTS)
    const explicit = await new DeployToken().generate(stubChain(), {
      ...V2_INPUTS,
      version: '2.0.0',
    })
    assert.equal(omitted.transactions[0]!.data, explicit.transactions[0]!.data)
  })

  it('defaults preMintRecipient/ccipAdmin/burnMintRoleAdmin to owner when omitted', async () => {
    const omitted = await new DeployToken().generate(stubChain(), {
      name: 'CCIP Test Token',
      symbol: 'CCIPT',
      decimals: 18,
      maxSupply: 0n,
      owner: OWNER,
    })
    const explicit = await new DeployToken().generate(stubChain(), {
      name: 'CCIP Test Token',
      symbol: 'CCIPT',
      decimals: 18,
      maxSupply: 0n,
      preMint: 0n,
      preMintRecipient: OWNER,
      ccipAdmin: OWNER,
      burnMintRoleAdmin: OWNER,
      owner: OWNER,
    })
    assert.equal(omitted.transactions[0]!.data, explicit.transactions[0]!.data)
  })

  it('rejects an invalid owner', async () => {
    await assert.rejects(
      () => new DeployToken().generate(stubChain(), { ...V2_INPUTS, owner: 'nope' }),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'owner',
    )
  })

  it('rejects an invalid ccipAdmin', async () => {
    await assert.rejects(
      () => new DeployToken().generate(stubChain(), { ...V2_INPUTS, ccipAdmin: 'nope' }),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'ccipAdmin',
    )
  })

  it('rejects preMint greater than a capped maxSupply', async () => {
    await assert.rejects(
      () => new DeployToken().generate(stubChain(), { ...V2_INPUTS, maxSupply: 10n, preMint: 11n }),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'preMint',
    )
  })

  it('rejects an invalid sender', async () => {
    await assert.rejects(
      () => new DeployToken().generate(stubChain(), { ...V2_INPUTS, sender: 'nope' }),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
    )
  })

  it('rejects an unsupported version', async () => {
    await assert.rejects(
      () =>
        new DeployToken().generate(stubChain(), {
          ...V2_INPUTS,
          version: '9.9.9',
        } as unknown as DeployTokenParams),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'version',
    )
  })

  it('deploys and returns the tx hash and deployed address', async () => {
    const result = await new DeployToken().execute(stubChain(), {
      ...V2_INPUTS,
      wallet: fakeSigner({ contractAddress: DEPLOYED }),
    })
    assert.deepEqual(result, { hash: HASH, address: DEPLOYED })
  })

  it('throws CCTTxFailedError when the receipt carries no contract address', async () => {
    await assert.rejects(
      () =>
        new DeployToken().execute(stubChain(), {
          ...V2_INPUTS,
          wallet: fakeSigner({ contractAddress: null }),
        }),
      (err: unknown) =>
        err instanceof CCTTxFailedError &&
        err.context.operation === 'deployToken' &&
        !err.isTransient,
    )
  })

  it('throws CCIPExecTxRevertedError when the deployment reverts on-chain', async () => {
    await assert.rejects(
      () =>
        new DeployToken().execute(stubChain(), {
          ...V2_INPUTS,
          wallet: fakeSigner({ waitError: makeError('execution reverted', 'CALL_EXCEPTION') }),
        }),
      (err: unknown) =>
        err instanceof CCIPExecTxRevertedError &&
        err.context.operation === 'deployToken' &&
        err.context.txHash === HASH,
    )
  })

  it('rejects a non-signer wallet', async () => {
    await assert.rejects(
      () => new DeployToken().execute(stubChain(), { ...V2_INPUTS, wallet: {} }),
      (err: unknown) => err instanceof CCIPWalletInvalidError,
    )
  })
})

describe('DeployToken — FactoryBurnMintERC20 (v1.5.1)', () => {
  it('builds a deployment as init-code with no `to` (golden vector)', async () => {
    const unsigned = await new DeployToken().generate(stubChain(), { ...V1_INPUTS, sender: SENDER })

    const tx = unsigned.transactions[0]!
    assert.equal(tx.to, undefined, 'deployment tx has no `to`')
    assert.equal(tx.from, SENDER)
    assert.ok(tx.data!.startsWith(factoryBytecode), 'data starts with creation bytecode')
    assert.equal(tx.data, V1_DEPLOY_DATA)
  })

  it('omits `from` when no sender is given', async () => {
    const unsigned = await new DeployToken().generate(stubChain(), V1_INPUTS)
    assert.equal(unsigned.transactions[0]!.from, undefined)
  })

  it('deploys FactoryBurnMintERC20 at v1.6.2 (same ctor args, 1.6.2 bytecode)', async () => {
    const unsigned = await new DeployToken().generate(stubChain(), {
      ...V1_INPUTS,
      version: '1.6.2',
    })
    assert.equal(unsigned.transactions[0]!.data, factoryBytecodeV1_6_2 + V1_CTOR_ARGS)
  })

  it('defaults preMint to 0n when omitted', async () => {
    const { preMint: _preMint, ...withoutPreMint } = V1_INPUTS
    const unsigned = await new DeployToken().generate(stubChain(), withoutPreMint)
    assert.equal(unsigned.transactions[0]!.data, V1_DEPLOY_DATA)
  })

  it('rejects an empty name, tagged with the operation and param', async () => {
    await assert.rejects(
      () => new DeployToken().generate(stubChain(), { ...V1_INPUTS, name: '' }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'deployToken' &&
        err.context.param === 'name',
    )
  })

  it('rejects decimals outside 0–255', async () => {
    await assert.rejects(
      () => new DeployToken().generate(stubChain(), { ...V1_INPUTS, decimals: 256 }),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'decimals',
    )
  })

  it('rejects a maxSupply above uint256 max', async () => {
    await assert.rejects(
      () => new DeployToken().generate(stubChain(), { ...V1_INPUTS, maxSupply: 2n ** 256n }),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'maxSupply',
    )
  })

  it('deploys and returns the tx hash and deployed address', async () => {
    const result = await new DeployToken().execute(stubChain(), {
      ...V1_INPUTS,
      wallet: fakeSigner({ contractAddress: DEPLOYED }),
    })
    assert.deepEqual(result, { hash: HASH, address: DEPLOYED })
  })
})
