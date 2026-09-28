import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { makeError } from 'ethers'

import type { EVMChain } from '../../../evm/index.ts'
import { parseTypeAndVersion } from '../../../utils.ts'
import { CCTContractTypeInvalidError } from '../../errors.ts'
import {
  ADVANCED_POOL_HOOKS_BYTECODE,
  assertAdvancedPoolHooksContract,
  getAdvancedPoolHooksArtifact,
} from './contracts.ts'

const HOOKS = '0x' + '44'.repeat(20)

describe('advanced-pool-hooks/contracts', () => {
  describe('getAdvancedPoolHooksArtifact', () => {
    it('names the contract as compiled and carries the creation bytecode', () => {
      const artifact = getAdvancedPoolHooksArtifact()
      assert.equal(artifact.contract, 'AdvancedPoolHooks')
      assert.equal(artifact.bytecode, ADVANCED_POOL_HOOKS_BYTECODE)
      assert.ok(artifact.bytecode.startsWith('0x'))
    })

    it('exposes the constructor the deploy op encodes against', () => {
      const ctor = getAdvancedPoolHooksArtifact().iface.deploy
      assert.deepEqual(
        ctor.inputs.map((i) => i.type),
        ['address[]', 'uint256', 'address', 'address[]'],
      )
    })
  })

  describe('assertAdvancedPoolHooksContract', () => {
    /** Answers only `typeAndVersion`; `null` makes it fail the way a code-less address does. */
    const probeChain = (typeAndVersion: string | null): EVMChain =>
      ({
        typeAndVersion: () =>
          typeAndVersion === null
            ? Promise.reject(makeError('could not decode result data', 'BAD_DATA'))
            : Promise.resolve(parseTypeAndVersion(typeAndVersion)),
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      }) as unknown as EVMChain

    it('accepts the canonical contract', async () => {
      await assertAdvancedPoolHooksContract(probeChain('AdvancedPoolHooks 2.0.0'), HOOKS)
    })

    it('accepts a newer version — the type is pinned, the version is not', async () => {
      await assertAdvancedPoolHooksContract(probeChain('AdvancedPoolHooks 2.1.0'), HOOKS)
    })

    it('rejects an address with no typeAndVersion, explaining it may have no code', async () => {
      await assert.rejects(
        () => assertAdvancedPoolHooksContract(probeChain(null), HOOKS),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError &&
          err.context.address === HOOKS &&
          err.context.expected === 'AdvancedPoolHooks' &&
          (err.context.reason as string).includes('no code'),
      )
    })

    it('rejects a different CCIP contract, reporting what it actually found', async () => {
      await assert.rejects(
        () => assertAdvancedPoolHooksContract(probeChain('LockReleaseTokenPool 2.0.0'), HOOKS),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError &&
          err.context.actual === 'LockReleaseTokenPool' &&
          !err.isTransient,
      )
    })
  })
})
