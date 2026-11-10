import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { describe, it } from 'node:test'

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

import { tokenPoolV2Coder } from '../../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { deriveTokenPoolChainConfigV2Pda } from '../../../../solana/token-pool.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import {
  deriveEventAuthorityPda,
  deriveTokenPoolConfigPda,
  deriveTokenPoolFeeVaultPda,
  resolveTokenPoolProgram,
} from '../../programs/token-pool.ts'
import { EditChainConfigV2 } from './edit-chain-config-v2.ts'
import { InitChainConfigV2 } from './init-chain-config-v2.ts'

const MINT = Keypair.generate().publicKey
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const CCV_A = Keypair.generate().publicKey.toBase58()
const CCV_B = Keypair.generate().publicKey.toBase58()
const SELECTOR = 16015286601757825753n
const POOL_PROGRAM = resolveTokenPoolProgram('burn-mint')
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}
// Discriminators from the program's IDL, checked independently of the SDK's sighash
const INIT_DISCRIMINATOR = [31, 189, 231, 179, 25, 226, 94, 90]
const EDIT_DISCRIMINATOR = [118, 24, 17, 167, 67, 206, 107, 213]

/** A chain whose canonical burn-mint pool runs `version`, for a Token-2022 mint. */
function chain(version: string | null = '2.0.0'): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getMultipleAccountsInfo: async () => [{}],
      getAccountInfo: async (key: PublicKey) =>
        key.equals(MINT) ? { owner: TOKEN_2022_PROGRAM_ID, data: Buffer.alloc(82) } : {},
    },
    typeAndVersion: async () =>
      version ? ['burnmintTokenPool', version] : Promise.reject(new Error('typeVersion')),
  } as unknown as SolanaChain
}

