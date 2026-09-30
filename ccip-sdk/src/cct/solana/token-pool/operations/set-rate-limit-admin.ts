import type { PublicKey } from '@solana/web3.js'

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
  deriveTokenPoolConfigPda,
} from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import {
  parsePublicKey,
  resolvePoolProgram,
  validateAuthorityMatchesWallet,
} from '../../validate.ts'

/** Parameters shared by Solana token pool rate-limit admin generation and execution. */
type SetRateLimitAdminParams = PoolProgramRef & {
  /** Token mint address managed by the pool. */
  tokenAddress: string
  /** Address authorized to configure the pool's chain rate limits. */
  newRateLimitAdmin: string
  /** Pool owner. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

type ParsedSetRateLimitAdminParams = {
  tokenAddress: PublicKey
  newRateLimitAdmin: PublicKey
  poolProgram: PublicKey
  payer: PublicKey
  authority: PublicKey
}

/** Parameters for unsigned Solana token pool rate-limit admin configuration. */
export type GenerateSetRateLimitAdminParams = SolanaGenerateParams<SetRateLimitAdminParams>

/** Unsigned Solana token pool rate-limit admin configuration result. */
export type GenerateSetRateLimitAdminResult = UnsignedSolanaTx

/** Parameters for executing Solana token pool rate-limit admin configuration. */
export type ExecuteSetRateLimitAdminParams = SolanaExecuteParams<SetRateLimitAdminParams>

/** Result of executing Solana token pool rate-limit admin configuration. */
export type ExecuteSetRateLimitAdminResult = TransactionResult

/** Sets the administrator authorized to configure a Solana token pool's chain rate limits. */
export class SetRateLimitAdmin extends SolanaOperation<
  SetRateLimitAdminParams,
  UnsignedSolanaTx,
  ParsedSetRateLimitAdminParams
> {
  readonly name = 'setRateLimitAdmin'

  /** Parses public keys and defaults authority to payer without mutating caller params. */
  protected override parse(params: GenerateSetRateLimitAdminParams): ParsedSetRateLimitAdminParams {
    const payer = parsePublicKey(this.name, 'payer', params.payer)
    return {
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      newRateLimitAdmin: parsePublicKey(this.name, 'newRateLimitAdmin', params.newRateLimitAdmin),
      poolProgram: resolvePoolProgram(this.name, params),
      payer,
      authority:
        params.authority === undefined
          ? payer
          : parsePublicKey(this.name, 'authority', params.authority),
    }
  }

  /** Builds the unsigned Solana `setRateLimitAdmin` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedSetRateLimitAdminParams,
  ): Promise<UnsignedSolanaTx> {
    const program = createTokenPoolProgram(chain, opts.poolProgram, opts.payer)
    const instruction = await program.methods
      .setRateLimitAdmin(opts.tokenAddress, opts.newRateLimitAdmin)
      .accountsStrict({
        state: deriveTokenPoolConfigPda(opts.poolProgram, opts.tokenAddress),
        authority: opts.authority,
      })
      .instruction()

    chain.logger.debug(
      `${this.name}: token = ${opts.tokenAddress.toBase58()}, poolProgram = ${opts.poolProgram.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the pool owner wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteSetRateLimitAdminParams,
  ): Promise<ExecuteSetRateLimitAdminResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'setRateLimitAdmin requires authority to be the executing wallet. Use generateUnsignedSetRateLimitAdmin for externally signed transactions.',
      )
    }

    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
