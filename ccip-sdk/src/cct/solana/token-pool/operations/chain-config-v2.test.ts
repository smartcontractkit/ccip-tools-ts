import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { describe, it } from 'node:test'

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import BN from 'bn.js'

import { CCIPTokenPoolChainConfigNotFoundError } from '../../../../errors/index.ts'
import { tokenPoolV2Coder } from '../../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { deriveTokenPoolChainConfigV2Pda } from '../../../../solana/token-pool.ts'
import {
  CCTDataDecodeError,
  CCTOperationUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
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

const CHAIN_CONFIG_V2 = deriveTokenPoolChainConfigV2Pda(POOL_PROGRAM, SELECTOR, MINT)

type CCVLists = {
  thresholdAmount?: bigint
  outboundCcvs?: string[]
  thresholdOutboundCcvs?: string[]
  inboundCcvs?: string[]
  thresholdInboundCcvs?: string[]
}

/** The fees of the lane's `ChainConfigV2` fixture, in the program's field names. */
const LANE_FEES = {
  destGasOverhead: 90_000,
  destBytesOverhead: 32,
  finalityFee: 25,
  fastFinalityFee: 50,
  finalityBpsFee: 10,
  fastFinalityBpsFee: 20,
  isEnabled: true,
}

/** A full edit config, which needs no read of the lane. */
const FULL_CONFIG = {
  allowedFinality: { finalityDepth: 0 },
  tokenTransferFeeConfig: {
    destGasOverhead: 0,
    destBytesOverhead: 0,
    finalityFeeUSDCents: 0,
    fastFinalityFeeUSDCents: 0,
    finalityTransferFeeBps: 0,
    fastFinalityTransferFeeBps: 0,
    isEnabled: false,
  },
  ccvConfig: {},
}

/**
 * A `ChainConfigV2` account owned by the canonical pool, encoded with the program's full IDL: it
 * allows finality depth 10 and the safe head, charges {@link LANE_FEES}, and requires `ccvs`.
 */
async function chainConfigV2Account(ccvs: CCVLists = {}, owner = POOL_PROGRAM) {
  const keys = (list: string[] = []) => list.map((ccv) => new PublicKey(ccv))
  const data = await tokenPoolV2Coder.accounts.encode('chainConfigV2', {
    bump: 255,
    version: 1,
    remoteChainSelector: new BN(SELECTOR.toString()),
    mint: MINT,
    allowedFinalityConfig: { flags: 1, blockDepth: 10 },
    tokenTransferFeeConfig: LANE_FEES,
    ccvConfig: {
      thresholdAmount: new BN((ccvs.thresholdAmount ?? 0n).toString()),
      outboundCcvs: keys(ccvs.outboundCcvs),
      thresholdOutboundCcvs: keys(ccvs.thresholdOutboundCcvs),
      inboundCcvs: keys(ccvs.inboundCcvs),
      thresholdInboundCcvs: keys(ccvs.thresholdInboundCcvs),
    },
  })
  return { owner, data }
}

/**
 * A chain whose canonical burn-mint pool runs `version`, for a Token-2022 mint. `chainConfigV2` is
 * the lane's `ChainConfigV2` account (`null` when it does not exist); it defaults to one without
 * CCVs.
 */
function chain(
  version: string | null = '2.0.0',
  chainConfigV2?: { owner: PublicKey; data: Buffer } | null,
): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getMultipleAccountsInfo: async () => [{}],
      getAccountInfo: async (key: PublicKey) =>
        key.equals(MINT)
          ? { owner: TOKEN_2022_PROGRAM_ID, data: Buffer.alloc(82) }
          : key.equals(CHAIN_CONFIG_V2)
            ? chainConfigV2 === undefined
              ? chainConfigV2Account()
              : chainConfigV2
            : {},
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
      const { instructions } = await new Op().generate(chain(null), {
        ...base,
        ...FULL_CONFIG,
        poolProgramAddress,
      })
      assert.equal(instructions[0]!.programId.toBase58(), poolProgramAddress)
    }
  })

  const current = {
    thresholdAmount: 5_000n,
    outboundCcvs: [CCV_A],
    thresholdOutboundCcvs: [CCV_B],
    inboundCcvs: [CCV_B],
  }
  const ccvsOf = (ccv: Record<string, PublicKey[]>) =>
    [ccv.outboundCcvs, ccv.thresholdOutboundCcvs, ccv.inboundCcvs, ccv.thresholdInboundCcvs].map(
      (ccvs) => ccvs!.map((key) => key.toBase58()),
    )

  it('keeps the finality, fees and CCVs edit omits', async () => {
    const { instructions } = await new EditChainConfigV2().generate(
      chain('2.0.0', await chainConfigV2Account(current)),
      base,
    )
    const { params } = decodeParams(instructions[0]!.data)

    assert.deepEqual(params.allowedFinalityConfig, { flags: 1, blockDepth: 10 })
    assert.deepEqual(params.tokenTransferFeeConfig, LANE_FEES)
    assert.equal(params.ccvConfig.thresholdAmount.toString(), '5000')
    assert.deepEqual(ccvsOf(params.ccvConfig), [[CCV_A], [CCV_B], [CCV_B], []])
  })

  it('replaces only the config fields edit passes', async () => {
    const lane = chain('2.0.0', await chainConfigV2Account(current))
    const finality = await new EditChainConfigV2().generate(lane, {
      ...base,
      allowedFinality: { finalityDepth: 3 },
    })
    let { params } = decodeParams(finality.instructions[0]!.data)
    assert.deepEqual(params.allowedFinalityConfig, { flags: 0, blockDepth: 3 })
    assert.deepEqual(params.tokenTransferFeeConfig, LANE_FEES)
    assert.deepEqual(ccvsOf(params.ccvConfig), [[CCV_A], [CCV_B], [CCV_B], []])

    const fees = await new EditChainConfigV2().generate(lane, {
      ...base,
      tokenTransferFeeConfig: FULL_CONFIG.tokenTransferFeeConfig,
    })
    ;({ params } = decodeParams(fees.instructions[0]!.data))
    assert.deepEqual(params.allowedFinalityConfig, { flags: 1, blockDepth: 10 })
    assert.equal(params.tokenTransferFeeConfig.isEnabled, false)
    assert.equal(params.tokenTransferFeeConfig.destGasOverhead, 0)
    assert.equal(params.ccvConfig.thresholdAmount.toString(), '5000')

    // `{}` clears the CCVs, and keeps the rest
    const cleared = await new EditChainConfigV2().generate(lane, { ...base, ccvConfig: {} })
    ;({ params } = decodeParams(cleared.instructions[0]!.data))
    assert.deepEqual(params.tokenTransferFeeConfig, LANE_FEES)
    assert.equal(params.ccvConfig.thresholdAmount.toString(), '0')
    assert.deepEqual(ccvsOf(params.ccvConfig), [[], [], [], []])
  })

  it('reads nothing from the lane when edit passes the full config', async () => {
    let reads = 0
    const lane = chain('2.0.0', null)
    const getAccountInfo = lane.connection.getAccountInfo.bind(lane.connection)
    lane.connection.getAccountInfo = (async (key: PublicKey) => {
      if (key.equals(CHAIN_CONFIG_V2)) reads++
      return getAccountInfo(key)
    }) as typeof getAccountInfo
    // the missing config is left to the program
    const { instructions } = await new EditChainConfigV2().generate(lane, {
      ...base,
      ...FULL_CONFIG,
    })
    assert.equal(instructions.length, 1)
    assert.equal(reads, 0)
  })

  it('rejects an edit that omits a field, of a lane without ChainConfigV2', async () => {
    const { ccvConfig: _, ...withoutCCVs } = FULL_CONFIG
    for (const account of [null, { owner: SystemProgram.programId, data: Buffer.alloc(0) }]) {
      for (const params of [base, { ...base, ...withoutCCVs }]) {
        await assert.rejects(
          () => new EditChainConfigV2().generate(chain('2.0.0', account), params),
          (err: unknown) =>
            err instanceof CCIPTokenPoolChainConfigNotFoundError &&
            err.context.address === CHAIN_CONFIG_V2.toBase58(),
        )
      }
    }
  })

  it('rejects an edit that omits a field, when the ChainConfigV2 cannot be decoded', async () => {
    await assert.rejects(
      () =>
        new EditChainConfigV2().generate(
          chain('2.0.0', { owner: POOL_PROGRAM, data: Buffer.alloc(16) }),
          base,
        ),
      (err: unknown) =>
        err instanceof CCTDataDecodeError && err.context.account === CHAIN_CONFIG_V2.toBase58(),
    )
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
