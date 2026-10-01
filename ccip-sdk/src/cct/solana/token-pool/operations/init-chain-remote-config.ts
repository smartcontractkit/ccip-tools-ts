import { type PublicKey, SystemProgram } from '@solana/web3.js'
import BN from 'bn.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { encodeAddressToAny } from '../../../../utils.ts'
import type { TransactionResult } from '../../../operation.ts'
import { parseRemoteAddress } from '../../../remote-address.ts'
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
  U64_MAX,
  parseOptionalPublicKey,
  parsePublicKey,
  resolveExistingPoolProgram,
  validateAuthorityMatchesWallet,
  validateBigInt,
  validateInteger,
} from '../../validate.ts'

/** Parameters shared by Solana token pool remote-config initialization generation and execution. */
type InitChainRemoteConfigParams = PoolProgramRef & {
  /** Token mint address managed by the local pool. */
  tokenAddress: string
  /** CCIP selector of the remote chain (`u64`). */
  remoteChainSelector: bigint
  /**
   * Remote token address in the remote chain's own format (`0x…` for EVM, base58 for Solana, …),
   * the family taken from `remoteChainSelector`. Left-padded to 32 bytes in the instruction.
   */
  remoteTokenAddress: string
  /** Decimals of the remote token (`u8`), not the local mint: an integer from 0 to 255; 0 is valid. */
  remoteTokenDecimals: number
  /** Pool owner. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

type ParsedInitChainRemoteConfigParams = {
  tokenAddress: PublicKey
  poolProgramAddress?: PublicKey
  payer: PublicKey
  authority: PublicKey
  remoteChainSelector: bigint
  remoteTokenAddress: string
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

/**
 * Initializes a previously unconfigured remote-chain config.
 *
 * @remarks Fails if the chain config already exists.
 */
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

    const remoteTokenAddress = parseRemoteAddress(
      this.name,
      'remoteTokenAddress',
      params.remoteTokenAddress,
      params.remoteChainSelector,
    )

    const payer = parsePublicKey(this.name, 'payer', params.payer)
    return {
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      poolProgramAddress: parseOptionalPublicKey(
        this.name,
        'poolProgramAddress',
        params.poolProgramAddress,
      ),
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

  /** Resolves the pool program on-chain, then builds the unsigned Solana `initChainRemoteConfig` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedInitChainRemoteConfigParams,
  ): Promise<UnsignedSolanaTx> {
    const poolProgram = await resolveExistingPoolProgram(
      this.name,
      chain,
      opts.tokenAddress,
      opts.poolProgramAddress,
    )
    const program = createTokenPoolProgram(chain, poolProgram, opts.payer)
    const state = deriveTokenPoolConfigPda(poolProgram, opts.tokenAddress)
    const chainConfig = deriveTokenPoolChainConfigPda(
      poolProgram,
      opts.remoteChainSelector,
      opts.tokenAddress,
    )
    const instruction = await program.methods
      .initChainRemoteConfig(new BN(opts.remoteChainSelector.toString()), opts.tokenAddress, {
        tokenAddress: { address: encodeAddressToAny(opts.remoteTokenAddress) },
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
      `${this.name}: token = ${opts.tokenAddress.toBase58()}, poolProgram = ${poolProgram.toBase58()}, remoteChainSelector = ${opts.remoteChainSelector}`,
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
