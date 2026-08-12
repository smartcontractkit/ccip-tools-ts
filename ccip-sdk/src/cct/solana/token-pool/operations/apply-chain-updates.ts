import {
  type TransactionInstruction,
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'

import { DeleteChainRemoteConfig } from './delete-chain-remote-config.ts'
import { EditChainRemoteConfig } from './edit-chain-remote-config.ts'
import { InitChainRemoteConfig } from './init-chain-remote-config.ts'
import { type RateLimitConfig, SetChainRateLimit } from './set-chain-rate-limit.ts'
import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import type { PoolProgramRef } from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import {
  parseHexBytes,
  parsePublicKey,
  resolvePoolProgram,
  validateAuthorityMatchesWallet,
} from '../../validate.ts'

const MAX_TRANSACTION_SIZE = 1232

/** A remote-chain configuration to add, matching the EVM `ChainUpdate` fields plus Solana decimals. */
type ChainUpdate = {
  /** CCIP selector of the remote chain (`u64`). */
  remoteChainSelector: bigint
  /** Hex-encoded remote token address, optionally `0x`-prefixed, up to 32 bytes. */
  remoteTokenAddress: string
  /** Hex-encoded remote pool addresses, optionally `0x`-prefixed; supplied addresses are non-empty and unique. */
  remotePoolAddresses: string[]
  /** Remote token decimals (`u8`), required by the Solana pool account. */
  remoteTokenDecimals: number
  /** Rate limit for tokens received from the remote chain. */
  inboundRateLimiterConfig: RateLimitConfig
  /** Rate limit for tokens sent to the remote chain. */
  outboundRateLimiterConfig: RateLimitConfig
}

type ApplyChainUpdatesParams = PoolProgramRef & {
  /** Token mint address managed by the local pool. */
  tokenAddress: string
  /**
   * Remote chain configurations to add, including their rate limits. To replace a config, include
   * its selector here and in `remoteChainSelectorsToRemove`.
   */
  chainsToAdd: ChainUpdate[]
  /** Remote chain configurations to delete before additions are initialized. */
  remoteChainSelectorsToRemove: bigint[]
  /** Pool owner. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

type PoolInstructionParams = PoolProgramRef & {
  tokenAddress: string
  payer: string
  authority: string
}

type ParsedApplyChainUpdatesParams = ApplyChainUpdatesParams & {
  payer: string
  authority: string
}

function validateRemotePoolAddresses(operation: string, updates: unknown[]): void {
  for (const [i, update] of updates.entries()) {
    if (typeof update !== 'object' || update === null) {
      throw new CCTParamsInvalidError(operation, `chainsToAdd[${i}]`, 'must be a chain update')
    }
    const remotePoolAddresses = (update as { remotePoolAddresses?: unknown }).remotePoolAddresses
    if (!Array.isArray(remotePoolAddresses)) continue

    const pools = new Set<string>()
    for (const [j, address] of remotePoolAddresses.entries()) {
      const parsed = parseHexBytes(
        operation,
        `chainsToAdd[${i}].remotePoolAddresses[${j}]`,
        address,
      )
      if (!parsed.length) {
        throw new CCTParamsInvalidError(
          operation,
          `chainsToAdd[${i}].remotePoolAddresses[${j}]`,
          'must not be empty',
        )
      }
      if (pools.has(parsed.toString('hex'))) {
        throw new CCTParamsInvalidError(
          operation,
          `chainsToAdd[${i}].remotePoolAddresses[${j}]`,
          'must not duplicate a remote pool address',
        )
      }
      pools.add(parsed.toString('hex'))
    }
  }
}

function fitsInTransaction(payer: PublicKey, instructions: TransactionInstruction[]): boolean {
  try {
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer,
        recentBlockhash: PublicKey.default.toBase58(),
        instructions: [
          // submit may add this instruction after simulation; include it so batches remain safe.
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
          ...instructions,
        ],
      }).compileToV0Message(),
    )
    return transaction.serialize().length <= MAX_TRANSACTION_SIZE
  } catch {
    return false
  }
}

/** Packs ordered instruction groups without splitting a remote-chain update across transactions. */
function packInstructionGroups(
  payer: PublicKey,
  groups: TransactionInstruction[][],
): UnsignedSolanaTx[] {
  const batches: UnsignedSolanaTx[] = []
  let instructions: TransactionInstruction[] = []

  for (const group of groups) {
    if (!fitsInTransaction(payer, group)) {
      throw new CCTParamsInvalidError(
        'applyChainUpdates',
        'chainsToAdd',
        `one update exceeds Solana's ${MAX_TRANSACTION_SIZE}-byte transaction limit`,
      )
    }
    if (instructions.length && !fitsInTransaction(payer, [...instructions, ...group])) {
      batches.push({ family: ChainFamily.Solana, instructions, mainIndex: 0 })
      instructions = []
    }
    instructions.push(...group)
  }

  if (instructions.length) batches.push({ family: ChainFamily.Solana, instructions, mainIndex: 0 })
  return batches
}

/** Parameters for unsigned Solana token pool chain updates. */
export type GenerateApplyChainUpdatesParams = SolanaGenerateParams<ApplyChainUpdatesParams>

/** Unsigned Solana token pool chain updates result. */
export type GenerateApplyChainUpdatesResult = UnsignedSolanaTx[]

/** Parameters for executing Solana token pool chain updates. */
export type ExecuteApplyChainUpdatesParams = SolanaExecuteParams<ApplyChainUpdatesParams>

/** All confirmed transaction hashes for Solana token pool chain updates. */
export type ExecuteApplyChainUpdatesResult = { hashes: string[] }

/**
 * Applies the EVM `applyChainUpdates` equivalent as Solana instructions.
 *
 * @remarks
 * This preserves EVM ordering: all removals run first, then each added chain is initialized,
 * configured with remote pools, and assigned both rate-limit configs. EVM-style replacement is
 * supported by listing a selector in both `remoteChainSelectorsToRemove` and `chainsToAdd`;
 * adding an existing selector without removing it fails. Updates are packed into one or more
 * transactions, keeping each chain's initialization, configuration, and rate-limit instructions
 * together.
 */
export class ApplyChainUpdates extends SolanaOperation<
  ApplyChainUpdatesParams,
  UnsignedSolanaTx,
  ParsedApplyChainUpdatesParams
> {
  readonly name = 'applyChainUpdates'

  /** Validates the batch envelope; component operations validate each chain update. */
  protected override parse(params: GenerateApplyChainUpdatesParams): ParsedApplyChainUpdatesParams {
    parsePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    parsePublicKey(this.name, 'payer', params.payer)
    resolvePoolProgram(this.name, params)
    if (!Array.isArray(params.chainsToAdd)) {
      throw new CCTParamsInvalidError(this.name, 'chainsToAdd', 'must be an array')
    }
    if (!Array.isArray(params.remoteChainSelectorsToRemove)) {
      throw new CCTParamsInvalidError(this.name, 'remoteChainSelectorsToRemove', 'must be an array')
    }
    if (!params.chainsToAdd.length && !params.remoteChainSelectorsToRemove.length) {
      throw new CCTParamsInvalidError(
        this.name,
        'chainsToAdd',
        'or remoteChainSelectorsToRemove must not be empty',
      )
    }
    validateRemotePoolAddresses(this.name, params.chainsToAdd)

    return {
      ...params,
      authority:
        params.authority === undefined
          ? params.payer
          : parsePublicKey(this.name, 'authority', params.authority).toBase58(),
    }
  }

  /** Builds the initialize, edit, and rate-limit instructions for one added chain. */
  private async buildAddInstructions(
    chain: SolanaChain,
    pool: PoolInstructionParams,
    update: ChainUpdate,
  ): Promise<TransactionInstruction[]> {
    const config = {
      ...pool,
      remoteChainSelector: update.remoteChainSelector,
      remoteTokenAddress: update.remoteTokenAddress,
      remotePoolAddresses: update.remotePoolAddresses,
      remoteTokenDecimals: update.remoteTokenDecimals,
    }
    const init = await new InitChainRemoteConfig().generate(chain, config)
    const edit = await new EditChainRemoteConfig().generate(chain, config)
    const rateLimit = await new SetChainRateLimit().generate(chain, {
      ...pool,
      remoteChainSelector: update.remoteChainSelector,
      inbound: update.inboundRateLimiterConfig,
      outbound: update.outboundRateLimiterConfig,
    })
    return [...init.instructions, ...edit.instructions, ...rateLimit.instructions]
  }

  /** Builds ordered delete and per-chain update instruction groups. */
  private async buildInstructionGroups(
    chain: SolanaChain,
    params: ParsedApplyChainUpdatesParams,
  ): Promise<TransactionInstruction[][]> {
    const pool: PoolInstructionParams = {
      tokenAddress: params.tokenAddress,
      payer: params.payer,
      authority: params.authority,
      ...(params.poolType === undefined
        ? { poolProgramAddress: params.poolProgramAddress }
        : { poolType: params.poolType }),
    }
    const groups: TransactionInstruction[][] = []

    for (const remoteChainSelector of params.remoteChainSelectorsToRemove) {
      const tx = await new DeleteChainRemoteConfig().generate(chain, {
        ...pool,
        remoteChainSelector,
      })
      groups.push(tx.instructions)
    }
    for (const update of params.chainsToAdd) {
      groups.push(await this.buildAddInstructions(chain, pool, update))
    }
    return groups
  }

  /** Builds all instructions in contract-equivalent order as one unsigned transaction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    params: ParsedApplyChainUpdatesParams,
  ): Promise<UnsignedSolanaTx> {
    return {
      family: ChainFamily.Solana,
      instructions: (await this.buildInstructionGroups(chain, params)).flat(),
      mainIndex: 0,
    }
  }

  /** Builds one or more ordered transactions without splitting a per-chain update group. */
  async generateBatch(
    chain: SolanaChain,
    params: GenerateApplyChainUpdatesParams,
  ): Promise<GenerateApplyChainUpdatesResult> {
    const parsed = this.prepare(params)
    return packInstructionGroups(
      new PublicKey(parsed.payer),
      await this.buildInstructionGroups(chain, parsed),
    )
  }

  /** Signs, submits, and confirms each packed transaction, returning every transaction hash. */
  async executeBatch(
    chain: SolanaChain,
    params: ExecuteApplyChainUpdatesParams,
  ): Promise<ExecuteApplyChainUpdatesResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)
    validateAuthorityMatchesWallet(
      this.name,
      new PublicKey(parsed.authority),
      wallet.publicKey,
      'applyChainUpdates requires authority to be the executing wallet. Use generateUnsignedApplyChainUpdates for externally signed transactions.',
    )

    const batches = packInstructionGroups(
      wallet.publicKey,
      await this.buildInstructionGroups(chain, parsed),
    )
    const hashes: string[] = []

    for (const batch of batches) {
      const tx = await submit(chain, wallet, batch, this.name, computeUnits)
      hashes.push(tx.hash)
    }

    return { hashes }
  }
}
