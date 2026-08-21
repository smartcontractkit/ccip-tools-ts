/**
 * Cross-family CCT read contract: {@link Query} wires prepare → read, the read-only counterpart
 * of `cct/operation.ts`. Each chain family binds it to its own `Chain` type.
 *
 * @packageDocumentation
 */

/**
 * Abstract CCT read base. Subclasses supply {@link prepare} and {@link read}; no wallet, no
 * calldata, no submit.
 * @remarks Validation lives in `prepare`, not a hook of its own: a parser that converts an address
 * validates it on the way through, so splitting them would check the same field twice.
 */
export abstract class Query<Chain, Params extends object, Result, Parsed = Params> {
  /** camelCase id; matches the token-manager facade method and error context. */
  abstract readonly name: string

  /** Validate and normalize params before any chain RPC, without mutating the caller's input. */
  protected abstract prepare(params: Params): Parsed

  /** Read and normalize chain state; runs only after {@link prepare} passes. */
  protected abstract read(chain: Chain, params: Parsed): Promise<Result>

  /** Run {@link prepare} and {@link read}; no wallet. */
  async query(chain: Chain, params: Params): Promise<Result> {
    return this.read(chain, this.prepare(params))
  }
}
