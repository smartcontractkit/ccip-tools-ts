import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type PublicKey, Keypair } from '@solana/web3.js'

import { tokenPoolCoder } from '../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../solana/index.ts'
import { CCTDataDecodeError } from '../../errors.ts'
import {
  decodeTokenPoolGlobalConfig,
  deriveTokenPoolProgramDataPda,
  readTokenPoolUpgradeAuthority,
  resolveTokenPoolProgram,
} from './token-pool.ts'

const POOL_PROGRAM = resolveTokenPoolProgram('burn-mint')
const UPGRADE_AUTHORITY = Keypair.generate().publicKey
const CONTEXT = { globalConfig: 'config', poolProgram: POOL_PROGRAM.toBase58() }

/** Program data header: variant, deploy slot, and the optional upgrade authority. */
function programData(authority: PublicKey | null, variant = 3): Buffer {
  const data = Buffer.alloc(45)
  data.writeUInt32LE(variant, 0)
  data.writeBigUInt64LE(123n, 4)
  if (authority) {
    data[12] = 1
    authority.toBuffer().copy(data, 13)
  }
  return data
}

function chain(data: Buffer | null) {
  const reads: unknown[] = []
  const solana = {
    connection: {
      getAccountInfo: async (address: PublicKey, config: unknown) => {
        reads.push([address.toBase58(), config])
        return data && { data }
      },
    },
  } as unknown as SolanaChain
  return { solana, reads }
}

describe('decodeTokenPoolGlobalConfig (cct/solana)', () => {
  it('decodes the default router and the self-serve flag', async () => {
    const router = Keypair.generate().publicKey
    const data = await tokenPoolCoder.accounts.encode('poolConfig', {
      version: 1,
      selfServedAllowed: true,
      router,
      rmnRemote: Keypair.generate().publicKey,
    })
    const config = decodeTokenPoolGlobalConfig(data, CONTEXT)
    assert.ok(config.router.equals(router))
    assert.equal(config.selfServedAllowed, true)
  })

  it('rejects other accounts', () => {
    assert.throws(() => decodeTokenPoolGlobalConfig(Buffer.alloc(74), CONTEXT), CCTDataDecodeError)
  })
})

describe('readTokenPoolUpgradeAuthority (cct/solana)', () => {
  it('reads the authority from the program data header only', async () => {
    const { solana, reads } = chain(programData(UPGRADE_AUTHORITY))
    const authority = await readTokenPoolUpgradeAuthority(solana, POOL_PROGRAM)
    assert.ok(authority?.equals(UPGRADE_AUTHORITY))
    assert.deepEqual(reads, [
      [
        deriveTokenPoolProgramDataPda(POOL_PROGRAM).toBase58(),
        { dataSlice: { offset: 0, length: 45 } },
      ],
    ])
  })

  it('returns none for an immutable program or unreadable program data', async () => {
    for (const data of [programData(null), programData(UPGRADE_AUTHORITY, 2), null])
      assert.equal(await readTokenPoolUpgradeAuthority(chain(data).solana, POOL_PROGRAM), undefined)
  })
})
