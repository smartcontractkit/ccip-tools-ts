import { unpackMint } from '@solana/spl-token'
import { type TransactionInstruction, PublicKey } from '@solana/web3.js'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { type UnsignedSolanaTx, isWallet } from '../../../../solana/types.ts'
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
import {
  validateAuthorityMatchesWallet,
  validateOptionalPublicKey,
  validatePublicKey,
} from '../../validate.ts'

/** Authorization paths used to register a token in the TokenAdminRegistry. */
const REGISTER_ADMIN_METHODS = {
  OWNER: 'owner',
  CCIP_ADMIN: 'ccip-admin',
} as const

/** Authorization path used to register a token in the TokenAdminRegistry. */
export type RegisterAdminMethod =
  (typeof REGISTER_ADMIN_METHODS)[keyof typeof REGISTER_ADMIN_METHODS]

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
export class RegisterAdmin extends SolanaOperation<RegisterAdminParams> {
  readonly name = 'registerAdmin'

  /** Validates all caller-supplied parameters before RPC. */
  protected validate(params: GenerateRegisterAdminParams): void {
    validatePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    validatePublicKey(this.name, 'address', params.address)
    validatePublicKey(this.name, 'payer', params.payer)
    validateOptionalPublicKey(this.name, 'administrator', params.administrator)
    validateOptionalPublicKey(this.name, 'authority', params.authority)
    if (
      params.registrationMethod !== undefined &&
      !Object.values(REGISTER_ADMIN_METHODS).includes(params.registrationMethod)
    ) {
      throw new CCTParamsInvalidError(
        this.name,
        'registrationMethod',
        'must be owner or ccip-admin',
      )
    }
  }

  /** Builds an unsigned token registration instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: GenerateRegisterAdminParams,
  ): Promise<UnsignedSolanaTx> {
    const routerAddress = await chain.getTokenAdminRegistryFor(opts.address)
    const router = new PublicKey(routerAddress)
    const tokenMint = new PublicKey(opts.tokenAddress)
    const payer = new PublicKey(opts.payer)
    const authority = new PublicKey(opts.authority ?? opts.payer)

    const mintAccount = await resolveTokenMint(chain.connection, tokenMint)
    const { mintAuthority } = unpackMint(tokenMint, mintAccount, mintAccount.owner)
    const administrator =
      opts.administrator !== undefined ? new PublicKey(opts.administrator) : mintAuthority
    const method = opts.registrationMethod ?? REGISTER_ADMIN_METHODS.OWNER
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
      case REGISTER_ADMIN_METHODS.OWNER: {
        const ownerIx = await buildOwnerInstruction(program, accounts, mintAuthority, administrator)
        instructions.push(ownerIx)
        break
      }
      case REGISTER_ADMIN_METHODS.CCIP_ADMIN: {
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
    const { wallet, computeUnits, ...rest } = params
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const payer = wallet.publicKey.toBase58()
    const generateParams: GenerateRegisterAdminParams = { ...rest, payer }
    this.validate(generateParams)

    const authority = params.authority !== undefined ? new PublicKey(params.authority) : undefined
    if (authority) {
      validateAuthorityMatchesWallet(
        this.name,
        authority,
        wallet.publicKey,
        'registerAdmin requires authority to be the executing wallet. Use generateUnsignedRegisterAdmin for externally signed transactions.',
      )
    }

    const tx = await this.buildUnsigned(chain, generateParams)
    return submit(chain, wallet, tx, this.name, computeUnits)
  }
}
