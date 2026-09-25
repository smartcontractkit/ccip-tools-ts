import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ChainStatic } from './chain.ts'
import { CCIPChainFamilyUnsupportedError, CCIPMessageDecodeError } from './errors/index.ts'
import { ChainFamily } from './networks.ts'
import { decodeMessage } from './requests.ts'
import { getChainStatic, getChainStatics, supportedChains } from './supported-chains.ts'
import { isSupportedTxHash } from './utils.ts'

// runs `fn` with only `families` registered, restoring the registry afterwards
function withOnly<T>(families: ChainFamily[], fn: () => T): T {
  const saved = { ...supportedChains }
  for (const family of Object.keys(saved) as ChainFamily[])
    if (!families.includes(family)) delete supportedChains[family]
  try {
    return fn()
  } finally {
    Object.assign(supportedChains, saved)
  }
}

// tests run in order: the registry starts empty, as no chain module is imported statically
describe('supportedChains', () => {
  it('fails with a recovery hint when nothing is registered', () => {
    for (const fn of [
      () => getChainStatics(),
      () => getChainStatic(ChainFamily.EVM),
      () => isSupportedTxHash(`0x${'11'.repeat(32)}`),
    ]) {
      assert.throws(fn, (err: CCIPChainFamilyUnsupportedError) => {
        assert.ok(err instanceof CCIPChainFamilyUnsupportedError)
        assert.match(err.recovery!, /@chainlink\/ccip-sdk\/all/)
        return true
      })
    }
    assert.throws(getChainStatics, (err: CCIPChainFamilyUnsupportedError) => {
      assert.equal(err.message, 'No chain family is registered')
      assert.deepEqual(err.context, { registered: [] })
      return true
    })
  })

  it('chain modules evaluated later keep earlier registrations', async () => {
    const custom = { family: ChainFamily.Solana } as unknown as ChainStatic<
      typeof ChainFamily.Solana
    >
    supportedChains[ChainFamily.Solana] = custom
    const { SolanaChain } = await import('./solana/index.ts')
    assert.equal(getChainStatic(ChainFamily.Solana), custom)

    const { EVMChain } = await import('./evm/index.ts')
    class MyEVMChain extends EVMChain {}
    supportedChains[ChainFamily.EVM] = MyEVMChain
    const { allSupportedChains } = await import('./all-chains.ts')
    assert.equal(getChainStatic(ChainFamily.EVM), MyEVMChain)
    assert.equal(getChainStatic(ChainFamily.Solana), custom)
    assert.equal(allSupportedChains[ChainFamily.Solana], SolanaChain)
    assert.equal(getChainStatics().length, Object.keys(allSupportedChains).length)
    supportedChains[ChainFamily.Solana] = SolanaChain
  })

  it('names a missing family and its class', () => {
    withOnly([ChainFamily.EVM], () =>
      assert.throws(
        () => getChainStatic(ChainFamily.Solana),
        (err: CCIPChainFamilyUnsupportedError) => {
          assert.equal(err.message, 'Chain family SVM is not registered (registered: EVM)')
          assert.deepEqual(err.context, { family: ChainFamily.Solana, registered: ['EVM'] })
          assert.match(err.recovery!, /import \{ SolanaChain, supportedChains \}/)
          assert.match(err.recovery!, /supportedChains\.SVM \?\?= SolanaChain/)
          return true
        },
      ),
    )
  })

  it('keeps "Unsupported chain family" for families the SDK does not implement', () => {
    assert.throws(
      () => getChainStatic('NOPE' as ChainFamily),
      (err: CCIPChainFamilyUnsupportedError) => {
        assert.equal(err.message, 'Unsupported chain family: NOPE')
        assert.equal(err.context.family, 'NOPE')
        assert.doesNotMatch(err.recovery!, /supportedChains/)
        return true
      },
    )
  })

  it('decodeMessage lists the families it tried, and hints at unregistered ones', () => {
    withOnly([ChainFamily.EVM], () =>
      assert.throws(
        () => decodeMessage('0xdeadbeef'),
        (err: CCIPMessageDecodeError) => {
          assert.ok(err instanceof CCIPMessageDecodeError)
          assert.match(err.message, /\(tried EVM\)$/)
          assert.deepEqual(err.context.registered, ['EVM'])
          assert.match(err.recovery!, /unregistered family \(SVM, APTOS, SUI, TON, CANTON\)/)
          return true
        },
      ),
    )
  })

  it('factories build the class they are called on', async () => {
    const { EVMChain } = await import('./evm/index.ts')
    const { JsonRpcProvider } = await import('ethers')
    class MyEVMChain extends EVMChain {}
    const provider = new JsonRpcProvider('http://127.0.0.1:1', 11155111, { staticNetwork: true })
    try {
      assert.ok((await MyEVMChain.fromProvider(provider)) instanceof MyEVMChain)
    } finally {
      provider.destroy()
    }
  })
})
