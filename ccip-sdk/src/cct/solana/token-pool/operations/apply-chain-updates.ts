import { PublicKey } from '@solana/web3.js'

import { DeleteChainRemoteConfig } from './delete-chain-remote-config.ts'
import { EditChainRemoteConfig } from './edit-chain-remote-config.ts'
import { InitChainRemoteConfig } from './init-chain-remote-config.ts'
import { type RateLimitConfig, SetChainRateLimit } from './set-chain-rate-limit.ts'
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
import type { PoolProgramRef } from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import {
  parseHexBytes,
  parsePublicKey,
  resolvePoolProgram,
  validateAuthorityMatchesWallet,
} from '../../validate.ts'

/** A remote-chain configuration to add, matching the EVM `ChainUpdate` fields plus Solana decimals. */
type ChainUpdate = {
  /** CCIP selector of the remote chain (`u64`). */
  remoteChainSelector: bigint
  /** Hex-encoded remote token address, optionally `0x`-prefixed, up to 32 bytes. */
  remoteTokenAddress: string
  /** Non-empty, unique hex-encoded remote pool addresses, optionally `0x`-prefixed. */
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

type ParsedApplyChainUpdatesParams = ApplyChainUpdatesParams & {
  payer: string
  authority: string
}

/** Parameters for unsigned Solana token pool chain updates. */
export type GenerateApplyChainUpdatesParams = SolanaGenerateParams<ApplyChainUpdatesParams>

/** Unsigned Solana token pool chain updates result. */
export type GenerateApplyChainUpdatesResult = UnsignedSolanaTx

/** Parameters for executing Solana token pool chain updates. */
export type ExecuteApplyChainUpdatesParams = SolanaExecuteParams<ApplyChainUpdatesParams>

/** Result of executing Solana token pool chain updates. */
export type ExecuteApplyChainUpdatesResult = TransactionResult

/**
 * Applies the EVM `applyChainUpdates` equivalent as one Solana transaction.
 *
 * @remarks
 * This preserves EVM `applyChainUpdates` ordering: all removals run first, then each added chain
 * is initialized, configured with remote pools, and assigned both rate-limit configs (including
 * disabled configs). EVM-style replacement is therefore supported by listing a selector in both
 * arrays; adding an existing selector without removing it fails. Solana requires
 * `remoteTokenDecimals` and has native address-size limits in addition to the EVM fields.
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
  ) {
    const config = {
      ...pool,
      remoteChainSelector: update.remoteChainSelector,
      remoteTokenAddress: update.remoteTokenAddress,
      remotePoolAddresses: update.remotePoolAddresses,
      remoteTokenDecimals: update.remoteTokenDecimals,
    }
    const init = await new InitChainRemoteConfig().generate(chain, config)
    const edit = await new EditChainRemoteConfig().generate(chain, config)
    const instructions = [...init.instructions, ...edit.instructions]

    const rateLimit = await new SetChainRateLimit().generate(chain, {
      ...pool,
      remoteChainSelector: update.remoteChainSelector,
      inbound: update.inboundRateLimiterConfig,
      outbound: update.outboundRateLimiterConfig,
    })
    instructions.push(...rateLimit.instructions)
    return instructions
  }

  /** Builds the component instructions in contract-equivalent order. */
  protected async buildUnsigned(
    chain: SolanaChain,
    params: ParsedApplyChainUpdatesParams,
  ): Promise<UnsignedSolanaTx> {
    const pool: PoolInstructionParams = {
      tokenAddress: params.tokenAddress,
      payer: params.payer,
      authority: params.authority,
      ...(params.poolType === undefined
        ? { poolProgramAddress: params.poolProgramAddress }
        : { poolType: params.poolType }),
    }
    const instructions = []

    for (const remoteChainSelector of params.remoteChainSelectorsToRemove) {
      const tx = await new DeleteChainRemoteConfig().generate(chain, {
        ...pool,
        remoteChainSelector,
      })
      instructions.push(...tx.instructions)
    }
    for (const update of params.chainsToAdd) {
      instructions.push(...(await this.buildAddInstructions(chain, pool, update)))
    }

    return { family: ChainFamily.Solana, instructions, mainIndex: 0 }
  }

  /** Generates, signs, simulates, sends, and confirms the update transaction. */
  override async execute(
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
    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
