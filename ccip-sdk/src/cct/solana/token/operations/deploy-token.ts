import { TokenStandard, createV1, mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata'
import {
  createNoopSigner,
  percentAmount,
  publicKey as umiPublicKey,
  signerIdentity,
} from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { toWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters'
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  getMintLen,
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
import { submit } from '../../submit.ts'
import { validatePublicKey } from '../../validate.ts'

type BaseDeployTokenParams = {
  /** Mint decimals. Must be an integer between 0 and 255. */
  decimals: number
  /** Token program that owns the mint: classic SPL Token or Token-2022. */
  tokenProgram: 'spl-token' | 'token-2022'
}

/**
 * Parameters for creating a Solana SPL mint.
 *
 * Set `withMetaplex: true` to create Metaplex metadata; `name` and `symbol` are required;
 */
type DeployTokenParams = BaseDeployTokenParams &
  (
    | { withMetaplex: false }
    | {
        withMetaplex: true
        /** Token display name for Metaplex metadata. Max 32 characters. */
        name: string
        /** Token symbol for Metaplex metadata. Max 10 characters. */
        symbol: string
        /** Metadata URI for Metaplex metadata JSON. Optional; defaults to an empty string when omitted. */
        uri?: string | undefined
      }
  )

/** Parameters for unsigned Solana token deploy generation. */
export type GenerateDeployTokenParams = SolanaGenerateParams<DeployTokenParams>

/** Unsigned token deploy transaction plus the created mint address. */
export type GenerateDeployTokenResult = UnsignedSolanaTx & { tokenAddress: string }

/** Parameters for executing Solana token deploy. */
export type ExecuteDeployTokenParams = SolanaExecuteParams<DeployTokenParams>

/** Result of executing Solana token deploy. */
export type ExecuteDeployTokenResult = TransactionHash & { tokenAddress: string }

function createMetadataInstructions(
  chain: SolanaChain,
  mint: PublicKey,
  payer: PublicKey,
  tokenProgram: PublicKey,
  decimals: number,
  params: { name: string; symbol: string; uri: string },
) {
  const payerSigner = createNoopSigner(umiPublicKey(payer.toBase58()))
  const umi = createUmi(chain.connection).use(mplTokenMetadata()).use(signerIdentity(payerSigner))

  return createV1(umi, {
    mint: umiPublicKey(mint.toBase58()),
    authority: payerSigner,
    payer: payerSigner,
    updateAuthority: payerSigner,
    splTokenProgram: umiPublicKey(tokenProgram.toBase58()),
    name: params.name,
    symbol: params.symbol,
    uri: params.uri,
    sellerFeeBasisPoints: percentAmount(0),
    decimals,
    tokenStandard: TokenStandard.Fungible,
  })
    .getInstructions()
    .map(toWeb3JsInstruction)
}

/** Creates a Solana SPL mint, optionally with Metaplex metadata. Does not mint supply. */
export class DeployToken extends SolanaOperation<DeployTokenParams, GenerateDeployTokenResult> {
  readonly name = 'deployToken'

  /** Validates mint and metadata params before any RPC. */
  protected validate(params: GenerateDeployTokenParams): void {
    validatePublicKey(this.name, 'payer', params.payer)
    if (!Number.isInteger(params.decimals) || params.decimals < 0 || params.decimals > 255) {
      throw new CCTParamsInvalidError(this.name, 'decimals', 'must be an integer between 0 and 255')
    }
    if (!['spl-token', 'token-2022'].includes(params.tokenProgram)) {
      throw new CCTParamsInvalidError(this.name, 'tokenProgram', 'must be spl-token or token-2022')
    }
    if (typeof params.withMetaplex !== 'boolean') {
      throw new CCTParamsInvalidError(this.name, 'withMetaplex', 'must be a boolean')
    }
    if (!params.withMetaplex) return
    if (!params.name || params.name.length > 32) {
      throw new CCTParamsInvalidError(
        this.name,
        'name',
        'is required and must be <= 32 characters when withMetaplex is true',
      )
    }
    if (!params.symbol || params.symbol.length > 10) {
      throw new CCTParamsInvalidError(
        this.name,
        'symbol',
        'is required and must be <= 10 characters when withMetaplex is true',
      )
    }
    if (params.uri !== undefined && typeof params.uri !== 'string') {
      throw new CCTParamsInvalidError(this.name, 'uri', 'must be a string when provided')
    }
  }

  /** Builds the unsigned Solana mint creation instruction set. */
  protected async buildUnsigned(
    chain: SolanaChain,
    params: GenerateDeployTokenParams,
  ): Promise<GenerateDeployTokenResult> {
    const payer = new PublicKey(params.payer)
    const tokenProgram =
      params.tokenProgram === 'token-2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID

    const seed = `mint_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const mint = await PublicKey.createWithSeed(payer, seed, tokenProgram)
    const mintSpace = getMintLen([])
    const lamports = await chain.connection.getMinimumBalanceForRentExemption(mintSpace)

    const instructions = [
      SystemProgram.createAccountWithSeed({
        fromPubkey: payer,
        newAccountPubkey: mint,
        basePubkey: payer,
        seed,
        lamports,
        space: mintSpace,
        programId: tokenProgram,
      }),
      createInitializeMintInstruction(mint, params.decimals, payer, payer, tokenProgram),
    ]

    if (params.withMetaplex)
      instructions.push(
        ...createMetadataInstructions(chain, mint, payer, tokenProgram, params.decimals, {
          name: params.name,
          symbol: params.symbol,
          uri: params.uri ?? '',
        }),
      )

    chain.logger.debug(
      `${this.name}: mint = ${mint.toBase58()}, tokenProgram = ${tokenProgram.toBase58()}`,
    )
    return {
      family: ChainFamily.Solana,
      instructions,
      mainIndex: 0,
      tokenAddress: mint.toBase58(),
    }
  }

  /** Generate, sign, simulate, send, confirm, and return the created mint address. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteDeployTokenParams,
  ): Promise<ExecuteDeployTokenResult> {
    const { wallet, computeUnits, ...rest } = params
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const tx = await this.generate(chain, { ...rest, payer: wallet.publicKey.toBase58() })
    const hash = await submit(chain, wallet, tx, this.name, computeUnits)
    return { ...hash, tokenAddress: tx.tokenAddress }
  }
}
