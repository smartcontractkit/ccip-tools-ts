/**
 * Canton {@link Operation} lifecycle: prepare → build unsigned
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

import type { JsCommands } from '../../canton/clients/ledger-api/client.ts'
import { getTemplateEntityName } from '../../canton/daml-parse.ts'
import type { CantonChain } from '../../canton/index.ts'
import type { UnsignedCantonTx } from '../../canton/types.ts'
import { CCIPError, CCIPTxOutcomeUnavailableError } from '../../errors/index.ts'
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
  /** Explicit command ID (idempotency key); defaults to a content-derived deterministic ID. */
  commandId?: string
}

/**
 * Canton execute params: an op's own params plus optional acting party.
 *
 * Canton signing is bound to the {@link CantonChain}'s provider at
 * construction (the CLI hands it the wallet's signer; the dApp wallet signs in
 * browser contexts), so `execute` takes no wallet — `wallet` is accepted
 * (and ignored) only to satisfy the family-agnostic `ExecuteParams` contract.
 */
export type CantonExecuteParams<P extends object> = P & {
  /** Ignored: the signer is bound to the chain's provider. Accepted for the base `ExecuteParams` contract. */
  wallet?: unknown
  /** Acting party ID — optional on execute; defaults to the chain's active party. */
  sender?: string
}

/**
 * Canton CCT write base. Subclasses supply {@link prepare} and
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
   * Build the `JsCommands` exercise-choice payload from validated, parsed
   * params. Subclasses fetch disclosures via `chain.acsDisclosureProvider` /
   * `chain.edsDisclosureProvider` and construct the exercise command(s) +
   * `actAs` (from `params.sender`) + `disclosedContracts`.
   */
  protected abstract buildCommands(chain: CantonChain, params: Parsed): Promise<JsCommands>

  /** Run {@link prepare} and {@link buildCommands}; no signing. */
  async generate(chain: CantonChain, params: CantonGenerateParams<P>): Promise<UnsignedCantonTx> {
    const commands = await this.buildCommands(chain, this.prepare(params))
    return { family: chain.network.family, commands }
  }

  /**
   * Derives `sender` (defaulting to the chain's active party — the signer is
   * bound to the chain's provider at construction), builds the commands, and
   * submits via {@link CantonChain.submitCommands}. Returns the confirmed
   * `updateId` plus the raw ledger response for result parsing.
   */
  async execute(
    chain: CantonChain,
    params: CantonExecuteParams<P>,
  ): Promise<CantonTransactionResult> {
    const { wallet: _wallet, ...rest } = params

    const parsed = this.prepare({
      ...rest,
      sender: rest.sender ?? chain.activeParty,
    } as CantonGenerateParams<P>)
    const commands = await this.buildCommands(chain, parsed)
    let response
    try {
      response = await chain.submitCommands(commands, this.name)
    } catch (error) {
      // Not CCTTxNotConfirmedError: Canton submit-and-wait isn't safely retriable.
      if (CCIPError.isCCIPError(error)) {
        // Already committed — inspect the ledger by updateId, never retry.
        if (error instanceof CCIPTxOutcomeUnavailableError) throw error
        // Command IDs are deterministic per operation, so a duplicate means the
        // original committed — terminal, non-retryable.
        if (error.context['cantonCode'] === 'DUPLICATE_COMMAND') {
          throw new CCTTxFailedError(
            this.name,
            `commandId '${commands.commandId}' was already submitted (DUPLICATE_COMMAND) — ` +
              'the original command likely committed; inspect ledger state instead of retrying',
            { cause: error, context: { commandId: commands.commandId } },
          )
        }
        throw new CCTTxFailedError(this.name, error.message, {
          cause: error,
          isTransient: error.isTransient,
          retryAfterMs: error.retryAfterMs,
        })
      }
      throw error
    }

    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (!response.transaction) {
      throw new CCTTxFailedError(
        this.name,
        'submitted transaction response has no transaction field',
      )
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
    const created = (event as { CreatedEvent?: Record<string, unknown> }).CreatedEvent
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
    const exercised = (event as { ExercisedEvent?: Record<string, unknown> }).ExercisedEvent
    if (exercised?.['choice'] === choice && exercised['exerciseResult'] != null) {
      return exercised['exerciseResult']
    }
  }
  return null
}