const base = {
  tokenAddress: MINT.toBase58(),
  remoteChainSelector: SELECTOR,
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

function decodeParams(data: Buffer) {
  const decoded = tokenPoolV2Coder.instruction.decode(data)
  assert.ok(decoded)
  return decoded.data as { params: Record<string, any> }
}

describe('InitChainConfigV2 / EditChainConfigV2 (cct/solana)', () => {
  it('builds init_chain_config_v2, creating the fee vault token account', async () => {
    const { instructions, mainIndex } = await new InitChainConfigV2().generate(chain(), base)
    const [instruction] = instructions
    const feeVault = deriveTokenPoolFeeVaultPda(POOL_PROGRAM, MINT)

    assert.equal(mainIndex, 0)
    assert.ok(instruction!.programId.equals(POOL_PROGRAM))
    assert.deepEqual([...instruction!.data.subarray(0, 8)], INIT_DISCRIMINATOR)
    assert.deepEqual(keysOf(instruction!), [
      [deriveTokenPoolConfigPda(POOL_PROGRAM, MINT).toBase58(), false, false],
      [deriveTokenPoolChainConfigV2Pda(POOL_PROGRAM, SELECTOR, MINT).toBase58(), false, true],
      [AUTHORITY, true, true],
      [SystemProgram.programId.toBase58(), false, false],
      [MINT.toBase58(), false, false],
      [feeVault.toBase58(), false, false],
      [
        getAssociatedTokenAddressSync(MINT, feeVault, true, TOKEN_2022_PROGRAM_ID).toBase58(),
        false,
        true,
      ],
      [TOKEN_2022_PROGRAM_ID.toBase58(), false, false],
      [ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), false, false],
      [deriveEventAuthorityPda(POOL_PROGRAM).toBase58(), false, false],
      [POOL_PROGRAM.toBase58(), false, false],
    ])
  })

  it('builds edit_chain_config_v2', async () => {
    const { instructions } = await new EditChainConfigV2().generate(chain(), base)
    const [instruction] = instructions

    assert.deepEqual([...instruction!.data.subarray(0, 8)], EDIT_DISCRIMINATOR)
    assert.deepEqual(keysOf(instruction!), [
      [deriveTokenPoolConfigPda(POOL_PROGRAM, MINT).toBase58(), false, false],
      [deriveTokenPoolChainConfigV2Pda(POOL_PROGRAM, SELECTOR, MINT).toBase58(), false, true],
      [AUTHORITY, true, true],
      [SystemProgram.programId.toBase58(), false, false],
      [deriveEventAuthorityPda(POOL_PROGRAM).toBase58(), false, false],
      [POOL_PROGRAM.toBase58(), false, false],
    ])
  })

  it('encodes the finality, fee, and CCV config', async () => {
    const { instructions } = await new EditChainConfigV2().generate(chain(), {
      ...base,
      allowedFinality: { finalityDepth: 10, finalitySafe: true },
      tokenTransferFeeConfig: {
        destGasOverhead: 90_000,
        destBytesOverhead: 32,
        finalityFeeUSDCents: 25,
        fastFinalityFeeUSDCents: 50,
        finalityTransferFeeBps: 5,
        fastFinalityTransferFeeBps: 10_000,
        isEnabled: true,
      },
      ccvConfig: {
        outboundCCVs: [CCV_A],
        thresholdOutboundCCVs: [CCV_B],
        inboundCCVs: [CCV_B],
        thresholdAmount: 1_000_000n,
      },
    })
    const { params } = decodeParams(instructions[0]!.data)

    assert.ok(params.mint.equals(MINT))
    assert.equal(params.remoteChainSelector.toString(), SELECTOR.toString())
    assert.deepEqual(params.allowedFinalityConfig, { flags: 1, blockDepth: 10 })
    assert.deepEqual(params.tokenTransferFeeConfig, {
      destGasOverhead: 90_000,
      destBytesOverhead: 32,
      finalityFee: 25,
      fastFinalityFee: 50,
      finalityBpsFee: 5,
      fastFinalityBpsFee: 10_000,
      isEnabled: true,
    })
    const ccv = params.ccvConfig
    assert.equal(ccv.thresholdAmount.toString(), '1000000')
    assert.deepEqual(
      [ccv.outboundCcvs, ccv.thresholdOutboundCcvs, ccv.inboundCcvs, ccv.thresholdInboundCcvs].map(
        (ccvs: PublicKey[]) => ccvs.map((key) => key.toBase58()),
      ),
      [[CCV_A], [CCV_B], [CCV_B], []],
    )
  })

  it('defaults to full finality, no fees, and no CCVs', async () => {
    const { instructions } = await new InitChainConfigV2().generate(chain(), base)
    const { params } = decodeParams(instructions[0]!.data)

    assert.deepEqual(params.allowedFinalityConfig, { flags: 0, blockDepth: 0 })
    assert.equal(params.tokenTransferFeeConfig.isEnabled, false)
    assert.equal(params.tokenTransferFeeConfig.destBytesOverhead, 0)
    assert.equal(params.ccvConfig.thresholdAmount.toString(), '0')
    assert.deepEqual(params.ccvConfig.outboundCcvs, [])
  })

  it('rejects configs the pool program would reject', async () => {
    const fee = {
      destGasOverhead: 1,
      destBytesOverhead: 32,
      finalityFeeUSDCents: 0,
      fastFinalityFeeUSDCents: 0,
      finalityTransferFeeBps: 0,
      fastFinalityTransferFeeBps: 0,
      isEnabled: true,
    }
    for (const [opts, param] of [
      [{ remoteChainSelector: 1 }, 'remoteChainSelector'],
      [{ allowedFinality: { finalityDepth: 65_536 } }, 'allowedFinality.finalityDepth'],
      [{ allowedFinality: { finalityDepth: 0, finalitySafe: 1 } }, 'allowedFinality.finalitySafe'],
      [
        { tokenTransferFeeConfig: { ...fee, finalityTransferFeeBps: 10_001 } },
        'tokenTransferFeeConfig.finalityTransferFeeBps',
      ],
      [
        { tokenTransferFeeConfig: { ...fee, destBytesOverhead: 31 } },
        'tokenTransferFeeConfig.destBytesOverhead',
      ],
      [
        { tokenTransferFeeConfig: { ...fee, destGasOverhead: 2 ** 32 } },
        'tokenTransferFeeConfig.destGasOverhead',
      ],
      [
        { ccvConfig: { thresholdInboundCCVs: [CCV_A], thresholdAmount: 1n } },
        'ccvConfig.inboundCCVs',
      ],
      [
        { ccvConfig: { outboundCCVs: [CCV_A], thresholdOutboundCCVs: [CCV_B] } },
        'ccvConfig.thresholdAmount',
      ],
      [
        { ccvConfig: { outboundCCVs: [PublicKey.default.toBase58()] } },
        'ccvConfig.outboundCCVs[0]',
      ],
      [
        { ccvConfig: { inboundCCVs: [CCV_A], thresholdInboundCCVs: [CCV_A], thresholdAmount: 1n } },
        'ccvConfig.inboundCCVs + thresholdInboundCCVs[1]',
      ],
      [{ ccvConfig: { thresholdAmount: -1n } }, 'ccvConfig.thresholdAmount'],
    ] as const) {
      await assert.rejects(
        () => new InitChainConfigV2().generate(chain(), { ...base, ...opts } as never),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        param,
      )
    }
  })

  it('accepts the all-zero fee config, whose overhead the program does not check', async () => {
    const { instructions } = await new InitChainConfigV2().generate(chain(), {
      ...base,
      tokenTransferFeeConfig: {
        destGasOverhead: 0,
        destBytesOverhead: 0,
        finalityFeeUSDCents: 0,
        fastFinalityFeeUSDCents: 0,
        finalityTransferFeeBps: 0,
        fastFinalityTransferFeeBps: 0,
        isEnabled: false,
      },
    })
    assert.equal(instructions.length, 1)
  })

  it('rejects pools before CCIP 2.0, and accepts custom programs without typeVersion', async () => {
    for (const Op of [InitChainConfigV2, EditChainConfigV2]) {
      await assert.rejects(
        () => new Op().generate(chain('1.6.2'), base),
        (err: unknown) =>
          err instanceof CCTOperationUnsupportedError && err.context.version === '1.6.2',
      )
      const poolProgramAddress = Keypair.generate().publicKey.toBase58()
      const { instructions } = await new Op().generate(chain(null), { ...base, poolProgramAddress })
      assert.equal(instructions[0]!.programId.toBase58(), poolProgramAddress)
    }
  })

  it('rejects a non-wallet authority for signed execution', async () => {
    for (const Op of [InitChainConfigV2, EditChainConfigV2]) {
      await assert.rejects(
        () => new Op().execute(chain(), { ...base, wallet: WALLET }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'authority',
      )
    }
  })
})
