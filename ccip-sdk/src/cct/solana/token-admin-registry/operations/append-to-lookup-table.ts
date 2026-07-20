import { type TransactionInstruction, AddressLookupTableProgram, PublicKey } from '@solana/web3.js'

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
import { deriveCcipLookupTableAddresses } from '../../programs/alt.ts'
import { submit } from '../../submit.ts'
import { validatePublicKey } from '../../validate.ts'

const MAX_ALT_ADDRESSES = 256
const EXTEND_CHUNK_SIZE = 30

/** Parameters shared by Solana TokenAdminRegistry `appendToLookupTable` generation and execution. */
type AppendToLookupTableParams = {
  lookupTableAddress: string
  tokenAddress?: string
  poolProgramAddress?: string
  additionalAddresses?: string[]
  /** ALT authority. Defaults to payer for unsigned generation and wallet public key for execute. */
  authority?: string
}

/** Parameters for unsigned Solana lookup table append generation. */
export type GenerateAppendToLookupTableParams = SolanaGenerateParams<AppendToLookupTableParams>

/** Unsigned append lookup table result. */
export type GenerateAppendToLookupTableResult = UnsignedSolanaTx

/** Parameters for executing Solana TokenAdminRegistry `appendToLookupTable`. */
export type ExecuteAppendToLookupTableParams = SolanaExecuteParams<AppendToLookupTableParams>

/** Result of executing Solana TokenAdminRegistry `appendToLookupTable`. */
export type ExecuteAppendToLookupTableResult = TransactionHash

/** Builds and submits Solana ALT extend instructions for token pool setup. */
export class AppendToLookupTable extends SolanaOperation<
  AppendToLookupTableParams,
  GenerateAppendToLookupTableResult
> {
  readonly name = 'appendToLookupTable'

  /** Validates all public keys before any RPC. */
  protected validate(params: GenerateAppendToLookupTableParams): void {
    validatePublicKey(this.name, 'lookupTableAddress', params.lookupTableAddress)
    validatePublicKey(this.name, 'payer', params.payer)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
    if (params.tokenAddress) validatePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    if (params.poolProgramAddress) {
      validatePublicKey(this.name, 'poolProgramAddress', params.poolProgramAddress)
    }
    for (const [i, address] of (params.additionalAddresses ?? []).entries()) {
      validatePublicKey(this.name, `additionalAddresses[${i}]`, address)
    }

    if (Boolean(params.tokenAddress) !== Boolean(params.poolProgramAddress)) {
      throw new CCTParamsInvalidError(
        this.name,
        'tokenAddress',
        'tokenAddress and poolProgramAddress must be provided together',
      )
    }
    if (!params.tokenAddress && !params.additionalAddresses?.length) {
      throw new CCTParamsInvalidError(
        this.name,
        'additionalAddresses',
        'must provide tokenAddress/poolProgramAddress or additionalAddresses',
      )
    }
  }

  /** Builds unsigned ALT extend instructions. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: GenerateAppendToLookupTableParams,
  ): Promise<GenerateAppendToLookupTableResult> {
    const payer = new PublicKey(opts.payer)
    const authority = new PublicKey(opts.authority ?? opts.payer)
    const lookupTableAddress = new PublicKey(opts.lookupTableAddress)
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

    const addresses = [...(opts.additionalAddresses ?? []).map((a) => new PublicKey(a))]

    if (opts.tokenAddress && opts.poolProgramAddress) {
      const poolProgram = new PublicKey(opts.poolProgramAddress)
      const tokenMint = new PublicKey(opts.tokenAddress)
      const ccipAddresses = await deriveCcipLookupTableAddresses(chain, {
        lookupTableAddress,
        tokenMint,
        poolProgram,
        authority,
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
    const { wallet, computeUnits, ...rest } = params
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const payer = wallet.publicKey.toBase58()
    const generateParams: GenerateAppendToLookupTableParams = { ...rest, payer }
    this.validate(generateParams)

    const authority = params.authority ? new PublicKey(params.authority) : undefined
    if (authority && !authority.equals(wallet.publicKey)) {
      throw new CCTParamsInvalidError(
        this.name,
        'authority',
        'appendToLookupTable requires authority to be the executing wallet. Use generateUnsignedAppendToLookupTable for vault-owned ALTs and have the vault sign/execute it.',
      )
    }

    const tx = await this.buildUnsigned(chain, generateParams)
    return submit(chain, wallet, tx, this.name, computeUnits)
  }
}
