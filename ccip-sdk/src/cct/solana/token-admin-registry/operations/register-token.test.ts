import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'

import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'
import { deriveRouterConfigPda, deriveTokenAdminRegistryPda } from '../../programs/router.ts'

const TOKEN = Keypair.generate().publicKey
const MINT_AUTHORITY = Keypair.generate().publicKey
const ADDRESS = Keypair.generate().publicKey.toBase58()
const ROUTER = Keypair.generate().publicKey.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const CCIP_ADMIN = Keypair.generate().publicKey
const CONFIG = deriveRouterConfigPda(new PublicKey(ROUTER))
const TOKEN_ADMIN_REGISTRY = deriveTokenAdminRegistryPda(new PublicKey(ROUTER), TOKEN)

function configAccount() {
  const data = Buffer.alloc(210)
  createHash('sha256').update('account:Config').digest().copy(data, 0, 0, 8)
  data[8] = 1
  CCIP_ADMIN.toBuffer().copy(data, 18)
  return { data, executable: false, lamports: 1, owner: new PublicKey(ROUTER), rentEpoch: 0 }
}

function mintAccount(mintAuthority = MINT_AUTHORITY) {
  const data = Buffer.alloc(82)
  data.writeUInt32LE(1, 0)
  mintAuthority.toBuffer().copy(data, 4)
  data[44] = 9
  data[45] = 1
  return { data, executable: false, lamports: 1, owner: TOKEN_PROGRAM_ID, rentEpoch: 0 }
}

function stubChain(registered = false): SolanaChain {
  const getAccountInfo = async (address: PublicKey) => {
    if (address.equals(TOKEN)) return mintAccount()
    if (address.equals(TOKEN_ADMIN_REGISTRY)) return registered ? mintAccount() : null
    if (address.equals(CONFIG)) return configAccount()
    return assert.fail('unexpected account lookup')
  }

  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo,
      getAccountInfoAndContext: async (address: PublicKey) => ({
        context: { slot: 0 },
        value: await getAccountInfo(address),
      }),
    },
    getTokenAdminRegistryFor: async () => ROUTER,
  } as unknown as SolanaChain
}

function generate(opts = {}, registered = false) {
  return SolanaTokenManager.fromChain(stubChain(registered)).generateUnsignedRegisterToken({
    tokenAddress: TOKEN.toBase58(),
    address: ADDRESS,
    registrationMethod: 'owner',
    payer: PAYER,
    authority: MINT_AUTHORITY.toBase58(),
    ...opts,
  })
}

describe('Solana TokenAdminRegistry registerToken', () => {
  it('builds owner registration instruction', async () => {
    const unsigned = await generate()
    const [instruction] = unsigned.instructions

    assert.ok(instruction)
    assert.equal(unsigned.family, ChainFamily.Solana)
    assert.equal(unsigned.mainIndex, 0)
    assert.equal(instruction.programId.toBase58(), ROUTER)
    assert.ok(instruction.keys.some((key) => key.pubkey.equals(MINT_AUTHORITY)))
    assert.deepEqual(instruction.data.subarray(-32), MINT_AUTHORITY.toBuffer())
  })

  it('builds the CCIP-admin registration instruction', async () => {
    const owner = await generate()
    const ccipAdmin = await generate({
      registrationMethod: 'ccip-admin',
      authority: CCIP_ADMIN.toBase58(),
    })

    assert.notDeepEqual(ccipAdmin.instructions[0]!.data, owner.instructions[0]!.data)
    assert.deepEqual(ccipAdmin.instructions[0]!.data.subarray(-32), MINT_AUTHORITY.toBuffer())
  })

  it('rejects owner registration when authority is not the mint authority', async () => {
    await assert.rejects(
      () => generate({ authority: PAYER }),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'authority',
    )
  })

  it('rejects a token that is already registered', async () => {
    await assert.rejects(
      () => generate({}, true),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError && err.context.param === 'tokenAddress',
    )
  })

  it('rejects CCIP-admin registration when authority is not the Router CCIP admin', async () => {
    await assert.rejects(
      () => generate({ registrationMethod: 'ccip-admin' }),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'authority',
    )
  })

  it('rejects an unknown registration method before RPC', async () => {
    await assert.rejects(
      () => generate({ registrationMethod: 'other' }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError && err.context.param === 'registrationMethod',
    )
  })
})
