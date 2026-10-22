import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { describe, it } from 'node:test'

import {
  type InterfaceAbi,
  type TransactionRequest,
  ErrorFragment,
  Interface,
  id,
  makeError,
} from 'ethers'

import type { EVMChain } from '../../evm/index.ts'
import type { UnsignedEVMTx } from '../../evm/types.ts'
import { ChainFamily } from '../../networks.ts'
import { CCTParamsInvalidError } from '../errors.ts'
import { simulateEVMTx } from './simulate.ts'

const POOL = '0x' + '11'.repeat(20)
const SENDER = '0x' + '22'.repeat(20)
const SAFE = '0x' + '33'.repeat(20)
const ROLE = '0x' + 'ab'.repeat(32)

/** One-tx unsigned call from {@link SENDER}, as a builder given `sender` returns it. */
function unsignedCall(tx: TransactionRequest = { to: POOL, data: '0x1234', from: SENDER }) {
  return { family: ChainFamily.EVM, transactions: [tx] } satisfies UnsignedEVMTx
}

/** ethers' shape for an `eth_call` revert: a `CALL_EXCEPTION` carrying the revert `data`. */
function callException(data: string | null): Error {
  return Object.assign(makeError('execution reverted', 'CALL_EXCEPTION'), { data })
}

/** Stub chain whose `provider.call` resolves to `0x` or rejects with `error`, recording calls. */
function stubChain(error?: Error) {
  const calls: TransactionRequest[] = []
  const chain = {
    provider: {
      call: (tx: TransactionRequest) => {
        calls.push(tx)
        return error ? Promise.reject(error) : Promise.resolve('0x')
      },
    },
  } as unknown as EVMChain
  return { chain, calls }
}

