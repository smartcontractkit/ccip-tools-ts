import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
} from '@solana/spl-token'
import { type TransactionInstruction, PublicKey, SystemProgram } from '@solana/web3.js'

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
  /** Token program that owns the mint: classic SPL Token or Token-2022. Defaults to spl-token. */
  tokenProgram?: 'spl-token' | 'token-2022'
  /** Mint authority. Defaults to payer. */
  mintAuthority?: string
  /** Freeze authority. Defaults to payer; set null to disable freezing. */
  freezeAuthority?: string | null
  /** Initial supply in base units. Requires preMintRecipient. */
  preMint?: bigint
  /** Recipient owner for the initial supply ATA. */
  preMintRecipient?: string
  /** Seed for deterministic mint address derivation. Defaults to a random seed. Max 32 UTF-8 bytes. */
  seed?: string
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
        /** Token display name for Metaplex metadata. Max 32 UTF-8 bytes. */
        name: string
        /** Token symbol for Metaplex metadata. Max 10 UTF-8 bytes. */
        symbol: string
        /** Metadata URI for Metaplex metadata JSON. Optional; defaults to an empty string when omitted. */
        uri?: string | undefined
      }
  )

/** Parameters for unsigned Solana token deploy generation. */
export type GenerateDeployTokenParams = SolanaGenerateParams<DeployTokenParams>

/** Unsigned token deploy transaction plus the created mint address. */
export type GenerateDeployTokenResult = UnsignedSolanaTx & {
  tokenAddress: string
  metadataAddress?: string
}

/** Parameters for executing Solana token deploy. */
export type ExecuteDeployTokenParams = SolanaExecuteParams<DeployTokenParams>

/** Result of executing Solana token deploy. */
export type ExecuteDeployTokenResult = TransactionHash & {
  tokenAddress: string
  metadataAddress?: string
}

const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function deriveMetadataAddress(mint: PublicKey): string {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID,
  )[0].toBase58()
}

async function loadMetaplex() {
  const [metadata, umi, bundleDefaults, web3] = await Promise.all([
    import('@metaplex-foundation/mpl-token-metadata'),
    import('@metaplex-foundation/umi'),
    import('@metaplex-foundation/umi-bundle-defaults'),
    import('@metaplex-foundation/umi-web3js-adapters'),
  ])

  return {
    TokenStandard: metadata.TokenStandard,
    createNoopSigner: umi.createNoopSigner,
    createUmi: bundleDefaults.createUmi,
    createV1: metadata.createV1,
    mplTokenMetadata: metadata.mplTokenMetadata,
    percentAmount: umi.percentAmount,
    publicKey: umi.publicKey,
    signerIdentity: umi.signerIdentity,
    toWeb3JsInstruction: web3.toWeb3JsInstruction,
  }
}

async function createMetadataInstructions(
  chain: SolanaChain,
  mint: PublicKey,
  payer: PublicKey,
  tokenProgram: PublicKey,
  decimals: number,
  mintAuthority: PublicKey,
  params: { name: string; symbol: string; uri: string },
): Promise<TransactionInstruction[]> {
  const metaplex = await loadMetaplex()
  const payerSigner = metaplex.createNoopSigner(metaplex.publicKey(payer.toBase58()))
  const mintAuthoritySigner = metaplex.createNoopSigner(
    metaplex.publicKey(mintAuthority.toBase58()),
  )
  const metadataUmi = metaplex
    .createUmi(chain.connection)
    .use(metaplex.mplTokenMetadata())
    .use(metaplex.signerIdentity(payerSigner))

  return metaplex
    .createV1(metadataUmi, {
      mint: metaplex.publicKey(mint.toBase58()),
      authority: mintAuthoritySigner,
      payer: payerSigner,
      updateAuthority: mintAuthoritySigner,
      splTokenProgram: metaplex.publicKey(tokenProgram.toBase58()),
      name: params.name,
      symbol: params.symbol,
      uri: params.uri,
      sellerFeeBasisPoints: metaplex.percentAmount(0),
      decimals,
      tokenStandard: metaplex.TokenStandard.Fungible,
    })
    .getInstructions()
    .map(metaplex.toWeb3JsInstruction)
}

