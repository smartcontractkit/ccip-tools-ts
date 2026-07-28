import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import {
  createRouterProgram,
  deriveRouterConfigPda,
  deriveTokenAdminRegistryPda,
} from '../../programs/router.ts'
import { TransferAdminRole } from './transfer-admin-role.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const NEW_ADMIN = Keypair.generate().publicKey.toBase58()
const ROUTER = Keypair.generate().publicKey.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()

function stubChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: () => assert.fail('should not RPC before validation'),
    },
  } as unknown as SolanaChain
}

function generate(opts = {}) {
  return new TransferAdminRole().generate(stubChain(), {
    tokenAddress: TOKEN,
    newAdmin: NEW_ADMIN,
    routerAddress: ROUTER,
    payer: PAYER,
    ...opts,
  })
}

describe('Solana TokenAdminRegistry transferAdminRole', () => {
  it('matches a direct transferAdminRoleTokenAdminRegistry build (instruction parity)', async () => {
    const unsigned = await generate()
    const [instruction] = unsigned.instructions

    assert.ok(instruction)
    assert.equal(unsigned.family, ChainFamily.Solana)
    assert.equal(unsigned.mainIndex, 0)
    assert.equal(unsigned.instructions.length, 1)
    assert.equal(instruction.programId.toBase58(), ROUTER)

    const router = new PublicKey(ROUTER)
    const mint = new PublicKey(TOKEN)
    const expected = await createRouterProgram(stubChain(), router, new PublicKey(PAYER))
      .methods.transferAdminRoleTokenAdminRegistry(new PublicKey(NEW_ADMIN))
      .accountsStrict({
        config: deriveRouterConfigPda(router),
        tokenAdminRegistry: deriveTokenAdminRegistryPda(router, mint),
        mint,
        authority: new PublicKey(PAYER),
      })
      .instruction()

    assert.equal(instruction.data.toString('hex'), expected.data.toString('hex'))
    assert.ok(
      instruction.data
        .toString('hex')
        .includes(new PublicKey(NEW_ADMIN).toBuffer().toString('hex')),
    )
    assert.equal(instruction.keys.length, expected.keys.length)
    for (const [i, key] of expected.keys.entries()) {
      assert.equal(instruction.keys[i]!.pubkey.toBase58(), key.pubkey.toBase58())
      assert.equal(instruction.keys[i]!.isSigner, key.isSigner)
      assert.equal(instruction.keys[i]!.isWritable, key.isWritable)
    }
  })

  it('uses caller-provided authority', async () => {
    const unsigned = await generate({ authority: AUTHORITY })
    assert.ok(unsigned.instructions[0]!.keys.some((key) => key.pubkey.toBase58() === AUTHORITY))
    assert.ok(!unsigned.instructions[0]!.keys.some((key) => key.pubkey.toBase58() === PAYER))
  })

  it('defaults authority to payer', async () => {
    const unsigned = await generate()
    assert.ok(unsigned.instructions[0]!.keys.some((key) => key.pubkey.toBase58() === PAYER))
  })

  it('rejects an invalid public key before building', async () => {
    await assert.rejects(
      () => generate({ newAdmin: 'not-a-pubkey' }),
      (error: unknown) => error instanceof CCTParamsInvalidError,
    )
  })
})