describe('simulateEVMTx', () => {
  it('returns success and calls with the tx to, data and from when the call does not revert', async () => {
    const { chain, calls } = stubChain()
    assert.deepEqual(await simulateEVMTx(chain, unsignedCall()), { success: true })
    assert.deepEqual(calls, [{ to: POOL, data: '0x1234', from: SENDER, value: undefined }])
  })

  it('simulates a deploy tx without `to`, so the node runs the init code as a CREATE', async () => {
    const { chain, calls } = stubChain()
    const unsigned = unsignedCall({ data: '0x6080', from: SENDER })
    assert.deepEqual(await simulateEVMTx(chain, unsigned), { success: true })
    // deepEqual is strict on keys, so a `to: undefined` left in the request fails too
    assert.deepEqual(calls, [{ data: '0x6080', from: SENDER, value: undefined }])
  })

  // Errors only the named contract declares, built from a signature literal (not the SDK's ABI).
  // After the revert string, the pool ones are what TMEM's BurnMintTokenPool-only decoder misses;
  // the factory and RegistryModuleOwnerCustom ones are missing from core `parseWithFragment`.
  const testCases = [
    {
      contract: 'Solidity revert string',
      signature: 'error Error(string)',
      args: ['amount exceeds balance'],
      errorArgs: { 0: 'amount exceeds balance' },
    },
    {
      contract: 'LockReleaseTokenPool 1.6.1',
      signature: 'error InsufficientLiquidity()',
      args: [],
      errorArgs: {},
    },
    {
      contract: 'SiloedLockReleaseTokenPool 2.0.0',
      signature: 'error LockBoxNotConfigured(uint64 remoteChainSelector)',
      args: [16015286601757825753n],
      errorArgs: { remoteChainSelector: 16015286601757825753n },
    },
    {
      contract: 'TokenPoolFactory 2.0.0',
      signature: 'error InvalidLockBoxToken(address poolToken)',
      args: [POOL],
      errorArgs: { poolToken: POOL },
    },
    {
      contract: 'RegistryModuleOwnerCustom 1.6.0',
      signature: 'error RequiredRoleNotFound(address msgSender, bytes32 role, address token)',
      args: [SENDER, ROLE, POOL],
      errorArgs: { msgSender: SENDER, role: ROLE, token: POOL },
    },
  ]
  for (const { contract, signature, args, errorArgs } of testCases) {
    it(`decodes a ${contract} revert's name and args with no ABI from the caller`, async () => {
      const iface = new Interface([signature])
      const [fragment] = iface.fragments
      assert.ok(fragment instanceof ErrorFragment)
      const revertData = iface.encodeErrorResult(fragment, args)
      const { chain } = stubChain(callException(revertData))
      assert.deepEqual(await simulateEVMTx(chain, unsignedCall()), {
        success: false,
        errorName: fragment.name,
        errorArgs,
        revertData,
      })
    })
  }

  it('reads revert data nested in info.error.data, as JSON-RPC nodes return it', async () => {
    const revertData = new Interface(['error InsufficientLiquidity()']).encodeErrorResult(
      'InsufficientLiquidity',
    )
    const error = Object.assign(makeError('could not coalesce error', 'UNKNOWN_ERROR'), {
      info: { error: { code: 3, message: 'execution reverted', data: revertData } },
    })
    const { chain } = stubChain(error)
    assert.deepEqual(await simulateEVMTx(chain, unsignedCall()), {
      success: false,
      errorName: 'InsufficientLiquidity',
      errorArgs: {},
      revertData,
    })
  })

  it('keeps the name but returns errorArgs null when a known error carries malformed data', async () => {
    // a 1-byte arg where a uint64 word belongs
    const revertData = id('LockBoxNotConfigured(uint64)').slice(0, 10) + '00'
    const { chain } = stubChain(callException(revertData))
    assert.deepEqual(await simulateEVMTx(chain, unsignedCall()), {
      success: false,
      errorName: 'LockBoxNotConfigured',
      errorArgs: null,
      revertData,
    })
  })

  it('returns errorName null with the raw data when no known ABI declares the selector', async () => {
    const { chain } = stubChain(callException('0xdeadbeef0001'))
    assert.deepEqual(await simulateEVMTx(chain, unsignedCall()), {
      success: false,
      errorName: null,
      errorArgs: null,
      revertData: '0xdeadbeef0001',
    })
  })

  it('returns errorName null and `0x` for a CALL_EXCEPTION without revert data (bare revert)', async () => {
    const { chain } = stubChain(callException(null))
    assert.deepEqual(await simulateEVMTx(chain, unsignedCall()), {
      success: false,
      errorName: null,
      errorArgs: null,
      revertData: '0x',
    })
  })

  it('rethrows a transport error instead of reporting it as a revert', async () => {
    const timeout = makeError('request timeout', 'TIMEOUT')
    const { chain } = stubChain(timeout)
    await assert.rejects(
      () => simulateEVMTx(chain, unsignedCall()),
      (error: unknown) => error === timeout,
    )
  })

  it('simulates calldata built without sender from opts.from', async () => {
    const { chain, calls } = stubChain()
    const unsigned = unsignedCall({ to: POOL, data: '0x1234' })
    assert.deepEqual(await simulateEVMTx(chain, unsigned, { from: SAFE }), { success: true })
    assert.deepEqual(calls, [{ to: POOL, data: '0x1234', from: SAFE, value: undefined }])
  })

  it('prefers opts.from over the tx from, so a built tx can be checked against another signer', async () => {
    const { chain, calls } = stubChain()
    await simulateEVMTx(chain, unsignedCall(), { from: SAFE })
    assert.equal(calls[0]?.from, SAFE)
  })

  it('rejects a tx with neither opts.from nor its own from before any RPC: every CCT op gates on msg.sender', async () => {
    const { chain, calls } = stubChain()
    await assert.rejects(
      () => simulateEVMTx(chain, unsignedCall({ to: POOL, data: '0x1234' })),
      (error: unknown) =>
        error instanceof CCTParamsInvalidError &&
        error.context.operation === 'simulateEVMTx' &&
        error.context.param === 'from',
    )
    assert.equal(calls.length, 0)
  })

  it('rejects an invalid opts.from before any RPC', async () => {
    const { chain, calls } = stubChain()
    await assert.rejects(
      () => simulateEVMTx(chain, unsignedCall(), { from: '0x1234' }),
      (error: unknown) => error instanceof CCTParamsInvalidError && error.context.param === 'from',
    )
    assert.equal(calls.length, 0)
  })

  it('rejects an unsigned tx without exactly one transaction before any RPC', async () => {
    const { chain, calls } = stubChain()
    for (const transactions of [[], [{ from: SENDER }, { from: SENDER }]]) {
      await assert.rejects(
        () => simulateEVMTx(chain, { family: ChainFamily.EVM, transactions }),
        (error: unknown) =>
          error instanceof CCTParamsInvalidError && error.context.param === 'unsigned',
      )
    }
    assert.equal(calls.length, 0)
  })

  // Guards new vendored ABIs: a contract added under artifacts/abi whose errors neither
  // `parseWithFragment` nor the CCT fallback covers fails here.
  it('decodes every error declared by a vendored CCT ABI', async () => {
    const root = new URL('./artifacts/abi/', import.meta.url)
    for (const version of readdirSync(root)) {
      for (const file of readdirSync(new URL(`${version}/`, root))) {
        const abi: { default: InterfaceAbi } = await import(
          new URL(`${version}/${file}`, root).href
        )
        const iface = new Interface(abi.default)
        const errors: ErrorFragment[] = []
        iface.forEachError((fragment) => errors.push(fragment))
        for (const { name, selector } of errors) {
          const { chain } = stubChain(callException(selector))
          const result = await simulateEVMTx(chain, unsignedCall())
          assert.ok(!result.success)
          assert.equal(result.errorName, name, `${version}/${file}: ${name}`)
        }
      }
    }
  })
})
