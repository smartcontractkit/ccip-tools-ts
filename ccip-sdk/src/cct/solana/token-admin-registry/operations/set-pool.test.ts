import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { SolanaTokenManager } from '../../index.ts'

const BLOCKHASH = PublicKey.default.toBase58()
const TOKEN = Keypair.generate().publicKey.toBase58()
const ADDRESS = Keypair.generate().publicKey.toBase58()
const ROUTER = Keypair.generate().publicKey.toBase58()
const POOL_LOOKUP_TABLE = Keypair.generate().publicKey.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()

function stubChain(router = ROUTER, onAddress?: (address: string) => void): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: () => assert.fail('should not RPC before validation'),
      getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 0 }),
    },
    getTokenAdminRegistryFor: async (address: string) => {
      onAddress?.(address)
      return router
    },
  } as unknown as SolanaChain
}

function generate(opts = {}) {
  return SolanaTokenManager.fromChain(stubChain()).tokenAdminRegistry.generateUnsignedSetPool({
    tokenAddress: TOKEN,
    address: ADDRESS,
    poolLookupTableAddress: POOL_LOOKUP_TABLE,
    payer: PAYER,
    ...opts,
  })
}

describe('Solana TokenAdminRegistry setPool', () => {
  it('builds unsigned setPool instruction with default writable indexes and authority', async () => {
    const unsigned = await generate()
    const [instruction] = unsigned.instructions

    assert.ok(instruction)
    assert.equal(unsigned.family, ChainFamily.Solana)
    assert.equal(unsigned.mainIndex, 0)
    assert.equal(unsigned.instructions.length, 1)
    assert.equal(instruction.programId.toBase58(), ROUTER)
    assert.equal(instruction.data.toString('hex'), '771e0eb473e1a7ee03000000030407')
    assert.ok(instruction.keys.some((key) => key.pubkey.toBase58() === TOKEN))
    assert.ok(instruction.keys.some((key) => key.pubkey.toBase58() === POOL_LOOKUP_TABLE))
    assert.ok(instruction.keys.some((key) => key.pubkey.toBase58() === PAYER))
  })

  it('uses caller-provided writable indexes', async () => {
    const unsigned = await generate({ writableIndexes: [3, 4, 7, 9] })

    assert.equal(unsigned.instructions[0]!.data.toString('hex'), '771e0eb473e1a7ee0400000003040709')
  })

  it('resolves the router from address', async () => {
    let requestedAddress: string | undefined
    const cct = SolanaTokenManager.fromChain(
      stubChain(ROUTER, (address) => (requestedAddress = address)),
    )

    const unsigned = await cct.tokenAdminRegistry.generateUnsignedSetPool({
      tokenAddress: TOKEN,
      address: ADDRESS,
      poolLookupTableAddress: POOL_LOOKUP_TABLE,
      payer: PAYER,
    })

    assert.equal(requestedAddress, ADDRESS)
    assert.equal(unsigned.instructions[0]!.programId.toBase58(), ROUTER)
  })

  it('uses caller-provided authority', async () => {
    const unsigned = await generate({ authority: AUTHORITY })

    assert.ok(unsigned.instructions[0]!.keys.some((key) => key.pubkey.toBase58() === AUTHORITY))
  })
})
