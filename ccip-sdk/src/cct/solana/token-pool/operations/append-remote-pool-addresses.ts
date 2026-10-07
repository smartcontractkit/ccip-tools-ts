import { Buffer } from 'buffer'

import { type PublicKey, SystemProgram } from '@solana/web3.js'
import BN from 'bn.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { getAddressBytes } from '../../../../utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { parseUniqueRemoteAddresses } from '../../../remote-address.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import {
  type PoolProgramRef,
  createTokenPoolProgram,
  deriveTokenPoolChainConfigPda,
  deriveTokenPoolConfigPda,
} from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import {
  U64_MAX,
  parseOptionalPublicKey,
  parsePublicKey,
  resolveExistingPoolProgram,
  validateAuthorityMatchesWallet,
  validateBigInt,
} from '../../validate.ts'

/** Parameters shared by Solana remote pool address appending generation and execution. */
type AppendRemotePoolAddressesParams = PoolProgramRef & {
  /** Token mint address managed by the local pool. */
  tokenAddress: string
  /** CCIP selector of the remote chain (`u64`). */
  remoteChainSelector: bigint
  /**
   * Non-empty array of unique remote pool addresses in the remote chain's own format (`0x…` for
   * EVM, base58 for Solana, …), the family taken from `remoteChainSelector`. Stored at native byte
   * length; unlike `remoteTokenAddress`, not left-padded to 32 bytes.
   */
  remotePoolAddresses: string[]
  /** Pool owner. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

type ParsedAppendRemotePoolAddressesParams = {
  tokenAddress: PublicKey
  poolProgramAddress?: PublicKey
  payer: PublicKey
  authority: PublicKey
  remoteChainSelector: bigint
  remotePoolAddresses: string[]
}

/** Parameters for unsigned Solana remote pool address appending. */
export type GenerateAppendRemotePoolAddressesParams =
  SolanaGenerateParams<AppendRemotePoolAddressesParams>

/** Unsigned Solana remote pool address appending result. */
export type GenerateAppendRemotePoolAddressesResult = UnsignedSolanaTx

/** Parameters for executing Solana remote pool address appending. */
export type ExecuteAppendRemotePoolAddressesParams =
  SolanaExecuteParams<AppendRemotePoolAddressesParams>

/** Result of executing Solana remote pool address appending. */
export type ExecuteAppendRemotePoolAddressesResult = TransactionResult

/**
 * Appends remote pool addresses to an initialized remote-chain config.
 *
 * @remarks Existing addresses are retained. The remote-chain config must already exist. The pool
 * rejects addresses already present; duplicate addresses in this request are rejected. To clear
 * all pools, use `editChainRemoteConfig` with `remotePoolAddresses: []`.
 */
export class AppendRemotePoolAddresses extends SolanaOperation<
  AppendRemotePoolAddressesParams,
  UnsignedSolanaTx,
  ParsedAppendRemotePoolAddressesParams
> {
  readonly name = 'appendRemotePoolAddresses'

  /** Parses addresses and defaults authority to payer without mutating caller params. */
  protected override prepare(
    params: GenerateAppendRemotePoolAddressesParams,
  ): ParsedAppendRemotePoolAddressesParams {
    validateBigInt(this.name, 'remoteChainSelector', params.remoteChainSelector, 0n, U64_MAX)

    if (!Array.isArray(params.remotePoolAddresses) || params.remotePoolAddresses.length === 0) {
      throw new CCTParamsInvalidError(this.name, 'remotePoolAddresses', 'must be a non-empty array')
    }

    const remotePoolAddresses = parseUniqueRemoteAddresses(
      this.name,
      'remotePoolAddresses',
      params.remotePoolAddresses,
      params.remoteChainSelector,
    )

    const payer = parsePublicKey(this.name, 'payer', params.payer)
    return {
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      poolProgramAddress: parseOptionalPublicKey(
        this.name,
        'poolProgramAddress',
        params.poolProgramAddress,
      ),
      payer,
      authority:
        params.authority === undefined
          ? payer
          : parsePublicKey(this.name, 'authority', params.authority),
      remoteChainSelector: params.remoteChainSelector,
      remotePoolAddresses,
    }
  }

  /** Builds the unsigned Solana `appendRemotePoolAddresses` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedAppendRemotePoolAddressesParams,
  ): Promise<UnsignedSolanaTx> {
    const poolProgram = await resolveExistingPoolProgram(
      this.name,
      chain,
      opts.tokenAddress,
      opts.poolProgramAddress,
    )
    const program = createTokenPoolProgram(chain, poolProgram, opts.payer)
    const instruction = await program.methods
      .appendRemotePoolAddresses(
        new BN(opts.remoteChainSelector.toString()),
        opts.tokenAddress,
        opts.remotePoolAddresses.map((address) => ({
          address: Buffer.from(getAddressBytes(address)),
        })),
      )
      .accountsStrict({
        state: deriveTokenPoolConfigPda(poolProgram, opts.tokenAddress),
        chainConfig: deriveTokenPoolChainConfigPda(
          poolProgram,
          opts.remoteChainSelector,
          opts.tokenAddress,
        ),
        authority: opts.authority,
        systemProgram: SystemProgram.programId,
      })
      .instruction()

    chain.logger.debug(
      `${this.name}: token = ${opts.tokenAddress.toBase58()}, poolProgram = ${poolProgram.toBase58()}, remoteChainSelector = ${opts.remoteChainSelector}`,
    )

    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the pool owner wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteAppendRemotePoolAddressesParams,
  ): Promise<ExecuteAppendRemotePoolAddressesResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'appendRemotePoolAddresses requires authority to be the executing wallet. Use generateUnsignedAppendRemotePoolAddresses for externally signed transactions.',
      )
    }

    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