type DeployTokenConfig = {
  payer: PublicKey
  mintAuthority: PublicKey
  freezeAuthority: PublicKey | null
  tokenProgram: PublicKey
  seed: string
}

function resolveDeployTokenConfig(params: GenerateDeployTokenParams): DeployTokenConfig {
  const payer = new PublicKey(params.payer)
  return {
    payer,
    mintAuthority: new PublicKey(params.mintAuthority ?? params.payer),
    freezeAuthority:
      params.freezeAuthority === null
        ? null
        : new PublicKey(params.freezeAuthority ?? params.payer),
    tokenProgram: params.tokenProgram === 'token-2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
    seed: params.seed ?? `mint_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  }
}

function createMintInstructions(
  mint: PublicKey,
  lamports: number,
  decimals: number,
  config: DeployTokenConfig,
): TransactionInstruction[] {
  return [
    SystemProgram.createAccountWithSeed({
      fromPubkey: config.payer,
      newAccountPubkey: mint,
      basePubkey: config.payer,
      seed: config.seed,
      lamports,
      space: getMintLen([]),
      programId: config.tokenProgram,
    }),
    createInitializeMint2Instruction(
      mint,
      decimals,
      config.mintAuthority,
      config.freezeAuthority,
      config.tokenProgram,
    ),
  ]
}

function createPreMintInstructions(
  mint: PublicKey,
  params: GenerateDeployTokenParams,
  config: DeployTokenConfig,
): TransactionInstruction[] {
  if (params.preMint === undefined) return []

  const recipient = new PublicKey(params.preMintRecipient!)
  const ata = getAssociatedTokenAddressSync(mint, recipient, false, config.tokenProgram)
  return [
    createAssociatedTokenAccountIdempotentInstruction(
      config.payer,
      ata,
      recipient,
      mint,
      config.tokenProgram,
    ),
    createMintToInstruction(
      mint,
      ata,
      config.mintAuthority,
      params.preMint,
      [],
      config.tokenProgram,
    ),
  ]
}

function getExternalMintAuthoritySigner(
  params: DeployTokenParams,
  payer: string,
): string | undefined {
  const mintAuthority = params.mintAuthority ?? payer
  return (params.withMetaplex || params.preMint !== undefined) && mintAuthority !== payer
    ? mintAuthority
    : undefined
}

function validateBaseParams(operation: string, params: GenerateDeployTokenParams): void {
  validatePublicKey(operation, 'payer', params.payer)
  if (!Number.isInteger(params.decimals) || params.decimals < 0 || params.decimals > 255) {
    throw new CCTParamsInvalidError(operation, 'decimals', 'must be an integer between 0 and 255')
  }
  if (params.tokenProgram && !['spl-token', 'token-2022'].includes(params.tokenProgram)) {
    throw new CCTParamsInvalidError(operation, 'tokenProgram', 'must be spl-token or token-2022')
  }
  if (typeof params.withMetaplex !== 'boolean') {
    throw new CCTParamsInvalidError(operation, 'withMetaplex', 'must be a boolean')
  }
  if (params.seed !== undefined && (!params.seed || utf8ByteLength(params.seed) > 32)) {
    throw new CCTParamsInvalidError(operation, 'seed', 'must be non-empty and <= 32 UTF-8 bytes')
  }
  if (params.mintAuthority) validatePublicKey(operation, 'mintAuthority', params.mintAuthority)
  if (params.freezeAuthority !== undefined && params.freezeAuthority !== null) {
    validatePublicKey(operation, 'freezeAuthority', params.freezeAuthority)
  }
}

function validatePreMintParams(operation: string, params: GenerateDeployTokenParams): void {
  if (
    params.preMint !== undefined &&
    (typeof params.preMint !== 'bigint' || params.preMint <= 0n)
  ) {
    throw new CCTParamsInvalidError(operation, 'preMint', 'must be a positive bigint')
  }
  if (params.preMint !== undefined && !params.preMintRecipient) {
    throw new CCTParamsInvalidError(
      operation,
      'preMintRecipient',
      'is required when preMint is set',
    )
  }
  if (params.preMintRecipient)
    validatePublicKey(operation, 'preMintRecipient', params.preMintRecipient)
}

function validateMetaplexParams(operation: string, params: GenerateDeployTokenParams): void {
  if (!params.withMetaplex) return
  if (!params.name || utf8ByteLength(params.name) > 32) {
    throw new CCTParamsInvalidError(
      operation,
      'name',
      'is required and must be <= 32 UTF-8 bytes when withMetaplex is true',
    )
  }
  if (!params.symbol || utf8ByteLength(params.symbol) > 10) {
    throw new CCTParamsInvalidError(
      operation,
      'symbol',
      'is required and must be <= 10 UTF-8 bytes when withMetaplex is true',
    )
  }
  if (params.uri !== undefined && typeof params.uri !== 'string') {
    throw new CCTParamsInvalidError(operation, 'uri', 'must be a string when provided')
  }
}

/** Creates a Solana SPL mint, optionally with Metaplex metadata and initial supply. */
export class DeployToken extends SolanaOperation<DeployTokenParams, GenerateDeployTokenResult> {
  readonly name = 'deployToken'

  /** Validates mint and metadata params before any RPC. */
  protected validate(params: GenerateDeployTokenParams): void {
    validateBaseParams(this.name, params)
    validatePreMintParams(this.name, params)
    validateMetaplexParams(this.name, params)
  }

  /** Builds the unsigned Solana mint creation instruction set. */
  protected async buildUnsigned(
    chain: SolanaChain,
    params: GenerateDeployTokenParams,
  ): Promise<GenerateDeployTokenResult> {
    const config = resolveDeployTokenConfig(params)
    const mint = await PublicKey.createWithSeed(config.payer, config.seed, config.tokenProgram)
    const lamports = await chain.connection.getMinimumBalanceForRentExemption(getMintLen([]))
    const instructions = createMintInstructions(mint, lamports, params.decimals, config)

    const metadataAddress = params.withMetaplex ? deriveMetadataAddress(mint) : undefined
    if (params.withMetaplex)
      instructions.push(
        ...(await createMetadataInstructions(
          chain,
          mint,
          config.payer,
          config.tokenProgram,
          params.decimals,
          config.mintAuthority,
          {
            name: params.name,
            symbol: params.symbol,
            uri: params.uri ?? '',
          },
        )),
      )

    instructions.push(...createPreMintInstructions(mint, params, config))

    chain.logger.debug(
      `${this.name}: mint = ${mint.toBase58()}, tokenProgram = ${config.tokenProgram.toBase58()}`,
    )
    return {
      family: ChainFamily.Solana,
      instructions,
      mainIndex: 0,
      tokenAddress: mint.toBase58(),
      ...(metadataAddress ? { metadataAddress } : {}),
    }
  }

  /** Generate, sign, simulate, send, confirm, and return the created mint address. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteDeployTokenParams,
  ): Promise<ExecuteDeployTokenResult> {
    const { wallet, computeUnits, ...rest } = params
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const payer = wallet.publicKey.toBase58()
    const externalSigner = getExternalMintAuthoritySigner(rest, payer)
    if (externalSigner) {
      throw new CCTParamsInvalidError(
        this.name,
        'mintAuthority',
        `requires additional signer: ${externalSigner}. Use generateUnsignedDeployToken and sign externally.`,
      )
    }

    const tx = await this.generate(chain, { ...rest, payer })
    const hash = await submit(chain, wallet, tx, this.name, computeUnits)
    return {
      ...hash,
      tokenAddress: tx.tokenAddress,
      ...(tx.metadataAddress ? { metadataAddress: tx.metadataAddress } : {}),
    }
  }
}
