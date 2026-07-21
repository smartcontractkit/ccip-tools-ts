import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ZeroAddress, makeError } from 'ethers'

import { DeployToken } from './deploy-token.ts'
import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import crossChainBytecode from '../../artifacts/bytecode/V2_0_0/cross-chain-token.ts'

const SENDER = '0x' + '11'.repeat(20)
const OWNER = '0x' + '11'.repeat(20)
const CCIP_ADMIN = '0x' + '22'.repeat(20)
const ROLE_ADMIN = '0x' + '33'.repeat(20)
const PREMINT_RECIPIENT = '0x' + '44'.repeat(20)
const DEPLOYED = '0x' + '77'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

// Golden vector: a pinned constructor-arg encoding for the fixed inputs below. Independent of
// the SDK encoder — it guards CrossChainToken's init-code (bytecode + constructor) against drift.

// CrossChainToken ctor: ((name, symbol, maxSupply, preMint, preMintRecipient, decimals,
// ccipAdmin), burnMintRoleAdmin, owner).
const INPUTS = {
  name: 'CCIP Test Token',
  symbol: 'CCIPT',
  decimals: 18,
  maxSupply: 0n,
  preMint: 1000n,
  preMintRecipient: PREMINT_RECIPIENT,
  ccipAdmin: CCIP_ADMIN,
  burnMintRoleAdmin: ROLE_ADMIN,
  owner: OWNER,
}
const CTOR_ARGS =
  '0000000000000000000000000000000000000000000000000000000000000060' +
  '0000000000000000000000003333333333333333333333333333333333333333' +
  '0000000000000000000000001111111111111111111111111111111111111111' +
  '00000000000000000000000000000000000000000000000000000000000000e0' +
  '0000000000000000000000000000000000000000000000000000000000000120' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '00000000000000000000000000000000000000000000000000000000000003e8' +
  '0000000000000000000000004444444444444444444444444444444444444444' +
  '0000000000000000000000000000000000000000000000000000000000000012' +
  '0000000000000000000000002222222222222222222222222222222222222222' +
  '000000000000000000000000000000000000000000000000000000000000000f' +
  '43434950205465737420546f6b656e0000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000005' +
  '4343495054000000000000000000000000000000000000000000000000000000'
const DEPLOY_DATA = crossChainBytecode + CTOR_ARGS

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

describe('DeployToken (cct/evm)', () => {
  it('builds a deployment as init-code with no `to` (golden vector)', async () => {
    const unsigned = await new DeployToken().generate(stubChain(), { ...INPUTS, sender: SENDER })

    assert.equal(unsigned.family, ChainFamily.EVM)
    assert.equal(unsigned.transactions.length, 1)
    const tx = unsigned.transactions[0]!
    assert.equal(tx.to, undefined, 'deployment tx has no `to`')
    assert.equal(tx.from, SENDER)
    assert.ok(tx.data!.startsWith(crossChainBytecode), 'data starts with creation bytecode')
    assert.equal(tx.data, DEPLOY_DATA)
  })

  it('omits `from` when no sender is given', async () => {
    const unsigned = await new DeployToken().generate(stubChain(), INPUTS)
    assert.equal(unsigned.transactions[0]!.from, undefined)
  })

  it('defaults preMint to 0 and a zero preMintRecipient when both omitted', async () => {
    const { preMint: _preMint, preMintRecipient: _recipient, ...zeroPreMint } = INPUTS
    const unsigned = await new DeployToken().generate(stubChain(), zeroPreMint)
    // preMint 0 must pair with the zero address, else CrossChainToken's ctor reverts.
    const expected = DEPLOY_DATA.replace(
      '00000000000000000000000000000000000000000000000000000000000003e8',
      '0'.repeat(64),
    ).replace('0000000000000000000000004444444444444444444444444444444444444444', '0'.repeat(64))
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('defaults ccipAdmin/burnMintRoleAdmin to owner when omitted', async () => {
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
      ccipAdmin: OWNER,
      burnMintRoleAdmin: OWNER,
      owner: OWNER,
    })
    assert.equal(omitted.transactions[0]!.data, explicit.transactions[0]!.data)
  })

  it('rejects a missing preMintRecipient when preMint > 0', async () => {
    const { preMintRecipient: _recipient, ...withoutRecipient } = INPUTS
    await assert.rejects(
      () => new DeployToken().generate(stubChain(), withoutRecipient),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError && err.context.param === 'preMintRecipient',
    )
  })

  it('rejects a preMintRecipient when preMint is 0', async () => {
    await assert.rejects(
      () =>
        new DeployToken().generate(stubChain(), {
          ...INPUTS,
          preMint: 0n,
          preMintRecipient: PREMINT_RECIPIENT,
        }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError && err.context.param === 'preMintRecipient',
    )
  })

  it('rejects a zero-address preMintRecipient when preMint > 0', async () => {
    await assert.rejects(
      () => new DeployToken().generate(stubChain(), { ...INPUTS, preMintRecipient: ZeroAddress }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError && err.context.param === 'preMintRecipient',
    )
  })

  it('rejects an empty name, tagged with the operation and param', async () => {
    await assert.rejects(
      () => new DeployToken().generate(stubChain(), { ...INPUTS, name: '' }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'deployToken' &&
        err.context.param === 'name',
    )
  })

  it('rejects decimals outside 0–255', async () => {
    await assert.rejects(
      () => new DeployToken().generate(stubChain(), { ...INPUTS, decimals: 256 }),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'decimals',
    )
  })

  it('rejects a maxSupply above uint256 max', async () => {
    await assert.rejects(
      () => new DeployToken().generate(stubChain(), { ...INPUTS, maxSupply: 2n ** 256n }),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'maxSupply',
    )
  })

  it('rejects an invalid owner', async () => {
    await assert.rejects(
      () => new DeployToken().generate(stubChain(), { ...INPUTS, owner: 'nope' }),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'owner',
    )
  })

  it('rejects an invalid ccipAdmin', async () => {
    await assert.rejects(
      () => new DeployToken().generate(stubChain(), { ...INPUTS, ccipAdmin: 'nope' }),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'ccipAdmin',
    )
  })

  it('rejects preMint greater than a capped maxSupply', async () => {
    await assert.rejects(
      () => new DeployToken().generate(stubChain(), { ...INPUTS, maxSupply: 10n, preMint: 11n }),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'preMint',
    )
  })

  it('rejects an invalid sender', async () => {
    await assert.rejects(
      () => new DeployToken().generate(stubChain(), { ...INPUTS, sender: 'nope' }),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
    )
  })

  it('deploys and returns the tx hash and deployed address', async () => {
    const result = await new DeployToken().execute(stubChain(), {
      ...INPUTS,
      wallet: fakeSigner({ contractAddress: DEPLOYED }),
    })
    assert.deepEqual(result, { hash: HASH, contractAddress: DEPLOYED })
  })

  it('throws CCTTxFailedError when the receipt carries no contract address', async () => {
    await assert.rejects(
      () =>
        new DeployToken().execute(stubChain(), {
          ...INPUTS,
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
          ...INPUTS,
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
      () => new DeployToken().execute(stubChain(), { ...INPUTS, wallet: {} }),
      (err: unknown) => err instanceof CCIPWalletInvalidError,
    )
  })
})
