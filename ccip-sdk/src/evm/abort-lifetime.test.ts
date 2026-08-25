/**
 * A caller signal shared by many chains must not keep dropped chains alive.
 *
 * `chain.abort` is `AbortSignal.any([own, ctx.abort])`, so the caller's long-lived
 * signal transitively holds every listener a chain registers on it. The provider
 * teardown listener is therefore registered from a module-scope helper holding only
 * a `WeakRef` — an inline arrow would share the constructor's closure context, which
 * the `_wrap*` hooks populate with `this`, and root the chain regardless of the
 * WeakRef (measured: 20/20 chains alive with the inline form).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'

import type { JsonRpcApiProvider } from 'ethers'

import { networkInfo } from '../index.ts'
import { EVMChain } from './index.ts'

/** Exposes V8's GC for this process (node --test does not pass --expose-gc). */
function forceGc(): () => void {
  const direct = globalThis.gc as (() => void) | undefined
  if (direct) return () => void direct()
  setFlagsFromString('--expose_gc')
  return runInNewContext('gc') as () => void
}

describe('EVMChain abort lifetime', () => {
  it('a chain dropped without destroy() is collectable under a long-lived ctx.abort', async () => {
    const gc = forceGc()
    const parent = new AbortController() // caller signal: never fires, outlives the chains
    const network = networkInfo('ethereum-testnet-sepolia')
    const N = 20
    const chains: WeakRef<object>[] = []
    const providers: WeakRef<object>[] = []
    for (let i = 0; i < N; i++) {
      const provider = {
        destroy: () => {},
        _getConnection: () => ({ url: 'http://stub.invalid' }),
      } as unknown as JsonRpcApiProvider
      chains.push(new WeakRef(new EVMChain(provider, network, { abort: parent.signal })))
      providers.push(new WeakRef(provider))
    }
    for (let i = 0; i < 8; i++) gc()
    await new Promise((resolve) => setImmediate(resolve))
    for (let i = 0; i < 8; i++) gc()
    // The final iteration's bindings can stay reachable from the frame; everything
    // before it must be gone.
    const aliveChains = chains.filter((r) => r.deref()).length
    const aliveProviders = providers.filter((r) => r.deref()).length
    assert.ok(aliveChains <= 1, `dropped chains still reachable: ${aliveChains}/${N}`)
    assert.ok(aliveProviders <= 1, `their providers still reachable: ${aliveProviders}/${N}`)
  })
})
