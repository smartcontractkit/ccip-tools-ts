import { unpackMint } from '@solana/spl-token'
import { type TransactionInstruction, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { resolveTokenMint } from '../../../../solana/utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import {
  createRouterProgram,
  deriveRouterConfigPda,
  deriveTokenAdminRegistryPda,
} from '../../programs/router.ts'
import { submit } from '../../submit.ts'
import { parsePublicKey, validateAuthorityMatchesWallet } from '../../validate.ts'
import { REGISTRATION_METHODS } from '../constants.ts'

/** Authorization path used to register a token in the TokenAdminRegistry. */
export type RegisterAdminMethod = (typeof REGISTRATION_METHODS)[keyof typeof REGISTRATION_METHODS]

type RegisterAdminParams = {
  /** Token mint to register. The proposed administrator remains pending until accepted. */
  tokenAddress: string
  /**
   * CCIP contract to resolve the TokenAdminRegistry/Router from — a Router or OffRamp
   * address works.
   */
  address: string
  /** Selects registration authority; defaults to `owner`. */
  registrationMethod?: RegisterAdminMethod
  /** Registry administrator to propose. Defaults to the mint authority when present. */
  administrator?: string
  /**
   * Registration authority. Defaults to `payer` for single-signer transactions.
   * Multisig/Squads flows should pass the mint or CCIP admin/vault authority explicitly.
   */
  authority?: string
}

/** Parameters for unsigned Solana token registration generation. */
export type GenerateRegisterAdminParams = SolanaGenerateParams<RegisterAdminParams>

type ParsedRegisterAdminParams = {
  tokenMint: PublicKey
  address: PublicKey
  payer: PublicKey
  authority: PublicKey
  administrator?: PublicKey
  method: RegisterAdminMethod
}

/** Unsigned Solana token registration result. */
export type GenerateRegisterAdminResult = UnsignedSolanaTx

/** Parameters for executing Solana token registration. */
export type ExecuteRegisterAdminParams = SolanaExecuteParams<RegisterAdminParams>

/** Result of executing Solana token registration. */
export type ExecuteRegisterAdminResult = TransactionResult

type RegisterAdminAccounts = {
  config: PublicKey
  tokenAdminRegistry: PublicKey
  mint: PublicKey
  authority: PublicKey
}

type RouterProgram = ReturnType<typeof createRouterProgram>

async function buildOwnerInstruction(
  program: RouterProgram,
  accounts: RegisterAdminAccounts,
  mintAuthority: PublicKey | null,
  administrator: PublicKey,
): Promise<TransactionInstruction> {
  if (!mintAuthority) {
    throw new CCTParamsInvalidError(
      'registerAdmin',
      'tokenAddress',
      'token mint has no mint authority; use ccip-admin with administrator',
    )
  }
  if (!accounts.authority.equals(mintAuthority)) {
    throw new CCTParamsInvalidError(
      'registerAdmin',
      'authority',
      'must match the token mint authority',
    )
  }
  return program.methods.ownerProposeAdministrator(administrator).accounts(accounts).instruction()
}

async function buildCcipAdminInstruction(
  program: RouterProgram,
  accounts: RegisterAdminAccounts,
  administrator: PublicKey,
): Promise<TransactionInstruction> {
  let routerConfig
  try {
    routerConfig = await program.account.config.fetch(accounts.config)
  } catch (cause) {
    throw new CCTParamsInvalidError(
      'registerAdmin',
      'address',
      'Router config could not be fetched',
      {
        cause: cause instanceof Error ? cause : undefined,
      },
    )
  }

  if (!accounts.authority.equals(routerConfig.owner)) {
    throw new CCTParamsInvalidError(
      'registerAdmin',
      'authority',
      'must match the Router CCIP admin',
    )
  }
  return program.methods
    .ccipAdminProposeAdministrator(administrator)
    .accounts(accounts)
    .instruction()
}

/** Registers a token through either its mint authority or the Router CCIP admin. */
export class RegisterAdmin extends SolanaOperation<
  RegisterAdminParams,
  UnsignedSolanaTx,
  ParsedRegisterAdminParams
> {
  readonly name = 'registerAdmin'

  /** Parses all caller-supplied parameters before RPC. */
  protected override parse(params: GenerateRegisterAdminParams): ParsedRegisterAdminParams {
    if (
      params.registrationMethod !== undefined &&
      !Object.values(REGISTRATION_METHODS).includes(params.registrationMethod)
    ) {
      throw new CCTParamsInvalidError(
        this.name,
        'registrationMethod',
        'must be owner or ccip-admin',
      )
    }
    const payer = parsePublicKey(this.name, 'payer', params.payer)
    return {
      tokenMint: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      address: parsePublicKey(this.name, 'address', params.address),
      payer,
      authority:
        params.authority === undefined
          ? payer
          : parsePublicKey(this.name, 'authority', params.authority),
      ...(params.administrator !== undefined && {
        administrator: parsePublicKey(this.name, 'administrator', params.administrator),
      }),
      method: params.registrationMethod ?? REGISTRATION_METHODS.OWNER,
    }
  }

  /** Builds an unsigned token registration instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedRegisterAdminParams,
  ): Promise<UnsignedSolanaTx> {
    const router = new PublicKey(await chain.getTokenAdminRegistryFor(opts.address.toBase58()))
    const { tokenMint, payer, authority, method } = opts

    const mintAccount = await resolveTokenMint(chain.connection, tokenMint)
    const { mintAuthority } = unpackMint(tokenMint, mintAccount, mintAccount.owner)
    const administrator = opts.administrator ?? mintAuthority
    const config = deriveRouterConfigPda(router)
    const tokenAdminRegistry = deriveTokenAdminRegistryPda(router, tokenMint)
    if (await chain.connection.getAccountInfo(tokenAdminRegistry)) {
      throw new CCTParamsInvalidError(
        this.name,
        'tokenAddress',
        'a registry entry already exists for this token (possibly pending admin acceptance) — use acceptAdmin/setPool instead of registering again',
      )
    }

    const program = createRouterProgram(chain, router, payer)
    const accounts = { config, tokenAdminRegistry, mint: tokenMint, authority }

    if (!administrator) {
      throw new CCTParamsInvalidError(
        this.name,
        'administrator',
        'is required when the mint has no mint authority',
      )
    }

    const instructions: TransactionInstruction[] = []
    switch (method) {
      case REGISTRATION_METHODS.OWNER: {
        const ownerIx = await buildOwnerInstruction(program, accounts, mintAuthority, administrator)
        instructions.push(ownerIx)
        break
      }
      case REGISTRATION_METHODS.CCIP_ADMIN: {
        const ccipAdminIx = await buildCcipAdminInstruction(program, accounts, administrator)
        instructions.push(ccipAdminIx)
        break
      }
      default:
        throw new CCTParamsInvalidError(
          this.name,
          'registrationMethod',
          'must be owner or ccip-admin',
        )
    }

    chain.logger.debug(
      `${this.name}: method = ${method}, router = ${router.toBase58()}, token = ${tokenMint.toBase58()}`,
    )

    return { family: ChainFamily.Solana, instructions, mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the registration authority. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteRegisterAdminParams,
  ): Promise<ExecuteRegisterAdminResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'registerAdmin requires authority to be the executing wallet. Use generateUnsignedRegisterAdmin for externally signed transactions.',
      )
    }

    const tx = await this.buildUnsigned(chain, parsed)
    return submit(chain, wallet, tx, this.name, computeUnits)
  }
}
