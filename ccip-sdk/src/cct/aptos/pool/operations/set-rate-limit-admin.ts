/**
 * Aptos TokenPool `setRateLimitAdmin` operation.
 *
 * **Not supported on Aptos** — rate limiting is managed directly by the pool
 * owner, so there is no separate rate-limit-admin role. Both {@link generate} and
 * {@link execute} reject with {@link CCIPMethodUnsupportedError}.
 *
 * @packageDocumentation
 */

import type { AptosChain } from '../../../../aptos/index.ts'
import type { UnsignedAptosTx } from '../../../../aptos/types.ts'
import { CCIPMethodUnsupportedError } from '../../../../errors/index.ts'
import type { TransactionHash } from '../../../operation.ts'
import {
  type AptosExecuteParams,
  type AptosGenerateParams,
  AptosOperation,
} from '../../operation.ts'

/** Parameters shared by Aptos TokenPool `setRateLimitAdmin` generation and execution. */
type SetRateLimitAdminParams = {
  /** Local pool object address (Aptos hex). */
  poolAddress: string
  /** New rate-limit admin address. */
  rateLimitAdmin: string
}

/** Parameters for unsigned Aptos TokenPool `setRateLimitAdmin` generation. */
export type GenerateSetRateLimitAdminParams = AptosGenerateParams<SetRateLimitAdminParams>

/** Unsigned Aptos TokenPool `setRateLimitAdmin` result. */
export type GenerateSetRateLimitAdminResult = UnsignedAptosTx

/** Parameters for executing Aptos TokenPool `setRateLimitAdmin`. */
export type ExecuteSetRateLimitAdminParams = AptosExecuteParams<SetRateLimitAdminParams>

/** Result of executing Aptos TokenPool `setRateLimitAdmin`. */
export type ExecuteSetRateLimitAdminResult = TransactionHash

/** Aptos TokenPool `setRateLimitAdmin` operation — unsupported on Aptos. */
export class SetRateLimitAdmin extends AptosOperation<SetRateLimitAdminParams> {
  readonly name = 'setRateLimitAdmin'

  /** Always throws — rate limiting is managed directly by the pool owner on Aptos. */
  protected validate(_params: GenerateSetRateLimitAdminParams): void {
    throw new CCIPMethodUnsupportedError('AptosTokenManager', this.name)
  }

  /** Unreachable — {@link validate} always throws first. */
  protected buildUnsigned(
    _chain: AptosChain,
    _params: GenerateSetRateLimitAdminParams,
  ): Promise<UnsignedAptosTx> {
    throw new CCIPMethodUnsupportedError('AptosTokenManager', this.name)
  }
}
