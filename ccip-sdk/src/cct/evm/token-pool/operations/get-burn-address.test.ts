import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, makeError } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import {
  CCTContractTypeInvalidError,
  CCTOperationUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
import { GetBurnAddress } from './get-burn-address.ts'

const POOL = '0x' + '11'.repeat(20)
const BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD'

// Built from the Solidity signature, not the SDK's vendored ABI, so a wrong selector fails.
const ORACLE = new Interface(['function getBurnAddress() view returns (address burnAddress)'])

/** The reads the op makes, in order, as decoded function names (`typeAndVersion` included). */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/** EVMChain stub answering `typeAndVersion` and `getBurnAddress()` off the oracle interface. */
function stubChain({
  type = 'BurnToAddressTokenPool',
  version = '2.0.0',
  burnAddress = BURN_ADDRESS,
  seen = newSeen(),
}: {
  type?: string
  version?: string
  burnAddress?: string
  seen?: Seen
} = {}): EVMChain {
  return {
    provider: {
      call: ({ data }: { data: string }) => {
        const fn = ORACLE.getFunction(data.slice(0, 10))?.name
        if (fn !== 'getBurnAddress')
          throw makeError('execution reverted', 'CALL_EXCEPTION', {
            action: 'call',
            data: '0x',
            reason: null,
            transaction: { to: POOL, data },
            invocation: null,
            revert: null,
          })
        seen.calls.push(fn)
        return Promise.resolve(ORACLE.encodeFunctionResult(fn, [burnAddress]))
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      seen.calls.push('typeAndVersion')
      return Promise.resolve(parseTypeAndVersion(`${type} ${version}`))
    },
  } as unknown as EVMChain
}

const op = new GetBurnAddress()

describe('GetBurnAddress (cct/evm)', () => {
  // getBurnAddress() is the same view at every version BurnToAddress shipped at
  for (const version of ['1.5.1', '1.6.1', '2.0.0']) {
    it(`reads the burn address of a BurnToAddress ${version} pool`, async () => {
      const seen = newSeen()
      assert.equal(
        await op.query(stubChain({ version, seen }), { poolAddress: POOL }),
        BURN_ADDRESS,
      )
      assert.deepEqual(seen.calls, ['typeAndVersion', 'getBurnAddress'])
    })
  }

  it('checksums the address the pool returns', async () => {
    const chain = stubChain({ burnAddress: BURN_ADDRESS.toLowerCase() })
    assert.equal(await op.query(chain, { poolAddress: POOL }), BURN_ADDRESS)
  })

  it('rejects a malformed poolAddress before any RPC', async () => {
    const seen = newSeen()
    await assert.rejects(
      () => op.query(stubChain({ seen }), { poolAddress: 'not-an-address' }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'getBurnAddress' &&
        err.context.param === 'poolAddress',
    )
    assert.deepEqual(seen.calls, [])
  })

  it('rejects any other pool type before calling a getter it does not declare', async () => {
    const seen = newSeen()
    await assert.rejects(
      () => op.query(stubChain({ type: 'BurnMintTokenPool', seen }), { poolAddress: POOL }),
      (err: unknown) =>
        err instanceof CCTContractTypeInvalidError &&
        err.context.address === POOL &&
        err.context.actual === 'BurnMintTokenPool',
    )
    assert.deepEqual(seen.calls, ['typeAndVersion'])
  })

  it('rejects a 1.5.0 BurnToAddress pool, a version it never shipped at', async () => {
    const seen = newSeen()
    await assert.rejects(
      () => op.query(stubChain({ version: '1.5.0', seen }), { poolAddress: POOL }),
      (err: unknown) =>
        err instanceof CCTOperationUnsupportedError &&
        err.context.operation === 'getBurnAddress' &&
        err.context.version === '1.5.0',
    )
    assert.deepEqual(seen.calls, ['typeAndVersion'])
  })
})
