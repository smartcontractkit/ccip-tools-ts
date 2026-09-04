import type { MetadataAccountData } from '@metaplex-foundation/mpl-token-metadata'
import { type TransactionInstruction, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import { deriveMetadataAddress } from '../../programs/token.ts'
import { submit } from '../../submit.ts'
import { parsePublicKey, validateAuthorityMatchesWallet } from '../../validate.ts'
import { METADATA_PROGRAM_ID } from '../constants.ts'

type UpdateMetadataAuthorityParams = {
  /** SPL token mint address with Metaplex metadata. */
  tokenAddress: string
  /** Address to receive the Metaplex metadata update authority. */
  newAuthority: string
  /** Current metadata update authority. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

type ParsedUpdateMetadataAuthorityParams = {
  tokenAddress: PublicKey
  newAuthority: PublicKey
  authority: PublicKey
  payer: PublicKey
}

function validateMetadataAuthority(
  operation: string,
  metadata: MetadataAccountData,
  { authority }: ParsedUpdateMetadataAuthorityParams,
): void {
  if (!new PublicKey(metadata.updateAuthority).equals(authority)) {
    throw new CCTParamsInvalidError(
      operation,
      'authority',
      `${authority.toBase58()} is not the current metadata update authority (${metadata.updateAuthority})`,
    )
  }
  if (!metadata.isMutable) {
    throw new CCTTxFailedError(operation, 'metadata is immutable and cannot be updated')
  }
}

/** Parameters for unsigned Solana Metaplex metadata authority update. */
export type GenerateUpdateMetadataAuthorityParams =
  SolanaGenerateParams<UpdateMetadataAuthorityParams>

/** Unsigned Solana Metaplex metadata authority update result. */
export type GenerateUpdateMetadataAuthorityResult = UnsignedSolanaTx

/** Parameters for executing Solana Metaplex metadata authority update. */
export type ExecuteUpdateMetadataAuthorityParams =
  SolanaExecuteParams<UpdateMetadataAuthorityParams>

/** Result of executing Solana Metaplex metadata authority update. */
export type ExecuteUpdateMetadataAuthorityResult = TransactionResult

async function loadMetaplex() {
  const [metadata, umi, bundleDefaults, web3] = await Promise.all([
    import('@metaplex-foundation/mpl-token-metadata'),
    import('@metaplex-foundation/umi'),
    import('@metaplex-foundation/umi-bundle-defaults'),
    import('@metaplex-foundation/umi-web3js-adapters'),
  ])

  return {
    createNoopSigner: umi.createNoopSigner,
    createUmi: bundleDefaults.createUmi,
    getMetadataAccountDataSerializer: metadata.getMetadataAccountDataSerializer,
    mplTokenMetadata: metadata.mplTokenMetadata,
    publicKey: umi.publicKey,
    signerIdentity: umi.signerIdentity,
    toWeb3JsInstruction: web3.toWeb3JsInstruction,
    updateV1: metadata.updateV1,
  }
}

async function getMetadata(
  operation: string,
  chain: SolanaChain,
  tokenAddress: PublicKey,
  metaplex: Awaited<ReturnType<typeof loadMetaplex>>,
): Promise<MetadataAccountData> {
  const metadata = await chain.connection.getAccountInfo(deriveMetadataAddress(tokenAddress))
  if (!metadata || !metadata.owner.equals(METADATA_PROGRAM_ID)) {
    throw new CCTParamsInvalidError(
      operation,
      'tokenAddress',
      'mint not found or does not have Metaplex metadata',
    )
  }

  try {
    return metaplex.getMetadataAccountDataSerializer().deserialize(metadata.data)[0]
  } catch {
    throw new CCTParamsInvalidError(
      operation,
      'tokenAddress',
      'mint not found or does not have Metaplex metadata',
    )
  }
}

/** Transfers the Metaplex metadata update authority for an SPL token mint. */
export class UpdateMetadataAuthority extends SolanaOperation<
  UpdateMetadataAuthorityParams,
  UnsignedSolanaTx,
  ParsedUpdateMetadataAuthorityParams
> {
  readonly name = 'updateMetadataAuthority'

  /** Parses the mint and current and new metadata update authorities. */
  protected override parse(
    params: GenerateUpdateMetadataAuthorityParams,
  ): ParsedUpdateMetadataAuthorityParams {
    const payer = parsePublicKey(this.name, 'payer', params.payer)
    return {
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      newAuthority: parsePublicKey(this.name, 'newAuthority', params.newAuthority),
      authority:
        params.authority === undefined
          ? payer
          : parsePublicKey(this.name, 'authority', params.authority),
      payer,
    }
  }

  /** Validates the Metaplex metadata account and builds its `UpdateV1` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedUpdateMetadataAuthorityParams,
  ): Promise<UnsignedSolanaTx> {
    const metaplex = await loadMetaplex()
    const authority = metaplex.createNoopSigner(metaplex.publicKey(opts.authority.toBase58()))
    const umi = metaplex
      .createUmi(chain.connection)
      .use(metaplex.mplTokenMetadata())
      .use(
        metaplex.signerIdentity(
          metaplex.createNoopSigner(metaplex.publicKey(opts.payer.toBase58())),
        ),
      )

    const metadata = await getMetadata(this.name, chain, opts.tokenAddress, metaplex)
    validateMetadataAuthority(this.name, metadata, opts)

    const mint = metaplex.publicKey(opts.tokenAddress.toBase58())

    const instructions: TransactionInstruction[] = metaplex
      .updateV1(umi, {
        mint,
        authority,
        newUpdateAuthority: metaplex.publicKey(opts.newAuthority.toBase58()),
      })
      .getInstructions()
      .map(metaplex.toWeb3JsInstruction)

    chain.logger.debug(
      `${this.name}: token = ${opts.tokenAddress.toBase58()}, newAuthority = ${opts.newAuthority.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions, mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the current metadata authority wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteUpdateMetadataAuthorityParams,
  ): Promise<ExecuteUpdateMetadataAuthorityResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'updateMetadataAuthority requires authority to be the executing wallet. Use generateUnsignedUpdateMetadataAuthority for externally signed transactions.',
      )
    }

    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
