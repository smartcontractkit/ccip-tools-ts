import { AddressLookupTableProgram, PublicKey } from '@solana/web3.js'

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
  buildCreateLookupTableInstruction,
  deriveCcipLookupTableAddresses,
} from '../../programs/alt.ts'
import { submit } from '../../submit.ts'
import { validatePublicKey } from '../../validate.ts'

const MAX_ALT_ADDRESSES = 256
const EXTEND_CHUNK_SIZE = 30

type CreateLookupTableMode = 'createAndExtend' | 'createEmpty'

/** Parameters shared by Solana TokenAdminRegistry `createLookupTable` generation and execution. */
type CreateLookupTableParams =
  | {
      /** Defaults to `createAndExtend`; use `createEmpty` to skip extending the ALT. */
      mode?: Extract<CreateLookupTableMode, 'createAndExtend'>
      tokenAddress: string
      poolProgramAddress: string
      additionalAddresses?: string[]
      /** ALT authority. Defaults to payer for unsigned generation and wallet public key for execute. */
      authority?: string
    }
  | {
      /** Creates an empty ALT without extend instructions. */
      mode: Extract<CreateLookupTableMode, 'createEmpty'>
      /** ALT authority. Defaults to payer for unsigned generation and wallet public key for execute. */
      authority?: string
    }

/** Parameters for unsigned Solana lookup table generation. */
export type GenerateCreateLookupTableParams = SolanaGenerateParams<CreateLookupTableParams>

/** Unsigned create lookup table result, including the derived ALT address. */
export type GenerateCreateLookupTableResult = UnsignedSolanaTx & {
  lookupTableAddress: string
}

/** Parameters for executing Solana TokenAdminRegistry `createLookupTable`. */
export type ExecuteCreateLookupTableParams = SolanaExecuteParams<CreateLookupTableParams>

/** Result of executing Solana TokenAdminRegistry `createLookupTable`. */
export type ExecuteCreateLookupTableResult = TransactionHash & { lookupTableAddress: string }

/** Builds and submits Solana ALT create instructions, optionally with extend instructions. */
export class CreateLookupTable extends SolanaOperation<
  CreateLookupTableParams,
  GenerateCreateLookupTableResult,
  ExecuteCreateLookupTableResult
> {
  readonly name = 'createLookupTable'

  /** Validates all public keys before any RPC. */
  protected validate(params: GenerateCreateLookupTableParams): void {
    validatePublicKey(this.name, 'payer', params.payer)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
    if (params.mode === 'createEmpty') return

    validatePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    validatePublicKey(this.name, 'poolProgramAddress', params.poolProgramAddress)
    for (const [i, address] of (params.additionalAddresses ?? []).entries()) {
      validatePublicKey(this.name, `additionalAddresses[${i}]`, address)
    }
  }

  /** Builds unsigned ALT create instructions, optionally with extend instructions. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: GenerateCreateLookupTableParams,
  ): Promise<GenerateCreateLookupTableResult> {
    const payer = new PublicKey(opts.payer)
    const authority = new PublicKey(opts.authority ?? opts.payer)

    const { instruction: createIx, lookupTableAddress } = buildCreateLookupTableInstruction({
      authority,
      payer,
      recentSlot: await chain.connection.getSlot('finalized'),
    })

    if (opts.mode === 'createEmpty') {
      chain.logger.debug(
        `${this.name}: mode = createEmpty, lookupTable = ${lookupTableAddress.toBase58()}`,
      )
      return {
        family: ChainFamily.Solana,
        instructions: [createIx],
        mainIndex: 0,
        lookupTableAddress: lookupTableAddress.toBase58(),
      }
    }

    const poolProgram = new PublicKey(opts.poolProgramAddress)
    const tokenMint = new PublicKey(opts.tokenAddress)
    const additionalAddresses = (opts.additionalAddresses ?? []).map((a) => new PublicKey(a))

    const ccipAddresses = await deriveCcipLookupTableAddresses(chain, {
      lookupTableAddress,
      tokenMint,
      poolProgram,
      authority,
    })
    const addresses = [...ccipAddresses, ...additionalAddresses]

    if (addresses.length > MAX_ALT_ADDRESSES) {
      throw new CCTParamsInvalidError(
        this.name,
        'additionalAddresses',
        `ALT cannot exceed ${MAX_ALT_ADDRESSES} addresses; requested ${addresses.length}`,
      )
    }

    const extendIxs = []
    for (let i = 0; i < addresses.length; i += EXTEND_CHUNK_SIZE) {
      extendIxs.push(
        AddressLookupTableProgram.extendLookupTable({
          payer,
          authority,
          lookupTable: lookupTableAddress,
          addresses: addresses.slice(i, i + EXTEND_CHUNK_SIZE),
        }),
      )
    }

    chain.logger.debug(
      `${this.name}: token = ${tokenMint.toBase58()}, lookupTable = ${lookupTableAddress.toBase58()}`,
    )
    return {
      family: ChainFamily.Solana,
      instructions: [createIx, ...extendIxs],
      mainIndex: 0,
      lookupTableAddress: lookupTableAddress.toBase58(),
    }
  }

  /** Adds the generated lookup table address to the execute result. */
  protected override resultFromGenerated(
    hash: TransactionHash,
    tx: GenerateCreateLookupTableResult,
  ): ExecuteCreateLookupTableResult {
    return { ...hash, lookupTableAddress: tx.lookupTableAddress }
  }

  /** Generate, sign, simulate, send, and confirm with wallet.publicKey as payer. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteCreateLookupTableParams,
  ): Promise<ExecuteCreateLookupTableResult> {
    const { wallet, computeUnits, ...rest } = params
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const payer = wallet.publicKey.toBase58()
    if (
      params.mode !== 'createEmpty' &&
      params.authority &&
      !new PublicKey(params.authority).equals(wallet.publicKey)
    ) {
      throw new CCTParamsInvalidError(
        this.name,
        'authority',
        "createAndExtend requires authority to be the executing wallet. Use mode: 'createEmpty' for vault-owned ALTs.",
      )
    }

    const tx = await this.generate(chain, { ...rest, payer })
    const hash = await submit(chain, wallet, tx, this.name, computeUnits)
    return this.resultFromGenerated(hash, tx)
  }
}
