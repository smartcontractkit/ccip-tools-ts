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
import { validateAuthorityMatchesWallet, validatePublicKey } from '../../validate.ts'

/** Authorization paths used to register a token in the TokenAdminRegistry. */
const REGISTER_TOKEN_METHODS = {
  OWNER: 'owner',
  CCIP_ADMIN: 'ccip-admin',
} as const

/** Authorization path used to register a token in the TokenAdminRegistry. */
export type RegisterTokenMethod =
  (typeof REGISTER_TOKEN_METHODS)[keyof typeof REGISTER_TOKEN_METHODS]

type RegisterTokenParams = {
  /** Token mint to register. Its current mint authority becomes the registry administrator. */
  tokenAddress: string
  /**
   * CCIP contract to resolve the TokenAdminRegistry/Router from — the registry itself,
   * a Router, OnRamp, OffRamp, or TokenPool address all work.
   */
  address: string
  /** Selects whether the mint authority or the Router CCIP admin authorizes registration. */
  registrationMethod: RegisterTokenMethod
  /**
   * Registration authority. Defaults to `payer` for single-signer transactions.
   * Multisig/Squads flows should pass the mint or CCIP admin/vault authority explicitly.
   */
  authority?: string
}

/** Parameters for unsigned Solana token registration generation. */
export type GenerateRegisterTokenParams = SolanaGenerateParams<RegisterTokenParams>

/** Unsigned Solana token registration result. */
export type GenerateRegisterTokenResult = UnsignedSolanaTx

/** Parameters for executing Solana token registration. */
export type ExecuteRegisterTokenParams = SolanaExecuteParams<RegisterTokenParams>

/** Result of executing Solana token registration. */
export type ExecuteRegisterTokenResult = TransactionResult

type RegisterTokenAccounts = {
  config: PublicKey
  tokenAdminRegistry: PublicKey
  mint: PublicKey
  authority: PublicKey
}

type RouterProgram = ReturnType<typeof createRouterProgram>

async function buildOwnerInstruction(
  program: RouterProgram,
  accounts: RegisterTokenAccounts,
  mintAuthority: PublicKey,
): Promise<TransactionInstruction> {
  if (!accounts.authority.equals(mintAuthority)) {
    throw new CCTParamsInvalidError(
      'registerToken',
      'authority',
      'must match the token mint authority',
    )
  }
  return program.methods.ownerProposeAdministrator(mintAuthority).accounts(accounts).instruction()
}

async function buildCcipAdminInstruction(
  program: RouterProgram,
  accounts: RegisterTokenAccounts,
  mintAuthority: PublicKey,
): Promise<TransactionInstruction> {
  const routerConfig = await program.account.config.fetch(accounts.config)
  if (!accounts.authority.equals(routerConfig.owner)) {
    throw new CCTParamsInvalidError(
      'registerToken',
      'authority',
      'must match the Router CCIP admin',
    )
  }
  return program.methods
    .ccipAdminProposeAdministrator(mintAuthority)
    .accounts(accounts)
    .instruction()
}

/** Registers a token through either its mint authority or the Router CCIP admin. */
export class RegisterToken extends SolanaOperation<RegisterTokenParams> {
  readonly name = 'registerToken'

  /** Validates all caller-supplied parameters before RPC. */
  protected validate(params: GenerateRegisterTokenParams): void {
    validatePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    validatePublicKey(this.name, 'address', params.address)
    validatePublicKey(this.name, 'payer', params.payer)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
    if (!Object.values(REGISTER_TOKEN_METHODS).includes(params.registrationMethod)) {
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
    opts: GenerateRegisterTokenParams,
  ): Promise<UnsignedSolanaTx> {
    const routerAddress = await chain.getTokenAdminRegistryFor(opts.address)
    const router = new PublicKey(routerAddress)
    const tokenMint = new PublicKey(opts.tokenAddress)
    const payer = new PublicKey(opts.payer)
    const authority = new PublicKey(opts.authority ?? opts.payer)

    const mintAccount = await resolveTokenMint(chain.connection, tokenMint)
    const { mintAuthority } = unpackMint(tokenMint, mintAccount, mintAccount.owner)
    if (!mintAuthority) {
      throw new CCTParamsInvalidError(this.name, 'tokenAddress', 'token mint has no mint authority')
    }
    const config = deriveRouterConfigPda(router)
    const tokenAdminRegistry = deriveTokenAdminRegistryPda(router, tokenMint)
    if (await chain.connection.getAccountInfo(tokenAdminRegistry)) {
      throw new CCTParamsInvalidError(this.name, 'tokenAddress', 'token is already registered')
    }

    const program = createRouterProgram(chain, router, payer)
    const accounts = { config, tokenAdminRegistry, mint: tokenMint, authority }

    const instructions: TransactionInstruction[] = []
    switch (opts.registrationMethod) {
      case REGISTER_TOKEN_METHODS.OWNER: {
        const ownerIx = await buildOwnerInstruction(program, accounts, mintAuthority)
        instructions.push(ownerIx)
        break
      }
      case REGISTER_TOKEN_METHODS.CCIP_ADMIN: {
        const ccipAdminIx = await buildCcipAdminInstruction(program, accounts, mintAuthority)
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
      `${this.name}: method = ${opts.registrationMethod}, router = ${router.toBase58()}, token = ${tokenMint.toBase58()}`,
    )

    return { family: ChainFamily.Solana, instructions, mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the registration authority. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteRegisterTokenParams,
  ): Promise<ExecuteRegisterTokenResult> {
    const { wallet, computeUnits, ...rest } = params
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const payer = wallet.publicKey.toBase58()
    const generateParams: GenerateRegisterTokenParams = { ...rest, payer }
    this.validate(generateParams)

    const authority = params.authority ? new PublicKey(params.authority) : undefined
    if (authority) {
      validateAuthorityMatchesWallet(
        this.name,
        authority,
        wallet.publicKey,
        'registerToken requires authority to be the executing wallet. Use generateUnsignedRegisterToken for externally signed transactions.',
      )
    }

    const tx = await this.buildUnsigned(chain, generateParams)
    return submit(chain, wallet, tx, this.name, computeUnits)
  }
}
