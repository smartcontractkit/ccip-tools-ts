import { CCIPError, CCIPErrorCode } from '../../errors/index.ts'
import { StaticTokenSource } from './token-source.ts'
import { type AccessToken, type AuthProvider, AuthType } from './types.ts'

/**
 * Static authentication provider.
 *
 * @packageDocumentation
 *
 * Wraps a pre-obtained JWT in a {@link StaticTokenSource} (no refresh).
 */

/**
 * Base class for static JWT providers.
 *
 * Delegates {@link token} to an internal {@link StaticTokenSource} that always
 * yields the configured JWT.
 */
abstract class StaticProviderBase implements AuthProvider {
  abstract readonly type: AuthType
  private readonly source: StaticTokenSource

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

  /** Returns the static JWT. */
  token(): Promise<AccessToken> {
    return this.source.token()
  }
}

/**
 * Static auth provider — pre-obtained JWT. Use for Canton participant
 * endpoints where you already hold a valid JWT.
 */
export class StaticProvider extends StaticProviderBase {
  readonly type: AuthType = AuthType.Static
}

/**
 * Create a static auth provider.
 *
 * @param jwt - Pre-obtained JWT token.
 * @returns A {@link StaticProvider}.
 */
export function createStaticProvider(jwt: string): StaticProvider {
  return new StaticProvider(jwt)
}
