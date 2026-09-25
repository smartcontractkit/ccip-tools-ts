import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ChainStatic } from './chain.ts'
import { CCIPChainFamilyUnsupportedError } from './errors/index.ts'
import { ChainFamily } from './networks.ts'
import { getChainStatic, getChainStatics, supportedChains } from './supported-chains.ts'

// tests run in order: the registry starts empty, as no chain module is imported statically
describe('supportedChains', () => {
  it('fails with a recovery hint when nothing is registered', () => {
    for (const fn of [() => getChainStatics(), () => getChainStatic(ChainFamily.EVM)]) {
      assert.throws(fn, (err: CCIPChainFamilyUnsupportedError) => {
        assert.ok(err instanceof CCIPChainFamilyUnsupportedError)
        assert.match(err.recovery!, /@chainlink\/ccip-sdk\/all/)
        return true
      })
    }
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
  })

  it('reports the registered families for a missing one', () => {
    const { EVM } = supportedChains
    delete supportedChains[ChainFamily.EVM]
    try {
      assert.throws(
        () => getChainStatic(ChainFamily.EVM),
        (err: CCIPChainFamilyUnsupportedError) =>
          err.context.family === ChainFamily.EVM &&
          !(err.context.registered as string[]).includes(ChainFamily.EVM) &&
          (err.context.registered as string[]).includes(ChainFamily.Solana),
      )
    } finally {
      supportedChains[ChainFamily.EVM] = EVM
    }
  })
})
