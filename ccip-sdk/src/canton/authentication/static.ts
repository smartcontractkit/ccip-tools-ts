import { StaticTokenSource } from './token-source.ts'
import { type AuthProvider, type TokenSource, AuthType } from './types.ts'
import { CCIPError, CCIPErrorCode } from '../../errors/index.ts'

/**
 * Static / insecure-static authentication providers.
 *
 * @packageDocumentation
 *
 * These wrap a pre-obtained JWT in a {@link StaticTokenSource} (no refresh),
 * mirroring the Go `authentication.NewStaticProvider` /
 * `authentication.NewInsecureStaticProvider`.
 *
 * The TLS-vs-insecure distinction in the Go providers only affects gRPC
 * transport credentials; the TS SDK talks to the Canton JSON Ledger API over
 * HTTP/2 where TLS is negotiated by the runtime, so both variants collapse to
 * the same token-source implementation here. The `type` field is preserved on
 * the provider so callers can distinguish them for logging/validation.
 */

/**
 * Base class for static JWT providers.
 *
 * Returns a {@link StaticTokenSource} that always yields the configured JWT.
 */
abstract class StaticProviderBase implements AuthProvider {
  abstract readonly type: AuthType
  private readonly source: TokenSource

  /** Creates a new static provider wrapping the given JWT. */
  constructor(jwt: string) {
    if (!jwt || !jwt.trim()) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_AUTH_ERROR,
        `${this.constructor.name} requires a non-empty JWT token`,
      )
    }
    this.source = new StaticTokenSource({ accessToken: jwt.trim() })
  }

  /** Returns the static token source. */
  tokenSource(): TokenSource {
    return this.source
  }
}

/**
 * Static auth provider — pre-obtained JWT with TLS transport security.
 *
 * Mirrors Go `authentication.NewStaticProvider`. Use for remote/production
 * Canton participant endpoints.
 */
export class StaticProvider extends StaticProviderBase {
  readonly type: AuthType = AuthType.Static
}

/**
 * Insecure static auth provider — pre-obtained JWT with no TLS.
 *
 * Mirrors Go `authentication.NewInsecureStaticProvider`. Use for local devnet
 * / testing where TLS is not configured.
 */
export class InsecureStaticProvider extends StaticProviderBase {
  readonly type: AuthType = AuthType.InsecureStatic
}

/**
 * Create a static auth provider (TLS transport).
 *
 * @param jwt - Pre-obtained JWT token.
 * @returns A {@link StaticProvider}.
 */
export function createStaticProvider(jwt: string): StaticProvider {
  return new StaticProvider(jwt)
}

/**
 * Create an insecure static auth provider (no TLS, local devnet).
 *
 * @param jwt - Pre-obtained JWT token.
 * @returns An {@link InsecureStaticProvider}.
 */
export function createInsecureStaticProvider(jwt: string): InsecureStaticProvider {
  return new InsecureStaticProvider(jwt)
}
