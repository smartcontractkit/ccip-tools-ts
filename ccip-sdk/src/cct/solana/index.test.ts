import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PublicKey } from '@solana/web3.js'

import { SolanaTokenManager } from './index.ts'
import { CCIPCctParamsInvalidError, CCIPVersionUnsupportedError } from '../../errors/index.ts'
import type { SolanaChain } from '../../solana/index.ts'
import { CCIPVersion } from '../../types.ts'

const KEY = PublicKey.default.toBase58()

function stubChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: () => {
        throw new Error('should not RPC before validation')
      },
      getLatestBlockhash: async () => ({ blockhash: KEY, lastValidBlockHeight: 0 }),
    },
  } as unknown as SolanaChain
}

describe('SolanaTokenManager (cct/solana)', () => {
  it('fromChain exposes grouped TokenAdminRegistry operations', () => {
    const chain = stubChain()
    const cct = SolanaTokenManager.fromChain(chain)
    assert.equal(cct.chain, chain)
    assert.equal(cct.tokenAdminRegistry.chain, chain)
  })

  it('returns setPool instructions without calldata', async () => {
    const cct = SolanaTokenManager.fromChain(stubChain())
    const unsigned = await cct.tokenAdminRegistry.generateUnsignedSetPool({
      tokenAddress: KEY,
      routerAddress: KEY,
      poolLookupTableAddress: KEY,
      payer: KEY,
    })

    const [instruction] = unsigned.instructions
    assert.ok(instruction)
    assert.equal(unsigned.mainIndex, 0)
    assert.equal(instruction.data.toString('hex'), '771e0eb473e1a7ee03000000030407')
  })

  it('serializes unsigned Solana txs on demand', async () => {
    const chain = stubChain()
    const cct = SolanaTokenManager.fromChain(chain)
    const unsigned = await cct.tokenAdminRegistry.generateUnsignedSetPool({
      tokenAddress: KEY,
      routerAddress: KEY,
      poolLookupTableAddress: KEY,
      payer: KEY,
    })

    const base64 = await cct.serializeUnsignedTx(unsigned, KEY)
    const hex = await cct.serializeUnsignedTx(unsigned, KEY, 'hex')

    assert.match(base64, /^[A-Za-z0-9+/]+=*$/)
    assert.match(hex, /^[0-9a-f]+$/)
    await assert.rejects(
      () => cct.serializeUnsignedTx(unsigned, KEY, 'base32' as never),
      /unsupported Solana transaction encoding: base32/,
    )
  })

  it('validates public keys before RPC', async () => {
    const cct = SolanaTokenManager.fromChain(stubChain())
    await assert.rejects(
      () =>
        cct.tokenAdminRegistry.generateUnsignedSetPool({
          tokenAddress: 'nope',
          routerAddress: KEY,
          poolLookupTableAddress: KEY,
          payer: KEY,
        }),
      (err: unknown) =>
        err instanceof CCIPCctParamsInvalidError &&
        err.context.operation === 'setPool' &&
        err.context.param === 'tokenAddress',
    )
  })

  it('only supports exact TokenAdminRegistry versions', async () => {
    const cct = SolanaTokenManager.fromChain(stubChain())
    await assert.rejects(
      () =>
        cct.tokenAdminRegistry.generateUnsignedSetPool({
          tokenAddress: KEY,
          routerAddress: KEY,
          poolLookupTableAddress: KEY,
          payer: KEY,
          version: CCIPVersion.V2_0 as never,
        }),
      (err: unknown) => err instanceof CCIPVersionUnsupportedError,
    )
  })
})
