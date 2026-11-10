import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { deriveRouterConfigPda, deriveTokenAdminRegistryPda } from '../../programs/router.ts'
import { deriveEventAuthorityPda } from '../../programs/token-pool.ts'
import { SetPoolInterfaceImplementation } from './set-pool-interface-implementation.ts'
import { UpgradeTokenAdminRegistry } from './upgrade-token-admin-registry.ts'

const ROUTER = new PublicKey('Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C')
const MINT = Keypair.generate().publicKey
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}

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

describe('SetPoolInterfaceImplementation (cct/solana)', () => {
  it('builds set_pool_interface_implementation for each account resolution', async () => {
    for (const [accountResolution, variant] of [
      [undefined, 0],
      ['NoResolution', 0],
      ['Standard', 1],
      ['WithoutExtendedLookupTable', 2],
    ] as const) {
      const { instructions } = await new SetPoolInterfaceImplementation().generate(chain(), {
        ...base,
        interfaceVersion: 2,
        accountResolution,
      })
      const [instruction] = instructions
      assert.ok(instruction!.programId.equals(ROUTER))
      // discriminator from the router's IDL, mint, interface version, `ResolutionType`
      assert.deepEqual(
        [...instruction!.data],
        [121, 95, 65, 76, 190, 0, 152, 64, ...MINT.toBytes(), 2, variant],
      )
      assert.deepEqual(keysOf(instruction!), [
        [deriveRouterConfigPda(ROUTER).toBase58(), false, false],
        [deriveTokenAdminRegistryPda(ROUTER, MINT).toBase58(), false, true],
        [AUTHORITY, true, true],
        [deriveEventAuthorityPda(ROUTER).toBase58(), false, false],
        [ROUTER.toBase58(), false, false],
      ])
    }
  })

  it('rejects what the Router rejects', async () => {
    for (const [opts, param] of [
      [{ interfaceVersion: 3 }, 'interfaceVersion'],
      [{ interfaceVersion: 0 }, 'interfaceVersion'],
      [{ interfaceVersion: 1, accountResolution: 'Standard' }, 'accountResolution'],
      [{ interfaceVersion: 2, accountResolution: 'standard' }, 'accountResolution'],
    ] as const) {
      await assert.rejects(
        () => new SetPoolInterfaceImplementation().generate(chain(), { ...base, ...opts } as never),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
      )
    }
    // interface version 1 without resolution is valid
    await new SetPoolInterfaceImplementation().generate(chain(), { ...base, interfaceVersion: 1 })
  })

  it('rejects a non-wallet authority for signed execution', async () => {
    await assert.rejects(
      () =>
        new SetPoolInterfaceImplementation().execute(chain(), {
          ...base,
          interfaceVersion: 2,
          wallet: WALLET,
        }),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'authority',
    )
  })
})

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
