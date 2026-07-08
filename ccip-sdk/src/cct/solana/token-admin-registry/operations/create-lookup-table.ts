import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { AddressLookupTableProgram, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { resolveATA } from '../../../../solana/utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import { type SolanaGenerateParams, SolanaOperation } from '../../operation.ts'
import { deriveFeeBillingTokenConfigPda } from '../../programs/fee-quoter.ts'
import {
  deriveExternalTokenPoolsSignerPda,
  deriveTokenAdminRegistryPda,
} from '../../programs/router.ts'
import { deriveTokenPoolConfigPda, deriveTokenPoolSignerPda } from '../../programs/token-pool.ts'
import { validatePublicKey } from '../../validate.ts'

const MAX_ALT_ADDRESSES = 256
const EXTEND_CHUNK_SIZE = 30

/** Parameters for creating a pool lookup table for Solana `setPool`. */
export type CreateLookupTableParams = {
  tokenAddress: string
  poolProgramAddress: string
  additionalAddresses?: string[]
  authority?: string
}

/** Parameters for unsigned Solana lookup table generation. */
export type GenerateCreateLookupTableParams = SolanaGenerateParams<CreateLookupTableParams>

/** Unsigned create lookup table result, including the derived ALT address. */
export type GenerateCreateLookupTableResult = UnsignedSolanaTx & {
  lookupTableAddress: string
}

/** Submitted create lookup table result. */
export type CreateLookupTableResult = TransactionHash

/** Builds and submits Solana ALT create+extend instructions for token pool setup. */
export class CreateLookupTable extends SolanaOperation<
  CreateLookupTableParams,
  GenerateCreateLookupTableResult
> {
  readonly name = 'createLookupTable'

  /** Validates all public keys before any RPC. */
  protected validate(params: GenerateCreateLookupTableParams): void {
    validatePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    validatePublicKey(this.name, 'poolProgramAddress', params.poolProgramAddress)
    validatePublicKey(this.name, 'payer', params.payer)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
    for (const [i, address] of (params.additionalAddresses ?? []).entries()) {
      validatePublicKey(this.name, `additionalAddresses[${i}]`, address)
    }
  }

  /** Builds unsigned ALT create+extend instructions. */
  protected async encode(
    chain: SolanaChain,
    opts: GenerateCreateLookupTableParams,
  ): Promise<GenerateCreateLookupTableResult> {
    const poolProgram = new PublicKey(opts.poolProgramAddress)
    const tokenMint = new PublicKey(opts.tokenAddress)
    const payer = new PublicKey(opts.payer)
    const authority = new PublicKey(opts.authority ?? opts.payer)
    const additionalAddresses = (opts.additionalAddresses ?? []).map((a) => new PublicKey(a))

    const [createIx, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
      authority,
      payer,
      recentSlot: await chain.connection.getSlot(),
    })

    const { tokenProgram } = await resolveATA(chain.connection, tokenMint, authority)
    const poolConfig = deriveTokenPoolConfigPda(poolProgram, tokenMint)
    const { router: routerAddress } = await chain.getTokenPoolConfig(poolConfig.toBase58())
    const router = new PublicKey(routerAddress)
    const { feeQuoter } = await chain._getRouterConfig(routerAddress)

    const tokenAdminRegistry = deriveTokenAdminRegistryPda(router, tokenMint)
    const poolSigner = deriveTokenPoolSignerPda(poolProgram, tokenMint)
    const poolTokenAta = getAssociatedTokenAddressSync(tokenMint, poolSigner, true, tokenProgram)
    const feeTokenConfig = deriveFeeBillingTokenConfigPda(feeQuoter, tokenMint)
    const routerPoolSigner = deriveExternalTokenPoolsSignerPda(router, poolProgram)

    const addresses = [
      lookupTableAddress,
      tokenAdminRegistry,
      poolProgram,
      poolConfig,
      poolTokenAta,
      poolSigner,
      tokenProgram,
      tokenMint,
      feeTokenConfig,
      routerPoolSigner,
      ...additionalAddresses,
    ]

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
      `${this.name}: router = ${router.toBase58()}, token = ${tokenMint.toBase58()}, lookupTable = ${lookupTableAddress.toBase58()}`,
    )
    return {
      family: ChainFamily.Solana,
      instructions: [createIx, ...extendIxs],
      mainIndex: 0,
      lookupTableAddress: lookupTableAddress.toBase58(),
    }
  }
}
