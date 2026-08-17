import { PublicKey } from '@solana/web3.js'

import { GetTokenPoolState } from './get-token-pool-state.ts'
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
  deriveTokenPoolConfigPda,
} from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import {
  parsePublicKey,
  resolvePoolProgram,
  validateAuthorityMatchesWallet,
} from '../../validate.ts'

/** Parameters shared by Solana token pool ownership-acceptance generation and execution. */
type AcceptPoolOwnershipParams = PoolProgramRef & {
  /** Token mint address managed by the pool. */
  tokenAddress: string
  /** Proposed pool owner accepting ownership. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

type ParsedAcceptPoolOwnershipParams = {
  tokenAddress: PublicKey
  poolProgram: PublicKey
  payer: PublicKey
  authority: PublicKey
}

/** Parameters for unsigned Solana token pool ownership acceptance. */
export type GenerateAcceptPoolOwnershipParams = SolanaGenerateParams<AcceptPoolOwnershipParams>

/** Unsigned Solana token pool ownership acceptance result. */
export type GenerateAcceptPoolOwnershipResult = UnsignedSolanaTx

/** Parameters for executing Solana token pool ownership acceptance. */
export type ExecuteAcceptPoolOwnershipParams = SolanaExecuteParams<AcceptPoolOwnershipParams>

/** Result of executing Solana token pool ownership acceptance. */
export type ExecuteAcceptPoolOwnershipResult = TransactionResult

/** Accepts pending ownership of a Solana token pool. */
export class AcceptPoolOwnership extends SolanaOperation<
  AcceptPoolOwnershipParams,
  UnsignedSolanaTx,
  ParsedAcceptPoolOwnershipParams
> {
  readonly name = 'acceptPoolOwnership'

  /** Parses public keys and defaults authority to payer without mutating caller params. */
  protected override parse(
    params: GenerateAcceptPoolOwnershipParams,
  ): ParsedAcceptPoolOwnershipParams {
    const payer = parsePublicKey(this.name, 'payer', params.payer)
    return {
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      poolProgram: resolvePoolProgram(this.name, params),
      payer,
      authority:
        params.authority === undefined
          ? payer
          : parsePublicKey(this.name, 'authority', params.authority),
    }
  }

  /** Confirms the authority is the proposed owner, then builds the unsigned `acceptOwnership` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedAcceptPoolOwnershipParams,
  ): Promise<UnsignedSolanaTx> {
    const { config } = await new GetTokenPoolState().query(chain, {
      tokenAddress: opts.tokenAddress.toBase58(),
      poolProgramAddress: opts.poolProgram.toBase58(),
    })
    const proposedOwner = new PublicKey(config.proposedOwner)
    if (proposedOwner.equals(PublicKey.default)) {
      throw new CCTParamsInvalidError(this.name, 'authority', 'no proposed owner')
    }
    if (!proposedOwner.equals(opts.authority)) {
      throw new CCTParamsInvalidError(this.name, 'authority', 'must be the proposed owner')
    }

    const instruction = await createTokenPoolProgram(chain, opts.poolProgram, opts.payer)
      .methods.acceptOwnership()
      .accountsStrict({
        state: deriveTokenPoolConfigPda(opts.poolProgram, opts.tokenAddress),
        mint: opts.tokenAddress,
        authority: opts.authority,
      })
      .instruction()

    chain.logger.debug(
      `${this.name}: token = ${opts.tokenAddress.toBase58()}, poolProgram = ${opts.poolProgram.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the proposed owner wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteAcceptPoolOwnershipParams,
  ): Promise<ExecuteAcceptPoolOwnershipResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'acceptPoolOwnership requires authority to be the executing wallet. Use generateUnsignedAcceptPoolOwnership for externally signed transactions.',
      )
    }

    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
