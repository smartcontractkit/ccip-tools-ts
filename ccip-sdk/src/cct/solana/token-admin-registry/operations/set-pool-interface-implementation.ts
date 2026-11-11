import { PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import {
  type TokenAccountResolution,
  TOKEN_ACCOUNT_RESOLUTIONS,
} from '../../../../solana/token-admin-registry.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import {
  createRouterTokenAdminRegistryV2Program,
  deriveRouterConfigPda,
  deriveTokenAdminRegistryPda,
} from '../../programs/router.ts'
import { deriveEventAuthorityPda } from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import { parsePublicKey, validateAuthorityMatchesWallet } from '../../validate.ts'

/** `ResolutionType` instruction arguments; Anchor 0.29 keys enum variants by camelCase name. */
const ACCOUNT_RESOLUTION_ARGS = {
  NoResolution: { noResolution: {} },
  Standard: { standard: {} },
  WithoutExtendedLookupTable: { withoutExtendedLookupTable: {} },
} as const satisfies Record<TokenAccountResolution, object>

/** Parameters shared by Solana TokenAdminRegistry `setPoolInterfaceImplementation`. */
type SetPoolInterfaceImplementationParams = {
  tokenAddress: string
  /**
   * CCIP contract to resolve the TokenAdminRegistry/Router from — a Router or OffRamp address
   * works.
   */
  address: string
  /**
   * Pool interface the token's pool implements: `1` for the CCIP 1.6-compatible interface, `2`
   * for CCIP 2.0 pools, which CCIP 2.0 lanes then call through their 2.0 instructions.
   */
  interfaceVersion: 1 | 2
  /**
   * How the Router resolves the pool's accounts on transfers. `'Standard'` and
   * `'WithoutExtendedLookupTable'` require `interfaceVersion` 2. Defaults to `'NoResolution'`:
   * only the pool's lookup table entries.
   */
  accountResolution?: TokenAccountResolution
  /** Token administrator. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

type ParsedSetPoolInterfaceImplementationParams = {
  tokenAddress: PublicKey
  address: PublicKey
  interfaceVersion: 1 | 2
  accountResolution: TokenAccountResolution
  payer: PublicKey
  authority: PublicKey
}

/** Parameters for unsigned Solana TokenAdminRegistry `setPoolInterfaceImplementation`. */
export type GenerateSetPoolInterfaceImplementationParams =
  SolanaGenerateParams<SetPoolInterfaceImplementationParams>

/** Unsigned Solana TokenAdminRegistry `setPoolInterfaceImplementation` result. */
export type GenerateSetPoolInterfaceImplementationResult = UnsignedSolanaTx

/** Parameters for executing Solana TokenAdminRegistry `setPoolInterfaceImplementation`. */
export type ExecuteSetPoolInterfaceImplementationParams =
  SolanaExecuteParams<SetPoolInterfaceImplementationParams>

/** Result of executing Solana TokenAdminRegistry `setPoolInterfaceImplementation`. */
export type ExecuteSetPoolInterfaceImplementationResult = TransactionResult

/**
 * Records in a token's CCIP 2.0 TokenAdminRegistry which pool interface its pool implements and
 * how the Router resolves the pool's accounts.
 *
 * @remarks `authority` must be the token administrator. The registry must be at the Router's
 * latest layout; `upgradeTokenAdminRegistry` migrates older ones.
 */
export class SetPoolInterfaceImplementation extends SolanaOperation<
  SetPoolInterfaceImplementationParams,
  UnsignedSolanaTx,
  ParsedSetPoolInterfaceImplementationParams
> {
  readonly name = 'setPoolInterfaceImplementation'

  /** Validates the interface and resolution as the Router does, before any RPC. */
  protected override prepare(
    params: GenerateSetPoolInterfaceImplementationParams,
  ): ParsedSetPoolInterfaceImplementationParams {
    if (!([1, 2] as unknown[]).includes(params.interfaceVersion))
      throw new CCTParamsInvalidError(this.name, 'interfaceVersion', 'must be 1 or 2')
    const accountResolution = params.accountResolution ?? 'NoResolution'
    if (!TOKEN_ACCOUNT_RESOLUTIONS.includes(accountResolution))
      throw new CCTParamsInvalidError(
        this.name,
        'accountResolution',
        `must be one of ${TOKEN_ACCOUNT_RESOLUTIONS.join(', ')}`,
      )
    if (accountResolution !== 'NoResolution' && params.interfaceVersion < 2)
      throw new CCTParamsInvalidError(
        this.name,
        'accountResolution',
        `${accountResolution} requires interfaceVersion 2`,
      )
    const payer = parsePublicKey(this.name, 'payer', params.payer)
    return {
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      address: parsePublicKey(this.name, 'address', params.address),
      interfaceVersion: params.interfaceVersion,
      accountResolution,
      payer,
      authority:
        params.authority === undefined
          ? payer
          : parsePublicKey(this.name, 'authority', params.authority),
    }
  }

  /** Builds the unsigned Solana `set_pool_interface_implementation` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedSetPoolInterfaceImplementationParams,
  ): Promise<UnsignedSolanaTx> {
    const { tokenAddress: mint, payer, authority } = opts
    const router = new PublicKey(await chain.getTokenAdminRegistryFor(opts.address.toBase58()))
    const instruction = await createRouterTokenAdminRegistryV2Program(chain, router, payer)
      .methods.setPoolInterfaceImplementation({
        mint,
        interfaceVersion: opts.interfaceVersion,
        accountResolution: ACCOUNT_RESOLUTION_ARGS[opts.accountResolution],
      })
      .accountsStrict({
        config: deriveRouterConfigPda(router),
        tokenAdminRegistry: deriveTokenAdminRegistryPda(router, mint),
        authority,
        eventAuthority: deriveEventAuthorityPda(router),
        program: router,
      })
      .instruction()

    chain.logger.debug(
      `${this.name}: router = ${router.toBase58()}, token = ${mint.toBase58()}, interfaceVersion = ${opts.interfaceVersion}, accountResolution = ${opts.accountResolution}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the token administrator wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteSetPoolInterfaceImplementationParams,
  ): Promise<ExecuteSetPoolInterfaceImplementationResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(chain, params)
    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'setPoolInterfaceImplementation requires authority to be the executing wallet. Use generateUnsignedSetPoolInterfaceImplementation for externally signed transactions.',
      )
    }
    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
