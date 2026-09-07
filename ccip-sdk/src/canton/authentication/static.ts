import { CCIPError, CCIPErrorCode } from '../../errors/index.ts'
import { type AccessToken, type AuthProvider, AuthType } from './types.ts'

/**
 * Static authentication provider.
 *
 * @packageDocumentation
 *
 * Wraps a pre-obtained JWT (no refresh). The `token()` method is a plain async
 * function that always returns the same JWT.
 */

/**
 * Base class for static JWT providers.
 *
 * Delegates {@link token} to a simple async function that always yields the
 * configured JWT.
 */
abstract class StaticProviderBase implements AuthProvider {
  abstract readonly type: AuthType
  private readonly tokenValue: AccessToken

  /** Creates a new static provider wrapping the given JWT. */
  constructor(jwt: string) {
    if (!jwt || !jwt.trim()) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_AUTH_ERROR,
        `${this.constructor.name} requires a non-empty JWT token`,
      )
    }
    this.tokenValue = { accessToken: jwt.trim() }
  }

  /** Returns the static JWT. */
  token(): Promise<AccessToken> {
    return Promise.resolve(this.tokenValue)
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
