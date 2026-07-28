/**
 * Aptos token `grantMintBurnAccess` operation.
 *
 * Grants mint and/or burn access on a managed or regulated token to a pool's
 * resource signer. Auto-detects the pool type from the `authority` (pool object)
 * address. Managed tokens use minter/burner allowlists; regulated tokens use
 * numeric role grants. `mintAndBurn` on a managed token produces **two**
 * transactions, so {@link execute} submits them sequentially.
 *
 * Lock-release pools (which neither mint nor burn) and generic `burn_mint`
 * pools (which require creator-only initialization) are rejected.
 *
 * @packageDocumentation
 */

import { AccountAddress } from '@aptos-labs/ts-sdk'

import type { AptosChain } from '../../../../aptos/index.ts'
import { type UnsignedAptosTx, isAptosAccount } from '../../../../aptos/types.ts'
import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import { detectPoolType, ensurePoolInitialized, resolveTokenCodeObject } from '../../common.ts'
import {
  type AptosExecuteParams,
  type AptosGenerateParams,
  AptosOperation,
} from '../../operation.ts'
import { submit } from '../../submit.ts'

/** Which role(s) to grant. */
type MintBurnRole = 'mint' | 'burn' | 'mintAndBurn'

/** Parameters shared by Aptos token `grantMintBurnAccess` generation and execution. */
type GrantMintBurnAccessParams = {
  /** Fungible asset metadata address (the token to grant access on). */
  tokenAddress: string
  /** Pool object address whose resource signer receives mint/burn access. */
  authority: string
  /** Which role(s) to grant. Defaults to `'mintAndBurn'`. */
  role?: MintBurnRole
}

/** Parameters for unsigned Aptos token `grantMintBurnAccess` generation. */
export type GenerateGrantMintBurnAccessParams = AptosGenerateParams<GrantMintBurnAccessParams>

/** Unsigned Aptos token `grantMintBurnAccess` result (one or two transactions). */
export type GenerateGrantMintBurnAccessResult = UnsignedAptosTx

/** Parameters for executing Aptos token `grantMintBurnAccess`. */
export type ExecuteGrantMintBurnAccessParams = AptosExecuteParams<GrantMintBurnAccessParams>

/** Result of executing Aptos token `grantMintBurnAccess`. */
export type ExecuteGrantMintBurnAccessResult = TransactionHash

/** Aptos token `grantMintBurnAccess` operation. */
export class GrantMintBurnAccess extends AptosOperation<GrantMintBurnAccessParams> {
  readonly name = 'grantMintBurnAccess'

  /** Validates the token and authority addresses before any RPC. */
  protected validate(params: GenerateGrantMintBurnAccessParams): void {
    if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'tokenAddress', 'must be non-empty')
    }
    if (!params.authority || params.authority.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'authority', 'must be non-empty')
    }
  }

  /**
   * Detects the pool type, resolves the pool resource signer and token code
   * object, and builds the minter/burner (managed) or role-grant (regulated)
   * transactions.
   */
  protected async buildUnsigned(
    chain: AptosChain,
    params: GenerateGrantMintBurnAccessParams,
  ): Promise<UnsignedAptosTx> {
    const poolInfo = await detectPoolType(chain, params.authority)

    if (poolInfo.type === 'lock_release') {
      throw new CCTParamsInvalidError(
        this.name,
        'authority',
        'lock-release pools do not mint or burn tokens — no access to grant',
      )
    }

    if (poolInfo.type === 'burn_mint') {
      throw new CCTParamsInvalidError(
        this.name,
        'authority',
        'burn_mint_token_pool requires initialization by the token creator module. ' +
          'The token creator must call burn_mint_token_pool::initialize() with stored BurnRef/MintRef. ' +
          'This cannot be done via SDK because the capability refs are only available to the token creator.',
      )
    }

    await ensurePoolInitialized(chain, params.authority, poolInfo.module)

    // Pool resource signer address (the address that calls mint/burn).
    const [poolResourceSigner] = await chain.provider.view<[string]>({
      payload: {
        function: `${params.authority}::${poolInfo.module}::get_store_address`,
      },
    })

    const tokenCodeObject = await resolveTokenCodeObject(chain, params.tokenAddress)

    const role = params.role ?? 'mintAndBurn'
    const parts: Uint8Array[] = []

    if (poolInfo.type === 'managed') {
      // managed_token: add pool resource signer to allowed minters and/or burners.
      // Consecutive sequence numbers so a two-tx batch signs and submits in order.
      const { sequence_number } = await chain.provider.getAccountInfo({
        accountAddress: AccountAddress.from(params.sender),
      })
      let nextSeq = BigInt(sequence_number)

      if (role === 'mint' || role === 'mintAndBurn') {
        const tx = await chain.provider.transaction.build.simple({
          sender: AccountAddress.from(params.sender),
          data: {
            function: `${tokenCodeObject}::managed_token::apply_allowed_minter_updates`,
            functionArguments: [[], [poolResourceSigner]],
          },
          options: { accountSequenceNumber: nextSeq++ },
        })
        parts.push(tx.bcsToBytes())
      }
      if (role === 'burn' || role === 'mintAndBurn') {
        const tx = await chain.provider.transaction.build.simple({
          sender: AccountAddress.from(params.sender),
          data: {
            function: `${tokenCodeObject}::managed_token::apply_allowed_burner_updates`,
            functionArguments: [[], [poolResourceSigner]],
          },
          options: { accountSequenceNumber: nextSeq },
        })
        parts.push(tx.bcsToBytes())
      }
    } else {
      // regulated_token: MINTER_ROLE=4, BURNER_ROLE=5, BRIDGE_MINTER_OR_BURNER_ROLE=6.
      const roleNumber = role === 'mint' ? 4 : role === 'burn' ? 5 : 6
      const tx = await chain.provider.transaction.build.simple({
        sender: AccountAddress.from(params.sender),
        data: {
          function: `${tokenCodeObject}::regulated_token::grant_role`,
          functionArguments: [roleNumber, poolResourceSigner],
        },
      })
      parts.push(tx.bcsToBytes())
    }

    const [first, ...others] = parts
    if (first === undefined) {
      throw new CCTParamsInvalidError(this.name, 'role', "must be 'mint', 'burn', or 'mintAndBurn'")
    }

    chain.logger.debug(
      `${this.name}: pool type = ${poolInfo.type}, poolResourceSigner = ${poolResourceSigner}, txs = ${parts.length}`,
    )
    return { family: ChainFamily.Aptos, transactions: [first, ...others] }
  }

  /**
   * Signs and submits each grant transaction in order, returning the final hash.
   * Overrides the single-tx base flow because a managed `mintAndBurn` grant
   * produces two dependent transactions.
   */
  override async execute(
    chain: AptosChain,
    params: ExecuteGrantMintBurnAccessParams,
  ): Promise<ExecuteGrantMintBurnAccessResult> {
    const { wallet } = params
    if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.accountAddress.toString()
    const { wallet: _wallet, ...rest } = params
    const unsigned = await this.generate(chain, { ...rest, sender })

    let last: TransactionHash | undefined
    for (const bytes of unsigned.transactions) {
      last = await submit(chain, wallet, [bytes], this.name)
    }
    if (last === undefined) {
      throw new CCTParamsInvalidError(this.name, 'role', 'produced no transactions to submit')
    }
    return last
  }
}
