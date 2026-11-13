import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { describe, it } from 'node:test'

import { type PublicKey, Keypair, SystemProgram } from '@solana/web3.js'
import BN from 'bn.js'

import { tokenPoolV2Coder } from '../../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { deriveTokenPoolChainConfigV2Pda } from '../../../../solana/token-pool.ts'
import {
  CCTDataDecodeError,
  CCTOperationUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
import { resolveTokenPoolProgram } from '../../programs/token-pool.ts'
import { EditChainConfigV2 } from './edit-chain-config-v2.ts'
import { GetCCVConfig } from './get-ccv-config.ts'

const MINT = Keypair.generate().publicKey
const CCV_A = Keypair.generate().publicKey
const CCV_B = Keypair.generate().publicKey
const CCV_C = Keypair.generate().publicKey
const SELECTOR = 16015286601757825753n
const POOL_PROGRAM = resolveTokenPoolProgram('burn-mint')
const CHAIN_CONFIG_V2 = deriveTokenPoolChainConfigV2Pda(POOL_PROGRAM, SELECTOR, MINT)

/** A `ChainConfigV2` with CCVs in every list but `threshold_inbound_ccvs`, via the full IDL. */
async function chainConfigV2Data(): Promise<Buffer> {
  return tokenPoolV2Coder.accounts.encode('chainConfigV2', {
    bump: 255,
    version: 1,
    remoteChainSelector: new BN(SELECTOR.toString()),
    mint: MINT,
    allowedFinalityConfig: { flags: 0, blockDepth: 0 },
    tokenTransferFeeConfig: {
      destGasOverhead: 0,
      destBytesOverhead: 0,
      finalityFee: 0,
      fastFinalityFee: 0,
      finalityBpsFee: 0,
      fastFinalityBpsFee: 0,
      isEnabled: false,
    },
    ccvConfig: {
      thresholdAmount: new BN('18446744073709551615'), // u64 max survives as a bigint
      outboundCcvs: [CCV_A],
      thresholdOutboundCcvs: [CCV_B],
      inboundCcvs: [CCV_B, CCV_C],
      thresholdInboundCcvs: [],
    },
  })
}

/** A chain whose canonical burn-mint pool runs `version`, with the lane's `ChainConfigV2`. */
function chain(
  chainConfigV2: { owner: PublicKey; data: Buffer } | null,
  version = '2.0.0',
): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getMultipleAccountsInfo: async () => [{}],
      getAccountInfo: async (key: PublicKey) => (key.equals(CHAIN_CONFIG_V2) ? chainConfigV2 : {}),
    },
    typeAndVersion: async () => ['burnmintTokenPool', version],
  } as unknown as SolanaChain
}

const params = { tokenAddress: MINT.toBase58(), remoteChainSelector: SELECTOR }

describe('GetCCVConfig (cct/solana)', () => {
  it("reads the lane's CCVs from its ChainConfigV2", async () => {
    const config = await new GetCCVConfig().query(
      chain({ owner: POOL_PROGRAM, data: await chainConfigV2Data() }),
      params,
    )

    assert.deepEqual(config, {
      outboundCCVs: [CCV_A.toBase58()],
      thresholdOutboundCCVs: [CCV_B.toBase58()],
      inboundCCVs: [CCV_B.toBase58(), CCV_C.toBase58()],
      thresholdInboundCCVs: [],
      thresholdAmount: 2n ** 64n - 1n,
    })
  })

  it('returns no CCVs for a lane without ChainConfigV2', async () => {
    const empty = {
      outboundCCVs: [],
      thresholdOutboundCCVs: [],
      inboundCCVs: [],
      thresholdInboundCCVs: [],
      thresholdAmount: 0n,
    }
    assert.deepEqual(await new GetCCVConfig().query(chain(null), params), empty)
    // lamports sent to the PDA do not initialize it
    const funded = { owner: SystemProgram.programId, data: Buffer.alloc(0) }
    assert.deepEqual(await new GetCCVConfig().query(chain(funded), params), empty)
  })

  it('round-trips into editChainConfigV2', async () => {
    const lane = chain({ owner: POOL_PROGRAM, data: await chainConfigV2Data() })
    const config = await new GetCCVConfig().query(lane, params)
    const { instructions } = await new EditChainConfigV2().generate(lane, {
      ...params,
      payer: Keypair.generate().publicKey.toBase58(),
      ccvConfig: { ...config, thresholdInboundCCVs: [CCV_A.toBase58()] },
    })
    const decoded = tokenPoolV2Coder.instruction.decode(instructions[0]!.data)
    const ccv = (decoded!.data as { params: { ccvConfig: Record<string, any> } }).params.ccvConfig

    assert.equal(ccv.thresholdAmount.toString(), (2n ** 64n - 1n).toString())
    assert.deepEqual(
      [ccv.outboundCcvs, ccv.thresholdOutboundCcvs, ccv.inboundCcvs, ccv.thresholdInboundCcvs].map(
        (ccvs: PublicKey[]) => ccvs.map((key) => key.toBase58()),
      ),
      [[CCV_A], [CCV_B], [CCV_B, CCV_C], [CCV_A]].map((ccvs) => ccvs.map((k) => k.toBase58())),
    )
  })

  it('rejects an undecodable ChainConfigV2', async () => {
    await assert.rejects(
      () =>
        new GetCCVConfig().query(chain({ owner: POOL_PROGRAM, data: Buffer.alloc(16) }), params),
      (err: unknown) =>
        err instanceof CCTDataDecodeError && err.context.account === CHAIN_CONFIG_V2.toBase58(),
    )
  })

  it('rejects pools before CCIP 2.0', async () => {
    await assert.rejects(
      () => new GetCCVConfig().query(chain(null, '1.6.2'), params),
      (err: unknown) =>
        err instanceof CCTOperationUnsupportedError && err.context.version === '1.6.2',
    )
  })

  it('validates its params before any RPC', async () => {
    for (const [opts, param] of [
      [{ tokenAddress: 'invalid' }, 'tokenAddress'],
      [{ poolProgramAddress: 'invalid' }, 'poolProgramAddress'],
      [{ remoteChainSelector: -1n }, 'remoteChainSelector'],
      [{ remoteChainSelector: 1 }, 'remoteChainSelector'],
    ] as const) {
      await assert.rejects(
        () => new GetCCVConfig().query({} as SolanaChain, { ...params, ...opts } as never),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        param,
      )
    }
  })
})
