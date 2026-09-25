import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AbiCoder, Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import ADVANCED_POOL_HOOKS_V2_0_0_ABI from '../../artifacts/abi/V2_0_0/advanced-pool-hooks.ts'
import ADVANCED_POOL_HOOKS_V2_0_0 from '../../artifacts/bytecode/V2_0_0/advanced-pool-hooks.ts'
import { DeployAdvancedPoolHooks } from './deploy-advanced-pool-hooks.ts'

const SENDER = '0x' + '11'.repeat(20)
const POOL = '0x' + '22'.repeat(20)
const ALLOWED = '0x' + '33'.repeat(20)
const POLICY_ENGINE = '0x' + '44'.repeat(20)
const DEPLOYED = '0x' + '77'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

/**
 * Independent oracle: a fresh Interface built from the constructor signature alone, so the
 * golden vectors below never inherit a bug from the vendored ABI artifact.
 */
const ORACLE = new Interface([
  'constructor(address[] allowlist, uint256 thresholdAmountForAdditionalCCVs, address policyEngine, address[] authorizedCallers)',
])

const MINIMAL = {
  allowlist: [],
  thresholdAmount: 0n,
  policyEngine: ZeroAddress,
  authorizedCallers: [],
}
const POPULATED = {
  allowlist: [ALLOWED],
  thresholdAmount: 1_000n,
  policyEngine: POLICY_ENGINE,
  authorizedCallers: [POOL],
}

/** Minimal EVMChain stub — the deploy build path ignores it; execute uses only these. */
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

