import { Buffer } from 'buffer'

import { type PublicKey, SystemProgram } from '@solana/web3.js'
import BN from 'bn.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import {
  type PoolProgramRef,
  createTokenPoolProgram,
  deriveTokenPoolChainConfigPda,
  deriveTokenPoolConfigPda,
} from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import {
  parseHexBytes,
  parsePublicKey,
  resolvePoolProgram,
  validateAuthorityMatchesWallet,
  validateBigInt,
  validateInteger,
} from '../../validate.ts'

const U64_MAX = 0xffff_ffff_ffff_ffffn

/** Parameters shared by Solana token pool remote-config initialization generation and execution. */
type InitChainRemoteConfigParams = PoolProgramRef & {
  /** Token mint address managed by the local pool. */
  tokenAddress: string
  /** CCIP selector of the remote chain (`u64`). */
  remoteChainSelector: bigint
  /** Hex-encoded remote token address, optionally `0x`-prefixed, up to 32 bytes. Left-padded in the instruction. */
  remoteTokenAddress: string
  /** Remote token decimals (`u8`): an integer from 0 to 255; 0 is valid. */
  remoteTokenDecimals: number
  /** Pool owner. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

type ParsedInitChainRemoteConfigParams = {
  tokenAddress: PublicKey
  poolProgram: PublicKey
  payer: PublicKey
  authority: PublicKey
  remoteChainSelector: bigint
  remoteTokenAddress: Buffer
  remoteTokenDecimals: number
}

/** Parameters for unsigned Solana token pool remote configuration initialization. */
export type GenerateInitChainRemoteConfigParams = SolanaGenerateParams<InitChainRemoteConfigParams>

/** Unsigned Solana token pool remote configuration initialization result. */
export type GenerateInitChainRemoteConfigResult = UnsignedSolanaTx

/** Parameters for executing Solana token pool remote configuration initialization. */
export type ExecuteInitChainRemoteConfigParams = SolanaExecuteParams<InitChainRemoteConfigParams>

/** Result of executing Solana token pool remote configuration initialization. */
export type ExecuteInitChainRemoteConfigResult = TransactionResult

/** Initializes a previously unconfigured remote-chain config. */
export class InitChainRemoteConfig extends SolanaOperation<
  InitChainRemoteConfigParams,
  UnsignedSolanaTx,
  ParsedInitChainRemoteConfigParams
> {
  readonly name = 'initChainRemoteConfig'

  /** Parses config values and defaults authority to payer without mutating caller params. */
  protected override parse(
    params: GenerateInitChainRemoteConfigParams,
  ): ParsedInitChainRemoteConfigParams {
    validateBigInt(this.name, 'remoteChainSelector', params.remoteChainSelector, 0n, U64_MAX)
    validateInteger(this.name, 'remoteTokenDecimals', params.remoteTokenDecimals, 0, 255)

    const remoteTokenAddress = parseHexBytes(
      this.name,
      'remoteTokenAddress',
      params.remoteTokenAddress,
      32,
    )

    if (!remoteTokenAddress.length) {
      throw new CCTParamsInvalidError(this.name, 'remoteTokenAddress', 'must not be empty')
    }

    const payer = parsePublicKey(this.name, 'payer', params.payer)
    return {
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      poolProgram: resolvePoolProgram(this.name, params),
      payer,
      authority:
        params.authority === undefined
          ? payer
          : parsePublicKey(this.name, 'authority', params.authority),
      remoteChainSelector: params.remoteChainSelector,
      remoteTokenAddress,
      remoteTokenDecimals: params.remoteTokenDecimals,
    }
  }

  /** Builds the unsigned Solana `initChainRemoteConfig` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedInitChainRemoteConfigParams,
  ): Promise<UnsignedSolanaTx> {
    const program = createTokenPoolProgram(chain, opts.poolProgram, opts.payer)
    const state = deriveTokenPoolConfigPda(opts.poolProgram, opts.tokenAddress)
    const chainConfig = deriveTokenPoolChainConfigPda(
      opts.poolProgram,
      opts.remoteChainSelector,
      opts.tokenAddress,
    )
    const tokenAddress = Buffer.alloc(32)
    opts.remoteTokenAddress.copy(tokenAddress, 32 - opts.remoteTokenAddress.length)

    const instruction = await program.methods
      .initChainRemoteConfig(new BN(opts.remoteChainSelector.toString()), opts.tokenAddress, {
        tokenAddress: { address: tokenAddress },
        poolAddresses: [],
        decimals: opts.remoteTokenDecimals,
      })
      .accountsStrict({
        state,
        chainConfig,
        authority: opts.authority,
        systemProgram: SystemProgram.programId,
      })
      .instruction()

    chain.logger.debug(
      `${this.name}: token = ${opts.tokenAddress.toBase58()}, poolProgram = ${opts.poolProgram.toBase58()}, remoteChainSelector = ${opts.remoteChainSelector}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the pool owner wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteInitChainRemoteConfigParams,
  ): Promise<ExecuteInitChainRemoteConfigResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'initChainRemoteConfig requires authority to be the executing wallet. Use generateUnsignedInitChainRemoteConfig for externally signed transactions.',
      )
    }

    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
