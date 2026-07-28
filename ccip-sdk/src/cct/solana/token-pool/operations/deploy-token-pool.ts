import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { PublicKey, SystemProgram } from '@solana/web3.js'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { type UnsignedSolanaTx, isWallet } from '../../../../solana/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import {
  createTokenPoolProgram,
  deriveTokenPoolConfigPda,
  deriveTokenPoolGlobalConfigPda,
  deriveTokenPoolProgramDataPda,
  deriveTokenPoolSignerPda,
} from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import { detectMintTokenProgram } from '../../token/operations/spl.ts'
import { validatePublicKey } from '../../validate.ts'

/** Parameters for initializing a Solana token pool, optionally with an allowlist. */
type DeployTokenPoolParams = {
  /** Token mint address this pool manages. */
  tokenAddress: string
  /** Token pool program address, e.g. BurnMint or LockRelease token pool program. */
  poolProgramAddress: string
  /**
   * Optional addresses to enable in the pool allowlist during initialization.
   * If omitted, the pool is initialized without configuring the allowlist.
   */
  allowlist?: string[]
  /** Pool authority. Defaults to payer for unsigned generation and wallet public key for execute. */
  authority?: string
}

/** Parameters for unsigned Solana token pool deploy generation. */
export type GenerateDeployTokenPoolParams = SolanaGenerateParams<DeployTokenPoolParams>

/** Unsigned Solana token pool deploy result. */
export type GenerateDeployTokenPoolResult = UnsignedSolanaTx

/** Parameters for executing Solana token pool deploy. */
export type ExecuteDeployTokenPoolParams = SolanaExecuteParams<DeployTokenPoolParams>

/** Result of executing Solana token pool deploy, including the pool state/config PDA. */
export type ExecuteDeployTokenPoolResult = TransactionHash & {
  /** The pool state/config PDA (base58), derivable pre-submit. */
  poolAddress: string
}

/** Initializes a Solana token pool, optionally configuring an allowlist. */
export class DeployTokenPool extends SolanaOperation<
  DeployTokenPoolParams,
  GenerateDeployTokenPoolResult,
  ExecuteDeployTokenPoolResult
> {
  readonly name = 'deployTokenPool'

  /** Validates all public keys before any RPC. */
  protected validate(params: GenerateDeployTokenPoolParams): void {
    validatePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    validatePublicKey(this.name, 'poolProgramAddress', params.poolProgramAddress)
    validatePublicKey(this.name, 'payer', params.payer)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
    for (const [i, address] of (params.allowlist ?? []).entries()) {
      validatePublicKey(this.name, `allowlist[${i}]`, address)
    }
  }

  /** Builds the unsigned Solana token pool initialize instruction set. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: GenerateDeployTokenPoolParams,
  ): Promise<GenerateDeployTokenPoolResult> {
    const tokenMint = new PublicKey(opts.tokenAddress)
    const poolProgram = new PublicKey(opts.poolProgramAddress)
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

    // POC parity: auto-create the pool signer PDA's associated token account (not in DAPP-10507
    // deploy-token-pool). Idempotent so re-runs are safe. Reuses the same derivation as
    // create-pool-token-account.ts. See legacy token-admin/solana/index.ts L816-847.
    const tokenProgramId = await detectMintTokenProgram(chain, this.name, 'tokenAddress', tokenMint)
    const poolSignerPda = deriveTokenPoolSignerPda(poolProgram, tokenMint)
    const poolTokenAta = getAssociatedTokenAddressSync(
      tokenMint,
      poolSignerPda,
      true, // allowOwnerOffCurve — PDAs are off-curve
      tokenProgramId,
    )
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(
        payer,
        poolTokenAta,
        poolSignerPda,
        tokenMint,
        tokenProgramId,
      ),
    )

    chain.logger.debug(
      `${this.name}: token = ${tokenMint.toBase58()}, poolProgram = ${poolProgram.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions, mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with wallet.publicKey as payer. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteDeployTokenPoolParams,
  ): Promise<ExecuteDeployTokenPoolResult> {
    const { wallet, computeUnits, ...rest } = params
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const payer = wallet.publicKey.toBase58()
    if (params.authority && !new PublicKey(params.authority).equals(wallet.publicKey)) {
      throw new CCTParamsInvalidError(
        this.name,
        'authority',
        'deployTokenPool requires authority to be the executing wallet. Use generateUnsignedDeployTokenPool for vault-owned pools and have the vault sign/execute it.',
      )
    }

    const tx = await this.generate(chain, { ...rest, payer })
    const hash = await submit(chain, wallet, tx, this.name, computeUnits)
    // POC parity: surface the pool state/config PDA from execute (not in DAPP-10507
    // deploy-token-pool). Same derivation the op uses for the `initialize` state account.
    const poolAddress = deriveTokenPoolConfigPda(
      new PublicKey(rest.poolProgramAddress),
      new PublicKey(rest.tokenAddress),
    ).toBase58()
    return { ...hash, poolAddress }
  }
}
