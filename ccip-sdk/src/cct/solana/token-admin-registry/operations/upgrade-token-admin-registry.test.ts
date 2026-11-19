import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

import type { SolanaChain } from '../../../../solana/index.ts'
import { deriveRouterConfigPda, deriveTokenAdminRegistryPda } from '../../programs/router.ts'
import { UpgradeTokenAdminRegistry } from './upgrade-token-admin-registry.ts'

const ROUTER = new PublicKey('Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C')
const MINT = Keypair.generate().publicKey
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()

function chain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {},
    getTokenAdminRegistryFor: async () => ROUTER.toBase58(),
  } as unknown as SolanaChain
}

const base = {
  tokenAddress: MINT.toBase58(),
  address: ROUTER.toBase58(),
  payer: PAYER,
  authority: AUTHORITY,
}

const keysOf = (instruction: {
  keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]
}) =>
  instruction.keys.map(({ pubkey, isSigner, isWritable }) => [
    pubkey.toBase58(),
    isSigner,
    isWritable,
  ])

describe('UpgradeTokenAdminRegistry (cct/solana)', () => {
  it('builds upgrade_token_admin_registry under its custom discriminator', async () => {
    const { instructions } = await new UpgradeTokenAdminRegistry().generate(chain(), base)
    const [instruction] = instructions
    assert.ok(instruction!.programId.equals(ROUTER))
    // `#[instruction(discriminator = ...)]` in the router, kept from its earlier name
    assert.deepEqual([...instruction!.data], [124, 26, 79, 44, 190, 150, 213, 49])
    assert.deepEqual(keysOf(instruction!), [
      [deriveRouterConfigPda(ROUTER).toBase58(), false, false],
      [deriveTokenAdminRegistryPda(ROUTER, MINT).toBase58(), false, true],
      [MINT.toBase58(), false, false],
      [AUTHORITY, true, true],
      [SystemProgram.programId.toBase58(), false, false],
    ])
  })

  it('defaults the authority to the payer', async () => {
    const { instructions } = await new UpgradeTokenAdminRegistry().generate(chain(), {
      ...base,
      authority: undefined,
    })
    assert.equal(instructions[0]!.keys[3]!.pubkey.toBase58(), PAYER)
  })
})
