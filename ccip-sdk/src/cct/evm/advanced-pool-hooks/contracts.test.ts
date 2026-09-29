import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { makeError } from 'ethers'

import type { EVMChain } from '../../../evm/index.ts'
import { parseTypeAndVersion } from '../../../utils.ts'
import { CCTContractTypeInvalidError, CCTParamsInvalidError } from '../../errors.ts'
import {
  ADVANCED_POOL_HOOKS_BYTECODE,
  ADVANCED_POOL_HOOKS_INTERFACE,
  assertAdvancedPoolHooksContract,
  assertAdvancedPoolHooksOwner,
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

  describe('assertAdvancedPoolHooksOwner', () => {
    const OWNER = '0x' + 'ab'.repeat(20) // lower-case: the comparison must checksum it

    /** Answers only the hooks' `owner()`, recording where the call went. */
    const ownerChain = (seen: string[] = []): EVMChain =>
      ({
        provider: {
          call: ({ to, data }: { to: string; data: string }) => {
            seen.push(to.toLowerCase())
            if (data.startsWith(ADVANCED_POOL_HOOKS_INTERFACE.getFunction('owner')!.selector))
              return Promise.resolve(
                ADVANCED_POOL_HOOKS_INTERFACE.encodeFunctionResult('owner', [OWNER]),
              )
            return Promise.reject(makeError('execution reverted', 'CALL_EXCEPTION'))
          },
        },
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      }) as unknown as EVMChain

    it('accepts the hooks owner, compared checksummed, reading owner() on the hooks', async () => {
      const seen: string[] = []
      await assertAdvancedPoolHooksOwner('op', ownerChain(seen), HOOKS, OWNER)
      assert.deepEqual(seen, [HOOKS])
    })

    it('rejects any other sender as a sender param error', async () => {
      await assert.rejects(
        () => assertAdvancedPoolHooksOwner('op', ownerChain(), HOOKS, '0x' + '99'.repeat(20)),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'op' &&
          err.context.param === 'sender' &&
          err.message.includes('AdvancedPoolHooks owner'),
      )
    })
  })
})