describe('DeployAdvancedPoolHooks (cct/evm advanced-pool-hooks operation)', () => {
  describe('generate (golden vector)', () => {
    it('builds the hooks contract as init-code with no `to`', async () => {
      const unsigned = await new DeployAdvancedPoolHooks().generate(stubChain(), {
        ...POPULATED,
        sender: SENDER,
      })

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, undefined, 'deployment tx has no `to`')
      assert.equal(tx.from, SENDER)
      assert.ok(
        tx.data!.startsWith(ADVANCED_POOL_HOOKS_V2_0_0),
        'data starts with creation bytecode',
      )
      const args = ORACLE.encodeDeploy([
        POPULATED.allowlist,
        POPULATED.thresholdAmount,
        POPULATED.policyEngine,
        POPULATED.authorizedCallers,
      ])
      assert.equal(tx.data, ADVANCED_POOL_HOOKS_V2_0_0 + args.slice(2))
    })

    it('encodes the all-defaults-off deployment (empty lists, zero policy engine)', async () => {
      const unsigned = await new DeployAdvancedPoolHooks().generate(stubChain(), MINIMAL)
      const args = ORACLE.encodeDeploy([[], 0n, ZeroAddress, []])
      assert.equal(unsigned.transactions[0]!.data, ADVANCED_POOL_HOOKS_V2_0_0 + args.slice(2))
    })

    it('defaults every omitted param to its disabled value', async () => {
      const unsigned = await new DeployAdvancedPoolHooks().generate(stubChain(), {})
      const args = ORACLE.encodeDeploy([[], 0n, ZeroAddress, []])
      assert.equal(unsigned.transactions[0]!.data, ADVANCED_POOL_HOOKS_V2_0_0 + args.slice(2))
    })

    it('defaults only the omitted params when some are given', async () => {
      const unsigned = await new DeployAdvancedPoolHooks().generate(stubChain(), {
        authorizedCallers: [POOL],
      })
      const args = ORACLE.encodeDeploy([[], 0n, ZeroAddress, [POOL]])
      assert.equal(unsigned.transactions[0]!.data, ADVANCED_POOL_HOOKS_V2_0_0 + args.slice(2))
    })

    it('encodes ctor args identically through the vendored ABI and the signature oracle', async () => {
      const vendored = new Interface(ADVANCED_POOL_HOOKS_V2_0_0_ABI).encodeDeploy([
        POPULATED.allowlist,
        POPULATED.thresholdAmount,
        POPULATED.policyEngine,
        POPULATED.authorizedCallers,
      ])
      assert.equal(
        vendored,
        ORACLE.encodeDeploy([
          POPULATED.allowlist,
          POPULATED.thresholdAmount,
          POPULATED.policyEngine,
          POPULATED.authorizedCallers,
        ]),
      )
    })

    it('omits `from` when no sender is given', async () => {
      const unsigned = await new DeployAdvancedPoolHooks().generate(stubChain(), MINIMAL)
      assert.equal(unsigned.transactions[0]!.from, undefined)
    })
  })

  describe('validation', () => {
    const rejects = async (params: object, param: string) =>
      assert.rejects(
        () => new DeployAdvancedPoolHooks().generate(stubChain(), params as never),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'deployAdvancedPoolHooks' &&
          err.context.param === param,
      )

    it('rejects a non-array allowlist', () =>
      rejects({ ...MINIMAL, allowlist: ALLOWED }, 'allowlist'))

    it('rejects a non-array authorizedCallers', () =>
      rejects({ ...MINIMAL, authorizedCallers: POOL }, 'authorizedCallers'))

    it('blames the offending allowlist entry by index', () =>
      rejects({ ...MINIMAL, allowlist: [ALLOWED, 'nope'] }, 'allowlist[1]'))

    it('rejects the zero address in the allowlist, which would enable an empty allowlist forever', () =>
      rejects({ ...MINIMAL, allowlist: [ZeroAddress] }, 'allowlist[0]'))

    it('rejects the zero address in authorizedCallers, which reverts in the constructor', () =>
      rejects({ ...MINIMAL, authorizedCallers: [POOL, ZeroAddress] }, 'authorizedCallers[1]'))

    it('rejects duplicates in the allowlist — the EnumerableSet drops the repeat', () =>
      rejects({ ...MINIMAL, allowlist: [ALLOWED, ALLOWED] }, 'allowlist'))

    it('rejects duplicates in authorizedCallers', () =>
      rejects({ ...MINIMAL, authorizedCallers: [POOL, POOL] }, 'authorizedCallers'))

    it('compares duplicates checksummed, matching the on-chain set', () =>
      rejects(
        { ...MINIMAL, allowlist: [ALLOWED, ALLOWED.toUpperCase().replace('0X', '0x')] },
        'allowlist',
      ))

    it('rejects a non-bigint thresholdAmount', () =>
      rejects({ ...MINIMAL, thresholdAmount: 1000 }, 'thresholdAmount'))

    it('rejects a negative thresholdAmount', () =>
      rejects({ ...MINIMAL, thresholdAmount: -1n }, 'thresholdAmount'))

    it('rejects an invalid policyEngine', () =>
      rejects({ ...MINIMAL, policyEngine: 'nope' }, 'policyEngine'))

    it('accepts the zero policyEngine, which disables policy checks', async () => {
      await new DeployAdvancedPoolHooks().generate(stubChain(), {
        ...POPULATED,
        policyEngine: ZeroAddress,
      })
    })

    it('rejects an invalid sender', () => rejects({ ...MINIMAL, sender: 'nope' }, 'sender'))
  })

  describe('execute', () => {
    it('returns the hash, deployed address, and explorer verification input', async () => {
      const result = await new DeployAdvancedPoolHooks().execute(stubChain(), {
        ...POPULATED,
        wallet: fakeSigner({ contractAddress: DEPLOYED }),
      })

      assert.equal(result.hash, HASH)
      assert.equal(result.contractAddress, DEPLOYED)
      assert.equal(result.verification.contract, 'AdvancedPoolHooks')
      // The verification args must decode back to exactly what was deployed, or an explorer
      // submission built from them would not match the deployed bytecode.
      const [allowlist, thresholdAmount, policyEngine, authorizedCallers] =
        AbiCoder.defaultAbiCoder().decode(
          ['address[]', 'uint256', 'address', 'address[]'],
          result.verification.encodedConstructorArgs,
        ) as unknown as [string[], bigint, string, string[]]
      assert.deepEqual([...allowlist], POPULATED.allowlist)
      assert.equal(thresholdAmount, POPULATED.thresholdAmount)
      assert.equal(policyEngine, POPULATED.policyEngine)
      assert.deepEqual([...authorizedCallers], POPULATED.authorizedCallers)
    })

    it('throws CCTTxFailedError when the receipt carries no contract address', async () => {
      await assert.rejects(
        () =>
          new DeployAdvancedPoolHooks().execute(stubChain(), {
            ...MINIMAL,
            wallet: fakeSigner({ contractAddress: null }),
          }),
        (err: unknown) =>
          err instanceof CCTTxFailedError &&
          err.context.operation === 'deployAdvancedPoolHooks' &&
          !err.isTransient,
      )
    })

    it('throws CCIPExecTxRevertedError when the deployment reverts on-chain', async () => {
      await assert.rejects(
        () =>
          new DeployAdvancedPoolHooks().execute(stubChain(), {
            ...MINIMAL,
            wallet: fakeSigner({ waitError: makeError('execution reverted', 'CALL_EXCEPTION') }),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError &&
          err.context.operation === 'deployAdvancedPoolHooks',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => new DeployAdvancedPoolHooks().execute(stubChain(), { ...MINIMAL, wallet: {} }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })
  })
})
