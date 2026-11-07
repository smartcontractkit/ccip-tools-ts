import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type Connection, Keypair, PublicKey } from '@solana/web3.js'

import '../index.ts'
import { networkInfo } from '../networks.ts'
import { toLeArray } from '../utils.ts'
import { SolanaChain } from './index.ts'

const silent = { ...console, debug() {}, info() {}, warn() {} }
const randomKey = () => Keypair.generate().publicKey

/**
 * Fake 2.0 router: `allowed_offramp` markers for `[selector, offRamp]` pairs, plus 8-byte accounts
 * that are not markers. Each marker's history is one execution tx run by its offRamp (top-level
 * instruction), which references the marker.
 */
function fakeRouter(pairs: [selector: bigint, offRamp: PublicKey][], nonMarkers = 0) {
  const router = randomKey()
  const marker = (selector: bigint, offRamp: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('allowed_offramp'), toLeArray(selector, 8), offRamp.toBuffer()],
      router,
    )[0]
  const computeBudget = new PublicKey('ComputeBudget111111111111111111111111111111')
  const txs = new Map<string, { offRamp: PublicKey; marker: PublicKey }>()
  const markers = pairs.map(([selector, offRamp]) => {
    const pda = marker(selector, offRamp)
    txs.set(`sig-${pda.toBase58()}`, { offRamp, marker: pda })
    return pda
  })
  const accounts = [...markers, ...Array.from({ length: nonMarkers }, randomKey)]
  const sigsCalls: string[] = []

  const connection = {
    getAccountInfo: () => Promise.resolve(null),
    getProgramAccounts: (program: PublicKey) => {
      assert.ok(program.equals(router))
      return Promise.resolve(
        accounts.map((pubkey) => ({ pubkey, account: { data: Buffer.alloc(8) } })),
      )
    },
    getSignaturesForAddress: (address: PublicKey, opts?: { before?: string }) => {
      sigsCalls.push(address.toBase58())
      const sig = `sig-${address.toBase58()}`
      return Promise.resolve(
        !opts?.before && txs.has(sig)
          ? [{ signature: sig, slot: 1, blockTime: 1, err: null, memo: null }]
          : [],
      )
    },
    getTransaction: (signature: string) => {
      const tx = txs.get(signature)
      if (!tx) return Promise.resolve(null)
      // keys: fee payer, compute budget program, offRamp program, its marker, a random account
      const keys = [randomKey(), computeBudget, tx.offRamp, tx.marker, randomKey()]
      return Promise.resolve({
        meta: { loadedAddresses: { writable: [], readonly: [] }, innerInstructions: [] },
        transaction: {
          message: {
            compiledInstructions: [{ programIdIndex: 1 }, { programIdIndex: 2 }],
            getAccountKeys: () => ({
              get: (i: number) => keys[i],
              keySegments: () => [keys],
            }),
          },
        },
      })
    },
  } as unknown as Connection

  const chain = new SolanaChain(connection, networkInfo('solana-devnet'), {
    apiClient: null,
    logger: silent,
  })
  chain.typeAndVersion = () =>
    Promise.resolve(['CCIPRouter', '2.0.0', 'ccip-router 2.0.0'] as [string, string, string])
  return { chain, router: router.toBase58(), marker, sigsCalls }
}

describe('SolanaChain.getOffRampsForRouter (2.0 router)', () => {
  const sepolia = networkInfo('ethereum-testnet-sepolia').chainSelector
  const fuji = networkInfo('avalanche-testnet-fuji').chainSelector
  const unknown = 1234567890123n // not in the selectors table
  const offRamp16 = randomKey()
  const offRamp20 = randomKey()

  it('returns every offRamp allowed for the source chain (1.6 and 2.0)', async () => {
    const { chain, router } = fakeRouter([
      [sepolia, offRamp16],
      [fuji, offRamp16],
      [sepolia, offRamp20],
    ])
    assert.deepEqual(
      new Set(await chain.getOffRampsForRouter(router, sepolia)),
      new Set([offRamp16.toBase58(), offRamp20.toBase58()]),
    )
  })

  it('returns only the offRamps allowed for the source chain', async () => {
    const { chain, router } = fakeRouter([
      [sepolia, offRamp16],
      [fuji, offRamp16],
      [sepolia, offRamp20],
    ])
    assert.deepEqual(await chain.getOffRampsForRouter(router, fuji), [offRamp16.toBase58()])
  })

  it('reads the history of one marker per offRamp, plus unexplained accounts only', async () => {
    const { chain, router, marker, sigsCalls } = fakeRouter(
      [
        [sepolia, offRamp16],
        [fuji, offRamp16], // explained by the first marker's offRamp: no RPC call
        [unknown, offRamp16], // unknown chain: cannot be explained, so it is read
        [sepolia, offRamp20],
        [fuji, offRamp20], // explained by the previous marker's offRamp
      ],
      1, // an 8-byte account that is not a marker: read, finds no history
    )
    await chain.getOffRampsForRouter(router, sepolia)

    assert.equal(sigsCalls.length, 4, `marker histories read: ${sigsCalls.join(', ')}`)
    assert.ok(!sigsCalls.includes(marker(fuji, offRamp16).toBase58()))
    assert.ok(!sigsCalls.includes(marker(fuji, offRamp20).toBase58()))
    assert.ok(sigsCalls.includes(marker(unknown, offRamp16).toBase58()))
  })

  it('throws when no offRamp is allowed for the source chain', async () => {
    const { chain, router } = fakeRouter([[fuji, offRamp16]])
    await assert.rejects(chain.getOffRampsForRouter(router, sepolia))
  })
})
