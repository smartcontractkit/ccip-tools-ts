/**
 * Cross-family CCT read contract: the read-only counterpart of `cct/operation.ts`.
 * {@link Query} wires validate → read, so params are rejected before any RPC; each chain family
 * binds it to its own `Chain` type.
 *
 * @packageDocumentation
 */

/**
 * Abstract CCT read operation. Subclasses supply {@link Query.validate} and {@link Query.read};
 * the base wires {@link Query.query}, mirroring how `Operation.generate` gates `buildUnsigned`.
 * No wallet, no calldata, no submit.
 */
export abstract class Query<Chain, Params extends object, Result> {
  /** camelCase id; matches the token-manager facade method and error context. */
  abstract readonly name: string

  /** Reject invalid params before any chain RPC. */
  protected abstract validate(params: Params): void

  /** Read and normalize chain state; runs only after {@link Query.validate} passes. */
  protected abstract read(chain: Chain, params: Params): Promise<Result>

  /** Run {@link Query.validate}, then {@link Query.read}. */
  async query(chain: Chain, params: Params): Promise<Result> {
    this.validate(params)
    return this.read(chain, params)
  }
}
