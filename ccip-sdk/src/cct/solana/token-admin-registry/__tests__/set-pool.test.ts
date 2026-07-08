import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey } from '@solana/web3.js'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'

const KEY = PublicKey.default.toBase58()
const ADDRESS = Keypair.generate().publicKey.toBase58()
const ROUTER = Keypair.generate().publicKey.toBase58()

function stubChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: () => assert.fail('should not RPC before validation'),
      getLatestBlockhash: async () => ({ blockhash: KEY, lastValidBlockHeight: 0 }),
    },
    getTokenAdminRegistryFor: async () => KEY,
  } as unknown as SolanaChain
}

describe('Solana TokenAdminRegistry setPool', () => {
  it('builds unsigned setPool instruction', async () => {
    const cct = SolanaTokenManager.fromChain(stubChain())
    const unsigned = await cct.tokenAdminRegistry.generateUnsignedSetPool({
      tokenAddress: KEY,
      address: KEY,
      poolLookupTableAddress: KEY,
      payer: KEY,
    })

    const [instruction] = unsigned.instructions
    assert.ok(instruction)
    assert.equal(unsigned.mainIndex, 0)
    assert.equal(instruction.data.toString('hex'), '771e0eb473e1a7ee03000000030407')
  })

  it('resolves the router from address', async () => {
    let requestedAddress: string | undefined
    const cct = SolanaTokenManager.fromChain({
      ...stubChain(),
      getTokenAdminRegistryFor: async (address: string) => {
        requestedAddress = address
        return ROUTER
      },
    } as SolanaChain)

    const unsigned = await cct.tokenAdminRegistry.generateUnsignedSetPool({
      tokenAddress: KEY,
      address: ADDRESS,
      poolLookupTableAddress: KEY,
      payer: KEY,
    })

    assert.equal(requestedAddress, ADDRESS)
    assert.equal(unsigned.instructions[0]!.programId.toBase58(), ROUTER)
  })

  it('validates public keys before RPC', async () => {
    const cct = SolanaTokenManager.fromChain(stubChain())
    await assert.rejects(
      () =>
        cct.tokenAdminRegistry.generateUnsignedSetPool({
          tokenAddress: 'nope',
          address: KEY,
          poolLookupTableAddress: KEY,
          payer: KEY,
        }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'setPool' &&
        err.context.param === 'tokenAddress',
    )
  })

  it('rejects a non-wallet before generating setPool', async () => {
    const cct = SolanaTokenManager.fromChain(stubChain())
    await assert.rejects(
      () =>
        cct.tokenAdminRegistry.setPool({
          tokenAddress: KEY,
          address: KEY,
          poolLookupTableAddress: KEY,
          payer: KEY,
          wallet: {},
        }),
      (err: unknown) => err instanceof CCIPWalletInvalidError,
    )
  })
})
