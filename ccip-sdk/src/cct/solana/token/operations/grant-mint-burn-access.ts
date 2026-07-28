import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import { validatePublicKey } from '../../validate.ts'
import { TransferMintAuthority } from './transfer-mint-authority.ts'

/**
 * Which role(s) to grant. On Solana, SPL tokens have a single mint authority and burn is
 * implicit for any holder, so only `'mint'` and `'mintAndBurn'` are valid; `'burn'` is rejected.
 */
export type MintBurnRole = 'mint' | 'burn' | 'mintAndBurn'

/** Parameters for granting mint/burn access on a Solana SPL token. */
type GrantMintBurnAccessParams = {
  /** SPL token mint (base58) whose mint authority is being reassigned. */
  tokenAddress: string
  /** Address to receive mint authority (base58) — pool multisig or signer PDA. */
  authority: string
  /** Which role(s) to grant. Defaults to `'mintAndBurn'`; `'burn'` is not supported on Solana. */
  role?: MintBurnRole
}

/** Parameters for unsigned Solana grant-mint-burn-access generation. */
export type GenerateGrantMintBurnAccessParams = SolanaGenerateParams<GrantMintBurnAccessParams>

/** Unsigned Solana grant-mint-burn-access result. */
export type GenerateGrantMintBurnAccessResult = UnsignedSolanaTx

/** Parameters for executing Solana grant-mint-burn-access. */
export type ExecuteGrantMintBurnAccessParams = SolanaExecuteParams<GrantMintBurnAccessParams>

/** Result of executing Solana grant-mint-burn-access. */
export type ExecuteGrantMintBurnAccessResult = TransactionHash

/**
 * Grants mint/burn access on a Solana SPL token by transferring the mint authority to
 * `authority` (`setAuthority(MintTokens)`). Thin wrapper over {@link TransferMintAuthority}
 * that maps `tokenAddress` → `mint` and `authority` → `newMintAuthority`.
 */
export class GrantMintBurnAccess extends SolanaOperation<GrantMintBurnAccessParams> {
  readonly name = 'grantMintBurnAccess'
  readonly #transfer = new TransferMintAuthority()

  /** Validates public keys and rejects the unsupported `'burn'` role before any RPC. */
  protected validate(params: GenerateGrantMintBurnAccessParams): void {
    validatePublicKey(this.name, 'payer', params.payer)
    validatePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    validatePublicKey(this.name, 'authority', params.authority)
    if (params.role === 'burn') {
      throw new CCTParamsInvalidError(
        this.name,
        'role',
        "Solana SPL tokens do not have a separate burn authority — any token holder can burn. Use 'mint' or 'mintAndBurn' instead",
      )
    }
  }

  /** Delegates to {@link TransferMintAuthority} to build the `setAuthority` instruction. */
  protected buildUnsigned(
    chain: SolanaChain,
    params: GenerateGrantMintBurnAccessParams,
  ): Promise<GenerateGrantMintBurnAccessResult> {
    return this.#transfer.generate(chain, {
      payer: params.payer,
      mint: params.tokenAddress,
      newMintAuthority: params.authority,
    })
  }
}
