import { AuthorityType, createSetAuthorityInstruction } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import type { TransactionHash } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import { validatePublicKey } from '../../validate.ts'
import { detectMintTokenProgram } from './spl.ts'

/** Parameters for transferring SPL mint authority. The `payer` must be the current mint authority. */
type TransferMintAuthorityParams = {
  /** SPL token mint to reassign. */
  mint: string
  /** New mint authority (base58) — typically a multisig or pool signer PDA. */
  newMintAuthority: string
}

/** Parameters for unsigned Solana transfer-mint-authority generation. */
export type GenerateTransferMintAuthorityParams = SolanaGenerateParams<TransferMintAuthorityParams>

/** Unsigned Solana transfer-mint-authority result. */
export type GenerateTransferMintAuthorityResult = UnsignedSolanaTx

/** Parameters for executing Solana transfer-mint-authority. */
export type ExecuteTransferMintAuthorityParams = SolanaExecuteParams<TransferMintAuthorityParams>

/** Result of executing Solana transfer-mint-authority. */
export type ExecuteTransferMintAuthorityResult = TransactionHash

/**
 * Reassigns an SPL mint's `MintTokens` authority via `setAuthority`. The executing
 * wallet (or `payer` for unsigned generation) must be the current mint authority.
 */
export class TransferMintAuthority extends SolanaOperation<TransferMintAuthorityParams> {
  readonly name = 'transferMintAuthority'

  /** Validates the mint, new authority, and payer public keys before any RPC. */
  protected validate(params: GenerateTransferMintAuthorityParams): void {
    validatePublicKey(this.name, 'payer', params.payer)
    validatePublicKey(this.name, 'mint', params.mint)
    validatePublicKey(this.name, 'newMintAuthority', params.newMintAuthority)
  }

  /** Builds the unsigned SPL `setAuthority(MintTokens)` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    params: GenerateTransferMintAuthorityParams,
  ): Promise<GenerateTransferMintAuthorityResult> {
    const currentAuthority = new PublicKey(params.payer)
    const mint = new PublicKey(params.mint)
    const newMintAuthority = new PublicKey(params.newMintAuthority)

    const tokenProgramId = await detectMintTokenProgram(chain, this.name, 'mint', mint)

    const instruction = createSetAuthorityInstruction(
      mint,
      currentAuthority,
      AuthorityType.MintTokens,
      newMintAuthority,
      [],
      tokenProgramId,
    )

    chain.logger.debug(
      `${this.name}: mint = ${mint.toBase58()}, newMintAuthority = ${newMintAuthority.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }
}
