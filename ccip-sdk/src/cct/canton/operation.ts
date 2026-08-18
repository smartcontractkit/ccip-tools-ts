/**
 * Canton {@link Operation} lifecycle: validate → parse → build unsigned
 * `JsCommands` → submit via {@link CantonChain.submitCommands}.
 *
 * Canton CCT operations build the same `JsCommands` exercise-choice payloads
 * the core `CantonChain.sendMessage`/`execute` paths already submit, so
 * `execute` reuses {@link CantonChain.submitCommands} (prepare → sign →
 * execute when a `signer` is present, direct submit otherwise) unchanged.
 *
 * @packageDocumentation
 */

import { CCIPWalletInvalidError } from '../../errors/index.ts'
import type { CantonChain } from '../../canton/index.ts'
import type {
  CantonWallet,
  UnsignedCantonTx,
} from '../../canton/types.ts'
import type { JsCommands } from '../../canton/client/index.ts'
import type { TransactionResult } from '../operation.ts'
import { Operation } from '../operation.ts'
import type { CantonTransactionResult } from './types.ts'

/** Canton execute params: an op's own params plus the signing `wallet`. */
export type CantonExecuteParams<P extends object> = P & {
  /** Canton wallet identifying the acting party (and optional external signer). */
  wallet: CantonWallet
}

/**
 * Canton CCT write base. Subclasses supply {@link parse} and
 * {@link buildCommands}.
 *
 * `generate` returns an {@link UnsignedCantonTx} (a `JsCommands` ready for
 * interactive submission or external signing). `execute` signs and submits via
 * {@link CantonChain.submitCommands} and returns the confirmed `updateId`.
 */
export abstract class CantonOperation<
  P extends object,
  Parsed = CantonExecuteParams<P>,
> extends Operation<CantonChain, CantonExecuteParams<P>, UnsignedCantonTx, CantonTransactionResult> {
  /**
   * Optional validation hook required by the shared CCT operation contract.
   *
   * The default performs no validation. Prefer {@link parse} for Canton
   * operation validation and normalization; override this only when parsing
   * is unnecessary.
   */
  protected validate(_params: CantonExecuteParams<P>): void {}

  /**
   * Normalize params without mutating the caller's input.
   *
   * The default returns params unchanged. Override whenever `Parsed` differs
   * from `CantonExecuteParams<P>`, e.g. to parse party IDs / instrument IDs
   * into validated forms or apply defaults.
   */
  protected parse(params: CantonExecuteParams<P>): Parsed {
    return params as Parsed
  }

  /** Validates and normalizes params for generation or execution. */
  protected prepare(params: CantonExecuteParams<P>): Parsed {
    this.validate(params)
    return this.parse(params)
  }

  /**
   * Build the `JsCommands` exercise-choice payload from validated, parsed
   * params. Subclasses fetch disclosures via
   * `chain.acsDisclosureProvider` / `chain.edsDisclosureProvider` and construct
   * the exercise command(s) + `actAs` + `disclosedContracts`.
   */
  protected abstract buildCommands(
    chain: CantonChain,
    params: Parsed,
  ): Promise<JsCommands>

  /** Run {@link prepare} and {@link buildCommands}; no signing. */
  async generate(
    chain: CantonChain,
    params: CantonExecuteParams<P>,
  ): Promise<UnsignedCantonTx> {
    const commands = await this.buildCommands(chain, this.prepare(params))
    return { family: chain.network.family, commands }
  }

  /**
   * Validates the wallet, builds the commands, and submits via
   * {@link CantonChain.submitCommands}. Returns the confirmed `updateId` plus
   * the raw ledger response for result parsing.
   */
  async execute(
    chain: CantonChain,
    params: CantonExecuteParams<P>,
  ): Promise<CantonTransactionResult> {
    const { wallet, ...rest } = params
    if (!wallet?.party) throw new CCIPWalletInvalidError(wallet)

    const parsed = this.prepare({ ...rest, wallet } as CantonExecuteParams<P>)
    const commands = await this.buildCommands(chain, parsed)
    const response = await chain.submitCommands(commands, wallet.signer)

    const txRecord = response.transaction as Record<string, unknown>
    const updateId: string =
      (typeof txRecord.update_id === 'string' ? txRecord.update_id : null) ??
      (typeof txRecord.updateId === 'string' ? txRecord.updateId : '')

    chain.logger.debug(`${this.name}: submitted, updateId=${updateId}`)
    return { hash: updateId, response }
  }
}
