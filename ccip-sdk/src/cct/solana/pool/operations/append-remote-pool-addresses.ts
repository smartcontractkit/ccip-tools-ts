import { Buffer } from 'buffer'

import { PublicKey, SystemProgram } from '@solana/web3.js'
import BN from 'bn.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import type { TransactionHash } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import { createTokenPoolProgram, deriveTokenPoolConfigPda } from '../../programs/token-pool.ts'
import { validatePublicKey } from '../../validate.ts'
import {
  deriveTokenPoolChainConfigPda,
  discoverPoolInfo,
  encodeRemotePoolAddressBytes,
  validateSelectorWithAddresses,
} from './common.ts'

/** Parameters shared by token-pool `appendRemotePoolAddresses` generation and execution. */
type AppendRemotePoolAddressesParams = {
  /** Local pool state (config PDA) address. */
  poolAddress: string
  /** Remote chain selector; must already be configured via applyChainUpdates. */
  remoteChainSelector: bigint
  /** Remote pool addresses in native format to append. At least one required. */
  remotePoolAddresses: string[]
  /** Pool authority. Defaults to `payer`; pass a vault/multisig authority explicitly. */
  authority?: string
}

/** Parameters for unsigned token-pool `appendRemotePoolAddresses` generation. */
export type GenerateAppendRemotePoolAddressesParams =
  SolanaGenerateParams<AppendRemotePoolAddressesParams>

/** Unsigned token-pool `appendRemotePoolAddresses` result. */
export type GenerateAppendRemotePoolAddressesResult = UnsignedSolanaTx

/** Parameters for executing token-pool `appendRemotePoolAddresses`. */
export type ExecuteAppendRemotePoolAddressesParams =
  SolanaExecuteParams<AppendRemotePoolAddressesParams>

/** Result of executing token-pool `appendRemotePoolAddresses`. */
export type ExecuteAppendRemotePoolAddressesResult = TransactionHash

/** Appends remote pool addresses to an existing token-pool chain config. */
export class AppendRemotePoolAddresses extends SolanaOperation<AppendRemotePoolAddressesParams> {
  readonly name = 'appendRemotePoolAddresses'

  /** Validates addresses and selector before any RPC. */
  protected validate(params: GenerateAppendRemotePoolAddressesParams): void {
    validatePublicKey(this.name, 'poolAddress', params.poolAddress)
    validatePublicKey(this.name, 'payer', params.payer)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
    validateSelectorWithAddresses(
      this.name,
      params.poolAddress,
      params.remoteChainSelector,
      params.remotePoolAddresses,
    )
  }

  /** Builds the unsigned token-pool `appendRemotePoolAddresses` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: GenerateAppendRemotePoolAddressesParams,
  ): Promise<UnsignedSolanaTx> {
    const authority = new PublicKey(opts.authority ?? opts.payer)
    const { poolProgramId, mint } = await discoverPoolInfo(chain, opts.poolAddress)

    const state = deriveTokenPoolConfigPda(poolProgramId, mint)
    const chainConfig = deriveTokenPoolChainConfigPda(poolProgramId, opts.remoteChainSelector, mint)
    const program = createTokenPoolProgram(chain, poolProgramId, authority)

    const addresses = opts.remotePoolAddresses.map((addr) => ({
      address: Buffer.from(encodeRemotePoolAddressBytes(addr)),
    }))

    const instruction = await program.methods
      .appendRemotePoolAddresses(new BN(opts.remoteChainSelector.toString()), mint, addresses)
      .accountsStrict({
        state,
        chainConfig,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .instruction()

    chain.logger.debug(
      `${this.name}: pool = ${opts.poolAddress}, addresses = ${opts.remotePoolAddresses.length}, poolProgram = ${poolProgramId.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }
}
