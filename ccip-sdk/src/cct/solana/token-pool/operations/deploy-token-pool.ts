import { PublicKey, SystemProgram } from '@solana/web3.js'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { type UnsignedSolanaTx, isWallet } from '../../../../solana/types.ts'
import type { TransactionHash } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import {
  type TokenPoolType,
  createTokenPoolProgram,
  deriveTokenPoolConfigPda,
  deriveTokenPoolGlobalConfigPda,
  deriveTokenPoolProgramDataPda,
  resolveTokenPoolProgram,
} from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import {
  validateAuthorityMatchesWallet,
  validatePoolType,
  validatePublicKey,
  validatePublicKeys,
} from '../../validate.ts'

/** Parameters for initializing a Solana token pool, optionally with an allowlist. */
type DeployTokenPoolParams = {
  /** Token mint address this pool manages. */
  tokenAddress: string
  /** Canonical token pool program to deploy: BurnMint or LockRelease. */
  poolType: TokenPoolType
  /**
   * Addresses to seed into the pool allowlist during initialization.
   * Providing any address also enables allowlist enforcement.
   * If omitted, the pool is initialized without an allowlist.
   */
  allowlist?: string[]
  /** Pool authority. Defaults to payer for unsigned generation and wallet public key for execute. */
  authority?: string
}

/** Parameters for unsigned Solana token pool deploy generation. */
export type GenerateDeployTokenPoolParams = SolanaGenerateParams<DeployTokenPoolParams>

/** Unsigned Solana token pool deploy result plus the derived pool state PDA. */
export type GenerateDeployTokenPoolResult = UnsignedSolanaTx & {
  poolAddress: string
}

/** Parameters for executing Solana token pool deploy. */
export type ExecuteDeployTokenPoolParams = SolanaExecuteParams<DeployTokenPoolParams>

/** Result of executing Solana token pool deploy plus the derived pool state PDA. */
export type ExecuteDeployTokenPoolResult = TransactionHash & {
  poolAddress: string
}

/** Initializes a Solana token pool, optionally configuring an allowlist. */
export class DeployTokenPool extends SolanaOperation<
  DeployTokenPoolParams,
  GenerateDeployTokenPoolResult
> {
  readonly name = 'deployTokenPool'

  /** Validates all public keys before any RPC. */
  protected validate(params: GenerateDeployTokenPoolParams): void {
    validatePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    validatePoolType(this.name, 'poolType', params.poolType)
    validatePublicKey(this.name, 'payer', params.payer)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
    if (params.allowlist !== undefined) validatePublicKeys(this.name, 'allowlist', params.allowlist)
  }

  /** Builds the unsigned Solana token pool initialize instruction set. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: GenerateDeployTokenPoolParams,
  ): Promise<GenerateDeployTokenPoolResult> {
    const tokenMint = new PublicKey(opts.tokenAddress)
    const poolProgram = resolveTokenPoolProgram(opts.poolType)
    const payer = new PublicKey(opts.payer)
    const authority = new PublicKey(opts.authority ?? opts.payer)
    const program = createTokenPoolProgram(chain, poolProgram, payer)
    const state = deriveTokenPoolConfigPda(poolProgram, tokenMint)

    const instructions = [
      await program.methods
        .initialize()
        .accountsStrict({
          state,
          mint: tokenMint,
          authority,
          systemProgram: SystemProgram.programId,
          program: poolProgram,
          programData: deriveTokenPoolProgramDataPda(poolProgram),
          config: deriveTokenPoolGlobalConfigPda(poolProgram),
        })
        .instruction(),
    ]

    const allowlist = (opts.allowlist ?? []).map((a) => new PublicKey(a))
    if (allowlist.length) {
      instructions.push(
        await program.methods
          .configureAllowList(allowlist, true)
          .accountsStrict({
            state,
            mint: tokenMint,
            authority,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
      )
    }

    chain.logger.debug(
      `${this.name}: token = ${tokenMint.toBase58()}, poolProgram = ${poolProgram.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions, mainIndex: 0, poolAddress: state.toBase58() }
  }

  /** Generate, sign, simulate, send, and confirm with wallet.publicKey as payer. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteDeployTokenPoolParams,
  ): Promise<ExecuteDeployTokenPoolResult> {
    const { wallet, computeUnits, ...rest } = params
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const payer = wallet.publicKey.toBase58()
    const generateParams: GenerateDeployTokenPoolParams = { ...rest, payer }
    this.validate(generateParams)

    const authority = params.authority ? new PublicKey(params.authority) : undefined
    if (authority) {
      validateAuthorityMatchesWallet(
        this.name,
        authority,
        wallet.publicKey,
        'deployTokenPool requires authority to be the executing wallet. Use generateUnsignedDeployTokenPool for vault-owned pools and have the vault sign/execute it.',
      )
    }

    const tx = await this.buildUnsigned(chain, generateParams)
    const hash = await submit(chain, wallet, tx, this.name, computeUnits)
    return { ...hash, poolAddress: tx.poolAddress }
  }
}
