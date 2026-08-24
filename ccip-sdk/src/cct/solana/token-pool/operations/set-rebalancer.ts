import type { PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import type { TransactionResult } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import {
  type CustomPoolProgramRef,
  type LockReleasePoolProgramRef,
  createLockReleaseTokenPoolProgram,
  deriveTokenPoolConfigPda,
} from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import {
  parsePublicKey,
  resolveLockReleasePoolProgram,
  validateAuthorityMatchesWallet,
} from '../../validate.ts'

/** Parameters shared by Solana lock-release pool rebalancer generation and execution. */
type SetRebalancerParams = (LockReleasePoolProgramRef | CustomPoolProgramRef) & {
  /** Token mint address managed by the pool. */
  tokenAddress: string
  /** Address authorized to provide or withdraw pool liquidity. The default address disables rebalancing. */
  rebalancer: string
  /** Pool owner. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

type ParsedSetRebalancerParams = {
  tokenAddress: PublicKey
  rebalancer: PublicKey
  poolProgram: PublicKey
  payer: PublicKey
  authority: PublicKey
}

/** Parameters for unsigned Solana lock-release pool rebalancer configuration. */
export type GenerateSetRebalancerParams = SolanaGenerateParams<SetRebalancerParams>

/** Unsigned Solana lock-release pool rebalancer configuration result. */
export type GenerateSetRebalancerResult = UnsignedSolanaTx

/** Parameters for executing Solana lock-release pool rebalancer configuration. */
export type ExecuteSetRebalancerParams = SolanaExecuteParams<SetRebalancerParams>

/** Result of executing Solana lock-release pool rebalancer configuration. */
export type ExecuteSetRebalancerResult = TransactionResult

/** Sets the address authorized to provide or withdraw a Solana lock-release token pool's liquidity. */
export class SetRebalancer extends SolanaOperation<
  SetRebalancerParams,
  UnsignedSolanaTx,
  ParsedSetRebalancerParams
> {
  readonly name = 'setRebalancer'

  /** Parses public keys and defaults authority to payer without mutating caller params. */
  protected override parse(params: GenerateSetRebalancerParams): ParsedSetRebalancerParams {
    const payer = parsePublicKey(this.name, 'payer', params.payer)
    return {
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      rebalancer: parsePublicKey(this.name, 'rebalancer', params.rebalancer),
      poolProgram: resolveLockReleasePoolProgram(this.name, params),
      payer,
      authority:
        params.authority === undefined
          ? payer
          : parsePublicKey(this.name, 'authority', params.authority),
    }
  }

  /** Builds the unsigned Solana `setRebalancer` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedSetRebalancerParams,
  ): Promise<UnsignedSolanaTx> {
    const instruction = await createLockReleaseTokenPoolProgram(chain, opts.poolProgram, opts.payer)
      .methods.setRebalancer(opts.rebalancer)
      .accountsStrict({
        state: deriveTokenPoolConfigPda(opts.poolProgram, opts.tokenAddress),
        mint: opts.tokenAddress,
        authority: opts.authority,
      })
      .instruction()

    chain.logger.debug(
      `${this.name}: token = ${opts.tokenAddress.toBase58()}, poolProgram = ${opts.poolProgram.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the pool owner wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteSetRebalancerParams,
  ): Promise<ExecuteSetRebalancerResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'setRebalancer requires authority to be the executing wallet. Use generateUnsignedSetRebalancer for externally signed transactions.',
      )
    }

    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
