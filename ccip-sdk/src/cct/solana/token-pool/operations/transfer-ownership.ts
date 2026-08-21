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

/** Parameters shared by Solana token pool ownership-transfer generation and execution. */
type TransferOwnershipParams = PoolProgramRef & {
  /** Token mint address managed by the pool. */
  tokenAddress: string
  /** Address proposed as the next pool owner. It must accept ownership separately. */
  newOwner: string
  /** Current pool owner. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

type ParsedTransferOwnershipParams = {
  tokenAddress: PublicKey
  newOwner: PublicKey
  poolProgram: PublicKey
  payer: PublicKey
  authority: PublicKey
}

/** Parameters for unsigned Solana token pool ownership transfer. */
export type GenerateTransferOwnershipParams = SolanaGenerateParams<TransferOwnershipParams>

/** Unsigned Solana token pool ownership transfer result. */
export type GenerateTransferOwnershipResult = UnsignedSolanaTx

/** Parameters for executing Solana token pool ownership transfer. */
export type ExecuteTransferOwnershipParams = SolanaExecuteParams<TransferOwnershipParams>

/** Result of executing Solana token pool ownership transfer. */
export type ExecuteTransferOwnershipResult = TransactionResult

/** Proposes a new owner for a Solana token pool. The proposed owner must accept separately. */
export class TransferOwnership extends SolanaOperation<
  TransferOwnershipParams,
  UnsignedSolanaTx,
  ParsedTransferOwnershipParams
> {
  readonly name = 'transferOwnership'

  /** Parses public keys and defaults authority to payer without mutating caller params. */
  protected override parse(params: GenerateTransferOwnershipParams): ParsedTransferOwnershipParams {
    const payer = parsePublicKey(this.name, 'payer', params.payer)
    const newOwner = parsePublicKey(this.name, 'newOwner', params.newOwner)
    if (newOwner.equals(PublicKey.default)) {
      throw new CCTParamsInvalidError(
        this.name,
        'newOwner',
        'must not be the default public key or zero address',
      )
    }

    return {
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      newOwner,
      poolProgram: resolvePoolProgram(this.name, params),
      payer,
      authority:
        params.authority === undefined
          ? payer
          : parsePublicKey(this.name, 'authority', params.authority),
    }
  }

  /** Reads the pool state to reject self-transfer, then builds the unsigned Solana `transferOwnership` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedTransferOwnershipParams,
  ): Promise<UnsignedSolanaTx> {
    const { config } = await new GetTokenPoolState().query(chain, {
      tokenAddress: opts.tokenAddress.toBase58(),
      poolProgramAddress: opts.poolProgram.toBase58(),
    })

    if (opts.newOwner.equals(new PublicKey(config.owner))) {
      throw new CCTParamsInvalidError(this.name, 'newOwner', 'must not be the current pool owner')
    }

    const program = createTokenPoolProgram(chain, opts.poolProgram, opts.payer)
    const instruction = await program.methods
      .transferOwnership(opts.newOwner)
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

  /** Generate, sign, simulate, send, and confirm with the current pool owner wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteTransferOwnershipParams,
  ): Promise<ExecuteTransferOwnershipResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'transferOwnership requires authority to be the executing wallet. Use generateUnsignedTransferOwnership for externally signed transactions.',
      )
    }

    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
