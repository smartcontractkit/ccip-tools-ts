import { Buffer } from 'buffer'

import { type PublicKey, SystemProgram } from '@solana/web3.js'
import BN from 'bn.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { encodeAddressToAny, getAddressBytes } from '../../../../utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { parseRemoteAddress, parseUniqueRemoteAddresses } from '../../../remote-address.ts'
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
  validateInteger,
} from '../../validate.ts'

/** Parameters shared by Solana token pool remote-config editing generation and execution. */
type EditChainRemoteConfigParams = PoolProgramRef & {
  /** Token mint address managed by the local pool. */
  tokenAddress: string
  /** CCIP selector of the remote chain (`u64`). */
  remoteChainSelector: bigint
  /**
   * Remote token address in the remote chain's own format (`0x…` for EVM, base58 for Solana, …),
   * the family taken from `remoteChainSelector`. Left-padded to 32 bytes in the instruction.
   */
  remoteTokenAddress: string
  /**
   * Remote pool addresses in the remote chain's own format, like `remoteTokenAddress`; unique.
   * Stored at native byte length; unlike `remoteTokenAddress`, they are not left-padded.
   */
  remotePoolAddresses: string[]
  /** Remote token decimals (`u8`): an integer from 0 to 255; 0 is valid. */
  remoteTokenDecimals: number
  /** Pool owner. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

type ParsedEditChainRemoteConfigParams = {
  tokenAddress: PublicKey
  poolProgramAddress?: PublicKey
  payer: PublicKey
  authority: PublicKey
  remoteChainSelector: bigint
  remoteTokenAddress: string
  remotePoolAddresses: string[]
  remoteTokenDecimals: number
}

/** Parameters for unsigned Solana token pool remote configuration editing. */
export type GenerateEditChainRemoteConfigParams = SolanaGenerateParams<EditChainRemoteConfigParams>

/** Unsigned Solana token pool remote configuration editing result. */
export type GenerateEditChainRemoteConfigResult = UnsignedSolanaTx

/** Parameters for executing Solana token pool remote configuration editing. */
export type ExecuteEditChainRemoteConfigParams = SolanaExecuteParams<EditChainRemoteConfigParams>

/** Result of executing Solana token pool remote configuration editing. */
export type ExecuteEditChainRemoteConfigResult = TransactionResult

/**
 * Replaces an initialized remote-chain config.
 *
 * @remarks
 * Full replacement, not a partial update — pass the complete intended config for all three fields,
 * or omitted values are cleared. For example, `remotePoolAddresses: []` clears all remote pools.
 */
export class EditChainRemoteConfig extends SolanaOperation<
  EditChainRemoteConfigParams,
  UnsignedSolanaTx,
  ParsedEditChainRemoteConfigParams
> {
  readonly name = 'editChainRemoteConfig'

  /** Parses config values and defaults authority to payer without mutating caller params. */
  protected override prepare(
    params: GenerateEditChainRemoteConfigParams,
  ): ParsedEditChainRemoteConfigParams {
    validateBigInt(this.name, 'remoteChainSelector', params.remoteChainSelector, 0n, U64_MAX)
    validateInteger(this.name, 'remoteTokenDecimals', params.remoteTokenDecimals, 0, 255)

    const remoteTokenAddress = parseRemoteAddress(
      this.name,
      'remoteTokenAddress',
      params.remoteTokenAddress,
      params.remoteChainSelector,
    )

    if (!Array.isArray(params.remotePoolAddresses)) {
      throw new CCTParamsInvalidError(this.name, 'remotePoolAddresses', 'must be an array')
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
      remoteTokenAddress,
      remotePoolAddresses,
      remoteTokenDecimals: params.remoteTokenDecimals,
    }
  }

  /** Builds the unsigned Solana `editChainRemoteConfig` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedEditChainRemoteConfigParams,
  ): Promise<UnsignedSolanaTx> {
    const poolProgram = await resolveExistingPoolProgram(
      this.name,
      chain,
      opts.tokenAddress,
      opts.poolProgramAddress,
    )
    const program = createTokenPoolProgram(chain, poolProgram, opts.payer)
    const state = deriveTokenPoolConfigPda(poolProgram, opts.tokenAddress)
    const chainConfig = deriveTokenPoolChainConfigPda(
      poolProgram,
      opts.remoteChainSelector,
      opts.tokenAddress,
    )
    const instruction = await program.methods
      .editChainRemoteConfig(new BN(opts.remoteChainSelector.toString()), opts.tokenAddress, {
        tokenAddress: { address: encodeAddressToAny(opts.remoteTokenAddress) },
        poolAddresses: opts.remotePoolAddresses.map((address) => ({
          address: Buffer.from(getAddressBytes(address)),
        })),
        decimals: opts.remoteTokenDecimals,
      })
      .accountsStrict({
        state,
        chainConfig,
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
    params: ExecuteEditChainRemoteConfigParams,
  ): Promise<ExecuteEditChainRemoteConfigResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'editChainRemoteConfig requires authority to be the executing wallet. Use generateUnsignedEditChainRemoteConfig for externally signed transactions.',
      )
    }

    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
