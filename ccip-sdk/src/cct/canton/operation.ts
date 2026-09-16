/**
 * Canton {@link Operation} lifecycle: validate → parse → build unsigned
 * `JsCommands` → submit via {@link submitCantonCommands}.
 *
 * Mirrors the Solana split: {@link CantonGenerateParams} (with an explicit
 * `sender` party, no wallet) for {@link generate}, and {@link CantonExecuteParams}
 * (with a `wallet`) for {@link execute}. `execute` derives `sender` from
 * `wallet.party`, builds the commands, and submits via
 * {@link submitCantonCommands} (prepare → sign → execute when a `signer`
 * is present, direct submit otherwise).
 *
 * @packageDocumentation
 */

import { CCIPError, CCIPWalletInvalidError } from '../../errors/index.ts'
import type { JsCommands } from '../../canton/client/index.ts'
import { getTemplateEntityName } from '../../canton/events.ts'
import type { CantonChain } from '../../canton/index.ts'
import { submitCantonCommands } from '../../canton/submit-commands.ts'
import { type CantonWallet, isCantonWallet, type UnsignedCantonTx } from '../../canton/types.ts'
import { CCTTxFailedError } from '../errors.ts'
import { Operation } from '../operation.ts'
import type { CantonTransactionResult } from './types.ts'

/**
 * Canton generate params: an op's own params plus the acting `sender` party.
 * No wallet — used by {@link CantonOperation.generate} to build unsigned txs.
 */
export type CantonGenerateParams<P extends object> = P & {
  /** Acting party ID (`hint::1220…`), used for `actAs`. */
  sender: string
}

/**
 * Canton execute params: an op's own params plus the signing `wallet`.
 * `sender` is derived from `wallet.party` by {@link CantonOperation.execute},
 * so callers omit `sender` on execute (only `wallet` is required).
 *
 * Structurally includes `sender?` so the type satisfies the base
 * `ExecuteParams<CantonGenerateParams<P>>` contract (which requires `sender`).
 */
export type CantonExecuteParams<P extends object> = P & {
  /**
   * Canton wallet identifying the acting party (and optional external signer).
   * Declared `unknown` (matching the base `ExecuteParams` contract) and narrowed
   * to {@link CantonWallet} inside {@link CantonOperation.execute} via
   * {@link isCantonWallet}, so this override stays assignable to the base.
   */
  wallet: unknown
  /** Acting party ID — optional on execute; derived from `wallet.party`. */
  sender?: string
}

/**
 * Canton CCT write base. Subclasses supply {@link parse} and
 * {@link buildCommands}.
 *
 * `generate` returns an {@link UnsignedCantonTx} (a `JsCommands` ready for
 * interactive submission or external signing). `execute` signs and submits via
 * {@link submitCantonCommands} and returns the confirmed `updateId`.
 *
 * `buildCommands` receives the parsed generate params (with `sender`), so it
 * reads `params.sender` for `actAs` — not `params.wallet.party`.
 */
export abstract class CantonOperation<
  P extends object,
  Parsed = CantonGenerateParams<P>,
> extends Operation<
  CantonChain,
  CantonGenerateParams<P>,
  UnsignedCantonTx,
  CantonTransactionResult,
  Parsed
> {
  /**
   * Optional validation hook required by the shared CCT operation contract.
   *
   * The default performs no validation. Prefer {@link parse} for Canton
   * operation validation and normalization; override this only when parsing
   * is unnecessary.
   */
  protected override validate(_params: CantonGenerateParams<P>): void {}

  /**
   * Normalize params without mutating the caller's input.
   *
   * The default returns params unchanged. Override whenever `Parsed` differs
   * from `CantonGenerateParams<P>`, e.g. to parse party IDs / instrument IDs
   * into validated forms or apply defaults.
   */
  protected override parse(params: CantonGenerateParams<P>): Parsed {
    return params as Parsed
  }

  /** Validates and normalizes params for generation or execution. */
  protected override prepare(params: CantonGenerateParams<P>): Parsed {
    this.validate(params)
    return this.parse(params)
  }

  /**
   * Build the `JsCommands` exercise-choice payload from validated, parsed
   * params. Subclasses fetch disclosures via `chain.acsDisclosureProvider` /
   * `chain.edsDisclosureProvider` and construct the exercise command(s) +
   * `actAs` (from `params.sender`) + `disclosedContracts`.
   */
  protected abstract buildCommands(
    chain: CantonChain,
    params: Parsed,
  ): Promise<JsCommands>

  /** Run {@link prepare} and {@link buildCommands}; no signing. */
  async generate(
    chain: CantonChain,
    params: CantonGenerateParams<P>,
  ): Promise<UnsignedCantonTx> {
    const commands = await this.buildCommands(chain, this.prepare(params))
    return { family: chain.network.family, commands }
  }

  /**
   * Validates the wallet, derives `sender` from `wallet.party`, builds the
   * commands, and submits via {@link submitCantonCommands}. Returns the
   * confirmed `updateId` plus the raw ledger response for result parsing.
   */
  async execute(
    chain: CantonChain,
    params: CantonExecuteParams<P>,
  ): Promise<CantonTransactionResult> {
    const { wallet, ...rest } = params
    if (!isCantonWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const parsed = this.prepare({ ...rest, sender: wallet.party } as CantonGenerateParams<P>)
    const commands = await this.buildCommands(chain, parsed)
    let response
    try {
      response = await submitCantonCommands(chain, commands, wallet.signer)
    } catch (error) {
      // Not CCTTxNotConfirmedError: Canton submit-and-wait isn't safely retriable.
      if (CCIPError.isCCIPError(error)) {
        throw new CCTTxFailedError(this.name, error.message, {
          cause: error,
          isTransient: error.isTransient,
          retryAfterMs: error.retryAfterMs,
        })
      }
      throw error
    }

    if (!response.transaction) {
      throw new CCTTxFailedError(this.name, 'submitted transaction response has no transaction field')
    }
    const txRecord = response.transaction as Record<string, unknown>
    const updateId: string =
      (typeof txRecord.update_id === 'string' ? txRecord.update_id : null) ??
      (typeof txRecord.updateId === 'string' ? txRecord.updateId : '')

    chain.logger.debug(`${this.name}: submitted, updateId=${updateId}`)
    return { hash: updateId, response }
  }
}

/** Matches by entity name — ledger events echo the concrete package-id, not the symbolic form. */
export function extractCreatedContractIds(
  response: CantonTransactionResult['response'],
  templateId: string,
): string[] {
  const entityName = templateId.split(':').at(-1) ?? templateId
  const events = (response.transaction as { events?: unknown[] } | undefined)?.events ?? []
  const ids: string[] = []
  for (const event of events) {
    const created = (event as { CreatedEvent?: Record<string, unknown> })?.CreatedEvent
    if (!created || typeof created['contractId'] !== 'string') continue
    if (getTemplateEntityName(created) === entityName) {
      ids.push(created['contractId'])
    }
  }
  return ids
}

/** `exerciseResult` of the first `ExercisedEvent` matching `choice` in a submitted transaction. */
export function extractExerciseResult(
  response: CantonTransactionResult['response'],
  choice: string,
): unknown {
  const events = (response.transaction as { events?: unknown[] } | undefined)?.events ?? []
  for (const event of events) {
    const exercised = (event as { ExercisedEvent?: Record<string, unknown> })?.ExercisedEvent
    if (exercised?.['choice'] === choice && exercised['exerciseResult'] != null) {
      return exercised['exerciseResult']
    }
  }
  return null
}
