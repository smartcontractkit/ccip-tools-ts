import {
  type PublicKey,
  type TransactionInstruction,
  AddressLookupTableProgram,
} from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import { deriveCcipLookupTableAddresses } from '../../programs/alt.ts'
import type { PoolProgramRef } from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import {
  parsePublicKey,
  resolvePoolProgram,
  validateAuthorityMatchesWallet,
} from '../../validate.ts'

const MAX_ALT_ADDRESSES = 256
const EXTEND_CHUNK_SIZE = 30

type AppendAdditionalAddressesParams = {
  additionalAddresses: string[]
  tokenAddress?: never
  poolType?: never
  poolProgramAddress?: never
}

type AppendCanonicalAddressesParams = {
  tokenAddress: string
  additionalAddresses?: string[]
} & PoolProgramRef

/**
 * Parameters shared by Solana TokenAdminRegistry `appendToLookupTable` generation and execution.
 *
 * Provide `tokenAddress` with exactly one of `poolType` or `poolProgramAddress` to append the
 * canonical CCIP addresses. Additional addresses may also be included.
 *
 * Otherwise, provide `additionalAddresses` only.
 */
type AppendToLookupTableParams = {
  lookupTableAddress: string
  /** ALT authority. Defaults to payer for unsigned generation and wallet public key for execute. */
  authority?: string
} & (AppendAdditionalAddressesParams | AppendCanonicalAddressesParams)

/** Parameters for unsigned Solana lookup table append generation. */
export type GenerateAppendToLookupTableParams = SolanaGenerateParams<AppendToLookupTableParams>

type ParsedAppendToLookupTableParams = {
  payer: PublicKey
  authority: PublicKey
  lookupTableAddress: PublicKey
  additionalAddresses: PublicKey[]
  tokenMint?: PublicKey
  poolProgram?: PublicKey
}

/** Unsigned append lookup table result. */
export type GenerateAppendToLookupTableResult = UnsignedSolanaTx

/** Parameters for executing Solana TokenAdminRegistry `appendToLookupTable`. */
export type ExecuteAppendToLookupTableParams = SolanaExecuteParams<AppendToLookupTableParams>

/** Result of executing Solana TokenAdminRegistry `appendToLookupTable`. */
export type ExecuteAppendToLookupTableResult = TransactionResult

/** Builds and submits Solana ALT extend instructions for token pool setup. */
export class AppendToLookupTable extends SolanaOperation<
  AppendToLookupTableParams,
  GenerateAppendToLookupTableResult,
  ParsedAppendToLookupTableParams
> {
  readonly name = 'appendToLookupTable'

  /** Parses all public keys before any RPC. */
  protected override parse(
    params: GenerateAppendToLookupTableParams,
  ): ParsedAppendToLookupTableParams {
    const payer = parsePublicKey(this.name, 'payer', params.payer)
    const authority =
      params.authority === undefined
        ? payer
        : parsePublicKey(this.name, 'authority', params.authority)
    const lookupTableAddress = parsePublicKey(
      this.name,
      'lookupTableAddress',
      params.lookupTableAddress,
    )

    const hasTokenAddress = params.tokenAddress !== undefined
    const hasPoolProgramAddress = params.poolProgramAddress !== undefined
    const hasPoolProgram = params.poolType !== undefined || hasPoolProgramAddress
    if (hasTokenAddress !== hasPoolProgram) {
      throw new CCTParamsInvalidError(
        this.name,
        'tokenAddress',
        'tokenAddress and exactly one of poolType or poolProgramAddress must be provided together',
      )
    }
    const tokenMint =
      params.tokenAddress === undefined
        ? undefined
        : parsePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    const poolProgram = hasPoolProgram ? resolvePoolProgram(this.name, params) : undefined
    const additionalAddresses = (params.additionalAddresses ?? []).map((address, i) =>
      parsePublicKey(this.name, `additionalAddresses[${i}]`, address),
    )

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (params.tokenAddress === undefined && !params.additionalAddresses?.length) {
      throw new CCTParamsInvalidError(
        this.name,
        'additionalAddresses',
        'must provide tokenAddress/poolProgramAddress or additionalAddresses',
      )
    }
    return {
      payer,
      authority,
      lookupTableAddress,
      additionalAddresses,
      ...(tokenMint !== undefined && { tokenMint }),
      ...(poolProgram !== undefined && { poolProgram }),
    }
  }

  /** Builds unsigned ALT extend instructions. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedAppendToLookupTableParams,
  ): Promise<GenerateAppendToLookupTableResult> {
    const { payer, authority, lookupTableAddress, poolProgram } = opts
    const lookupTable = await chain.connection.getAddressLookupTable(lookupTableAddress)

    if (!lookupTable.value) {
      throw new CCTParamsInvalidError(
        this.name,
        'lookupTableAddress',
        `lookup table not found: ${lookupTableAddress.toBase58()}`,
      )
    }

    if (!lookupTable.value.state.authority?.equals(authority)) {
      throw new CCTParamsInvalidError(
        this.name,
        'authority',
        `authority mismatch; ALT authority is ${lookupTable.value.state.authority?.toBase58() ?? 'none'}`,
      )
    }

    const addresses = [...opts.additionalAddresses]

    if (opts.tokenMint && poolProgram) {
      const { tokenMint } = opts
      const ccipAddresses = await deriveCcipLookupTableAddresses(chain, {
        lookupTableAddress,
        tokenMint,
        poolProgram,
      })
      const existingAddresses = new Set(
        lookupTable.value.state.addresses.map((address) => address.toBase58()),
      )

      if (ccipAddresses.every((address) => existingAddresses.has(address.toBase58()))) {
        throw new CCTParamsInvalidError(
          this.name,
          'lookupTableAddress',
          'lookup table already contains the canonical CCIP address block; only append additionalAddresses or use an empty ALT',
        )
      }

      addresses.unshift(...ccipAddresses)
    }

    const totalAddressesAfterAppend = lookupTable.value.state.addresses.length + addresses.length
    if (totalAddressesAfterAppend > MAX_ALT_ADDRESSES) {
      throw new CCTParamsInvalidError(
        this.name,
        'additionalAddresses',
        `ALT cannot exceed ${MAX_ALT_ADDRESSES} addresses; requested ${totalAddressesAfterAppend}`,
      )
    }

    const instructions: TransactionInstruction[] = []
    for (let i = 0; i < addresses.length; i += EXTEND_CHUNK_SIZE) {
      instructions.push(
        AddressLookupTableProgram.extendLookupTable({
          payer,
          authority,
          lookupTable: lookupTableAddress,
          addresses: addresses.slice(i, i + EXTEND_CHUNK_SIZE),
        }),
      )
    }

    chain.logger.debug(
      `${this.name}: lookupTable = ${lookupTableAddress.toBase58()}, appended = ${addresses.length}, total = ${totalAddressesAfterAppend}`,
    )
    return {
      family: ChainFamily.Solana,
      instructions,
      mainIndex: 0,
    }
  }

  /** Generate, sign, simulate, send, and confirm with wallet.publicKey as payer. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteAppendToLookupTableParams,
  ): Promise<ExecuteAppendToLookupTableResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'appendToLookupTable requires authority to be the executing wallet. Use generateUnsignedAppendToLookupTable for vault-owned ALTs and have the vault sign/execute it.',
      )
    }

    const tx = await this.buildUnsigned(chain, parsed)
    return submit(chain, wallet, tx, this.name, computeUnits)
  }
}
