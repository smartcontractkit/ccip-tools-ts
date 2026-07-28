/**
 * Aptos token `revokeMintBurnAccess` operation.
 *
 * Revokes mint or burn access on a managed or regulated token from a pool's
 * resource signer. Auto-detects the pool type from the `authority` (pool object)
 * address. Managed tokens remove the signer from the minter/burner allowlist;
 * regulated tokens revoke the numeric role. Always a single transaction, so it
 * uses the single-tx base flow.
 *
 * Lock-release pools (which neither mint nor burn) and generic `burn_mint`
 * pools (which require creator-only initialization) are rejected.
 *
 * @packageDocumentation
 */

import { AccountAddress } from '@aptos-labs/ts-sdk'

import type { AptosChain } from '../../../../aptos/index.ts'
import type { UnsignedAptosTx } from '../../../../aptos/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import { detectPoolType, ensurePoolInitialized, resolveTokenCodeObject } from '../../common.ts'
import {
  type AptosExecuteParams,
  type AptosGenerateParams,
  AptosOperation,
} from '../../operation.ts'

/** Parameters shared by Aptos token `revokeMintBurnAccess` generation and execution. */
type RevokeMintBurnAccessParams = {
  /** Fungible asset metadata address (the token to revoke access on). */
  tokenAddress: string
  /** Pool object address whose resource signer loses mint/burn access. */
  authority: string
  /** Which role to revoke — must be specified explicitly. */
  role: 'mint' | 'burn'
}

/** Parameters for unsigned Aptos token `revokeMintBurnAccess` generation. */
export type GenerateRevokeMintBurnAccessParams = AptosGenerateParams<RevokeMintBurnAccessParams>

/** Unsigned Aptos token `revokeMintBurnAccess` result. */
export type GenerateRevokeMintBurnAccessResult = UnsignedAptosTx

/** Parameters for executing Aptos token `revokeMintBurnAccess`. */
export type ExecuteRevokeMintBurnAccessParams = AptosExecuteParams<RevokeMintBurnAccessParams>

/** Result of executing Aptos token `revokeMintBurnAccess`. */
export type ExecuteRevokeMintBurnAccessResult = TransactionHash

/** Aptos token `revokeMintBurnAccess` operation. */
export class RevokeMintBurnAccess extends AptosOperation<RevokeMintBurnAccessParams> {
  readonly name = 'revokeMintBurnAccess'

  /** Validates the token, authority, and role before any RPC. */
  protected validate(params: GenerateRevokeMintBurnAccessParams): void {
    if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'tokenAddress', 'must be non-empty')
    }
    if (!params.authority || params.authority.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'authority', 'must be non-empty')
    }
    const role: string = params.role
    if (role !== 'mint' && role !== 'burn') {
      throw new CCTParamsInvalidError(this.name, 'role', "must be 'mint' or 'burn'")
    }
  }

  /**
   * Detects the pool type, resolves the pool resource signer and token code
   * object, and builds the single revoke transaction.
   */
  protected async buildUnsigned(
    chain: AptosChain,
    params: GenerateRevokeMintBurnAccessParams,
  ): Promise<UnsignedAptosTx> {
    const poolInfo = await detectPoolType(chain, params.authority)

    if (poolInfo.type === 'lock_release') {
      throw new CCTParamsInvalidError(
        this.name,
        'authority',
        'lock-release pools do not mint or burn tokens — no access to revoke',
      )
    }

    if (poolInfo.type === 'burn_mint') {
      throw new CCTParamsInvalidError(
        this.name,
        'authority',
        'burn_mint_token_pool requires initialization by the token creator module. Revoke is not supported via SDK.',
      )
    }

    await ensurePoolInitialized(chain, params.authority, poolInfo.module)

    const [poolResourceSigner] = await chain.provider.view<[string]>({
      payload: {
        function: `${params.authority}::${poolInfo.module}::get_store_address`,
      },
    })

    const tokenCodeObject = await resolveTokenCodeObject(chain, params.tokenAddress)

    let tx
    if (poolInfo.type === 'managed') {
      // managed_token: remove pool resource signer from minters or burners.
      const fnName =
        params.role === 'mint' ? 'apply_allowed_minter_updates' : 'apply_allowed_burner_updates'
      tx = await chain.provider.transaction.build.simple({
        sender: AccountAddress.from(params.sender),
        data: {
          function: `${tokenCodeObject}::managed_token::${fnName}`,
          functionArguments: [[poolResourceSigner], []], // remove=[signer], add=[]
        },
      })
    } else {
      // regulated_token: MINTER_ROLE=4, BURNER_ROLE=5.
      const roleNumber = params.role === 'mint' ? 4 : 5
      tx = await chain.provider.transaction.build.simple({
        sender: AccountAddress.from(params.sender),
        data: {
          function: `${tokenCodeObject}::regulated_token::revoke_role`,
          functionArguments: [roleNumber, poolResourceSigner],
        },
      })
    }

    chain.logger.debug(
      `${this.name}: pool type = ${poolInfo.type}, role = ${params.role}, poolResourceSigner = ${poolResourceSigner}`,
    )
    return { family: ChainFamily.Aptos, transactions: [tx.bcsToBytes()] }
  }
}
