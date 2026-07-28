import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'

/** Parameters for revoking mint/burn access — unsupported on Solana. */
type RevokeMintBurnAccessParams = {
  /** SPL token mint (base58). */
  tokenAddress: string
  /** Address whose access would be revoked (base58). */
  authority: string
  /** Which role to revoke. */
  role: 'mint' | 'burn'
}

/** Parameters for unsigned Solana revoke-mint-burn-access generation. */
export type GenerateRevokeMintBurnAccessParams = SolanaGenerateParams<RevokeMintBurnAccessParams>

/** Unsigned Solana revoke-mint-burn-access result. */
export type GenerateRevokeMintBurnAccessResult = UnsignedSolanaTx

/** Parameters for executing Solana revoke-mint-burn-access. */
export type ExecuteRevokeMintBurnAccessParams = SolanaExecuteParams<RevokeMintBurnAccessParams>

/** Result of executing Solana revoke-mint-burn-access. */
export type ExecuteRevokeMintBurnAccessResult = TransactionHash

/**
 * Not supported on Solana. SPL tokens use a single mint-authority model with no role-based
 * grants to revoke — always throws {@link CCTParamsInvalidError}. Use `transferMintAuthority`
 * to move the mint authority elsewhere instead.
 */
export class RevokeMintBurnAccess extends SolanaOperation<RevokeMintBurnAccessParams> {
  readonly name = 'revokeMintBurnAccess'

  /** Always throws — role-based revoke is not supported on Solana. */
  protected validate(_params: GenerateRevokeMintBurnAccessParams): void {
    throw new CCTParamsInvalidError(
      this.name,
      'chain',
      'Solana SPL tokens do not support role-based revoke. Use transferMintAuthority to transfer mint authority instead',
    )
  }

  /** Unreachable in practice — {@link validate} always throws first. */
  protected buildUnsigned(
    _chain: SolanaChain,
    params: GenerateRevokeMintBurnAccessParams,
  ): Promise<GenerateRevokeMintBurnAccessResult> {
    this.validate(params)
    return Promise.reject(
      new CCTParamsInvalidError(
        this.name,
        'chain',
        'Solana SPL tokens do not support role-based revoke. Use transferMintAuthority to transfer mint authority instead',
      ),
    )
  }
}
