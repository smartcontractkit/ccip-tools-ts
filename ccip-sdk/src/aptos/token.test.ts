/**
 * Tests for the Aptos token metadata lookup and its fallback chain.
 */
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'

import { CCIPError } from '../errors/CCIPError.ts'
import { getTokenInfo } from './token.ts'

const TOKEN = `0x${'aa'.repeat(32)}`

type ViewHandler = (fn: string, typeArguments?: string[]) => unknown[] | Promise<unknown[]>

/**
 * A provider whose account resources, modules and view calls are scripted. View calls throw for
 * any function the test doesn't answer, like a node rejecting a missing view.
 */
function providerStub({
  resources = [] as unknown[] | Error,
  modules = [] as { abi: { name: string } | null }[],
  view = () => {
    throw new Error('no such view')
  },
}: {
  resources?: unknown[] | Error
  modules?: { abi: { name: string } | null }[]
  view?: ViewHandler
} = {}) {
  const getAccountResources = mock.fn(async () => {
    if (resources instanceof Error) throw resources
    return resources
  })
  const getAccountModules = mock.fn(async () => modules)
  const viewFn = mock.fn(
    async ({ payload }: { payload: { function: string; typeArguments?: string[] } }) =>
      view(payload.function, payload.typeArguments),
  )
  const provider = { getAccountResources, getAccountModules, view: viewFn } as unknown as Aptos
  return { provider, getAccountResources, getAccountModules, view: viewFn }
}

describe('getTokenInfo', () => {
  it('reads a fungible asset metadata resource first', async () => {
    const { provider, view } = providerStub({
      resources: [
        {
          type: '0x1::fungible_asset::Metadata',
          data: { name: 'Tether USD', symbol: 'USDt', decimals: 6 },
        },
      ],
    })

    assert.deepEqual(await getTokenInfo(provider, TOKEN), {
      name: 'Tether USD',
      symbol: 'USDt',
      decimals: 6,
    })
    assert.equal(view.mock.calls.length, 0)
  })

  it('falls back to the standard coin views when no metadata resource exists', async () => {
    const { provider } = providerStub({
      view: (fn) => {
        if (fn === '0x1::coin::symbol') return ['COIN']
        if (fn === '0x1::coin::decimals') return [8]
        if (fn === '0x1::coin::name') return ['Coin']
        throw new Error(fn)
      },
    })

    assert.deepEqual(await getTokenInfo(provider, TOKEN), {
      name: 'Coin',
      symbol: 'COIN',
      decimals: 8,
    })
  })

  it('keeps symbol and decimals when the coin has no name view', async () => {
    const { provider } = providerStub({
      view: (fn) => {
        if (fn === '0x1::coin::symbol') return ['NONAME']
        if (fn === '0x1::coin::decimals') return [0]
        throw new Error(fn)
      },
    })

    assert.deepEqual(await getTokenInfo(provider, TOKEN), {
      name: undefined,
      symbol: 'NONAME',
      decimals: 0,
    })
  })

  it('scans the package modules for a coin or token module', async () => {
    const { provider } = providerStub({
      resources: new Error('not a fungible asset'),
      modules: [{ abi: { name: 'my_coin_module' } }, { abi: { name: 'router' } }],
      view: (fn) => {
        if (fn === '0x1::coin::symbol' || fn === '0x1::coin::decimals') throw new Error(fn)
        if (fn === `${TOKEN}::my_coin_module::symbol`) return ['LEGACY']
        if (fn === `${TOKEN}::my_coin_module::decimals`) return [2]
        if (fn === `${TOKEN}::my_coin_module::name`) return ['Legacy Coin']
        throw new Error(fn)
      },
    })

    assert.deepEqual(await getTokenInfo(provider, TOKEN), {
      name: 'Legacy Coin',
      symbol: 'LEGACY',
      decimals: 2,
    })
  })

  it('tries the common module names when the package declares no coin module', async () => {
    const { provider } = providerStub({
      view: (fn) => {
        if (fn === `${TOKEN}::coin::symbol`) return ['COMMON']
        if (fn === `${TOKEN}::coin::decimals`) return [9]
        if (fn === `${TOKEN}::coin::name`) return ['Common Coin']
        throw new Error(fn)
      },
    })

    assert.deepEqual(await getTokenInfo(provider, TOKEN), {
      name: 'Common Coin',
      symbol: 'COMMON',
      decimals: 9,
    })
  })

  it('throws a typed CCIP error when every lookup fails', async () => {
    const { provider } = providerStub({ resources: new Error('missing') })

    await assert.rejects(
      getTokenInfo(provider, TOKEN),
      (err: unknown) => CCIPError.isCCIPError(err) && err.code === 'TOKEN_POOL_INFO_NOT_FOUND',
    )
  })
})
