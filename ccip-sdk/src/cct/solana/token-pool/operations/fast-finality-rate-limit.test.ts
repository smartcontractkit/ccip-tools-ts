import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

import { tokenPoolV2Coder } from '../../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { deriveTokenPoolChainConfigOverridePda } from '../../../../solana/token-pool.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import {
  deriveEventAuthorityPda,
  deriveTokenPoolConfigPda,
  resolveTokenPoolProgram,
} from '../../programs/token-pool.ts'
import { DeleteFastFinalityRateLimit } from './delete-fast-finality-rate-limit.ts'
import { InitFastFinalityRateLimit } from './init-fast-finality-rate-limit.ts'
import { SetFastFinalityRateLimit } from './set-fast-finality-rate-limit.ts'

const MINT = Keypair.generate().publicKey
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const SELECTOR = 16015286601757825753n
const POOL_PROGRAM = resolveTokenPoolProgram('burn-mint')
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}

function chain(version = '2.0.0'): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: { getMultipleAccountsInfo: async () => [{}], getAccountInfo: async () => ({}) },
    typeAndVersion: async () => ['burnmintTokenPool', version],
  } as unknown as SolanaChain
}

const ref = {
  tokenAddress: MINT.toBase58(),
  remoteChainSelector: SELECTOR,
  payer: PAYER,
  authority: AUTHORITY,
}
const limits = {
  inbound: { enabled: true, capacity: 100n, rate: 10n },
  outbound: { enabled: false },
} as const

// [operation, discriminator from the program's IDL, authority writable, takes the system program]
const OPERATIONS = [
  [
    () => new InitFastFinalityRateLimit(),
    [196, 118, 243, 229, 244, 18, 234, 9],
    true,
    true,
    limits,
  ],
  [
    () => new SetFastFinalityRateLimit(),
    [179, 114, 216, 195, 164, 146, 235, 58],
    false,
    false,
    limits,
  ],
  [() => new DeleteFastFinalityRateLimit(), [17, 37, 85, 51, 2, 5, 122, 82], true, false, {}],
] as const

describe('FTF rate limit operations (cct/solana)', () => {
  it('build the chain config override instructions on the FTF override PDA', async () => {
    const override = deriveTokenPoolChainConfigOverridePda(POOL_PROGRAM, SELECTOR, MINT)
    for (const [op, discriminator, authorityWritable, takesSystem, params] of OPERATIONS) {
      const { instructions } = await op().generate(chain(), { ...ref, ...params } as never)
      const [instruction] = instructions
      assert.ok(instruction!.programId.equals(POOL_PROGRAM))
      assert.deepEqual([...instruction!.data.subarray(0, 8)], discriminator)
      // the FTF variant of `PoolChainConfigOverrideType`, after the selector and mint
      assert.equal(instruction!.data[8 + 8 + 32], 0)
      assert.deepEqual(
        instruction!.keys.map(({ pubkey, isSigner, isWritable }) => [
          pubkey.toBase58(),
          isSigner,
          isWritable,
        ]),
        [
          [deriveTokenPoolConfigPda(POOL_PROGRAM, MINT).toBase58(), false, false],
          [override.toBase58(), false, true],
          [AUTHORITY, true, authorityWritable],
          ...(takesSystem ? [[SystemProgram.programId.toBase58(), false, false]] : []),
          [deriveEventAuthorityPda(POOL_PROGRAM).toBase58(), false, false],
          [POOL_PROGRAM.toBase58(), false, false],
        ],
      )
    }
  })

  it('derives the override PDA from the "ftf" seed', () => {
    const selector = Buffer.alloc(8)
    selector.writeBigUInt64LE(SELECTOR)
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from('chainconfig_override'), selector, MINT.toBuffer(), Buffer.from('ftf')],
      POOL_PROGRAM,
    )
    assert.ok(deriveTokenPoolChainConfigOverridePda(POOL_PROGRAM, SELECTOR, MINT).equals(expected))
  })

  it('encodes both rate limits', async () => {
    const { instructions } = await new SetFastFinalityRateLimit().generate(chain(), {
      ...ref,
      ...limits,
    })
    const decoded = tokenPoolV2Coder.instruction.decode(instructions[0]!.data)
    assert.ok(decoded)
    const { params } = decoded.data as {
      params: Record<'inbound' | 'outbound', Record<string, unknown>> & { overrideType: object }
    }
    assert.deepEqual(params.overrideType, { ftf: {} })
    assert.deepEqual(
      [params.inbound, params.outbound].map(({ enabled, capacity, rate }) => [
        enabled,
        String(capacity),
        String(rate),
      ]),
      [
        [true, '100', '10'],
        [false, '0', '0'],
      ],
    )
  })

  it('rejects invalid rate limits and pools before CCIP 2.0', async () => {
    for (const [inbound, param] of [
      [{ enabled: true, capacity: 1n, rate: 2n }, 'inbound.rate'],
      [{ enabled: false, capacity: 1n }, 'inbound'],
    ] as const) {
      await assert.rejects(
        () => new InitFastFinalityRateLimit().generate(chain(), { ...ref, ...limits, inbound }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
      )
    }
    for (const [op, , , , params] of OPERATIONS) {
      await assert.rejects(
        () => op().generate(chain('1.6.2'), { ...ref, ...params } as never),
        CCTOperationUnsupportedError,
      )
    }
  })

  it('rejects a non-wallet authority for signed execution', async () => {
    for (const [op, , , , params] of OPERATIONS) {
      await assert.rejects(
        () => op().execute(chain(), { ...ref, ...params, wallet: WALLET } as never),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'authority',
      )
    }
  })
})
