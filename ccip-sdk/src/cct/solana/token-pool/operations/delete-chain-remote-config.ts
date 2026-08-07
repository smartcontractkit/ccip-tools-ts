import type { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
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
  parsePublicKey,
  resolvePoolProgram,
  validateAuthorityMatchesWallet,
  validateBigInt,
} from '../../validate.ts'

const U64_MAX = 0xffff_ffff_ffff_ffffn

type DeleteChainRemoteConfigParams = PoolProgramRef & {
  /** Token mint address managed by the local pool. */
  tokenAddress: string
  /** CCIP selector of the remote chain (`u64`). */
  remoteChainSelector: bigint
  /** Pool owner. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

type ParsedDeleteChainRemoteConfigParams = {
  tokenAddress: PublicKey
  poolProgram: PublicKey
  payer: PublicKey
  authority: PublicKey
  remoteChainSelector: bigint
}

/** Parameters for unsigned Solana token pool remote configuration deletion. */
export type GenerateDeleteChainRemoteConfigParams =
  SolanaGenerateParams<DeleteChainRemoteConfigParams>

/** Unsigned Solana token pool remote configuration deletion result. */
export type GenerateDeleteChainRemoteConfigResult = UnsignedSolanaTx

/** Parameters for executing Solana token pool remote configuration deletion. */
export type ExecuteDeleteChainRemoteConfigParams =
  SolanaExecuteParams<DeleteChainRemoteConfigParams>

/** Result of executing Solana token pool remote configuration deletion. */
export type ExecuteDeleteChainRemoteConfigResult = TransactionResult

/** Deletes an initialized remote-chain config. */
export class DeleteChainRemoteConfig extends SolanaOperation<
  DeleteChainRemoteConfigParams,
  UnsignedSolanaTx,
  ParsedDeleteChainRemoteConfigParams
> {
  readonly name = 'deleteChainRemoteConfig'

  /** Parses addresses and defaults authority to payer without mutating caller params. */
  protected override parse(
    params: GenerateDeleteChainRemoteConfigParams,
  ): ParsedDeleteChainRemoteConfigParams {
    validateBigInt(this.name, 'remoteChainSelector', params.remoteChainSelector, 0n, U64_MAX)

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
    }
  }

  /** Builds the unsigned Solana `deleteChainConfig` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedDeleteChainRemoteConfigParams,
  ): Promise<UnsignedSolanaTx> {
    const program = createTokenPoolProgram(chain, opts.poolProgram, opts.payer)
    const instruction = await program.methods
      .deleteChainConfig(new BN(opts.remoteChainSelector.toString()), opts.tokenAddress)
      .accountsStrict({
        state: deriveTokenPoolConfigPda(opts.poolProgram, opts.tokenAddress),
        chainConfig: deriveTokenPoolChainConfigPda(
          opts.poolProgram,
          opts.remoteChainSelector,
          opts.tokenAddress,
        ),
        authority: opts.authority,
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
    params: ExecuteDeleteChainRemoteConfigParams,
  ): Promise<ExecuteDeleteChainRemoteConfigResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'deleteChainRemoteConfig requires authority to be the executing wallet. Use generateUnsignedDeleteChainRemoteConfig for externally signed transactions.',
      )
    }

    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
