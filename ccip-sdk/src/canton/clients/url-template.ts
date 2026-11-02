import { type CCIPErrorCode, CCIPError } from '../../errors/index.ts'

/**
 * Placeholder in URL-map values that is replaced with the resolved party ID
 * (e.g. `'https://eds.url.example.com/external/{party}'`). OpenAPI-style, matching the
 * path params used by `openapi-fetch`.
 */
export const PARTY_URL_PLACEHOLDER = '{party}'

/**
 * Resolves the base URL for a party from a `party => URL` map.
 *
 * Resolution order:
 * 1. exact entry for the party;
 * 2. the `'${PARTY_URL_PLACEHOLDER}'` wildcard, whose value is a URL template
 *    applied to any known party (e.g. DA Registry URLs embedding the party);
 * 3. the `'*'` plain wildcard (EDS: used when the party is unknown, i.e. for
 *    opaque hashed `InstanceAddress`es).
 *
 * `${PARTY_URL_PLACEHOLDER}` is substituted in whichever value matched, whenever
 * the party is known. If the matched value contains the placeholder but no party
 * is available, an error is thrown instead of producing a broken URL.
 *
 * @param urls - Map from party ID (or wildcard) to base URL.
 * @param party - Resolved party ID, or `undefined` when it cannot be determined.
 * @param opts - `code`: {@link CCIPErrorCode} for the thrown {@link CCIPError};
 * `subject`: human-readable client name used in error messages (e.g. `'EDS'`).
 * @throws {@link CCIPError} with `opts.code` when no URL resolves or the
 * placeholder cannot be substituted.
 */
export function resolvePartyUrl(
  urls: Record<string, string>,
  party: string | undefined,
  opts: { code: CCIPErrorCode; subject: string },
): string {
  const value =
    party != null && party !== ''
      ? (urls[party] ?? urls[PARTY_URL_PLACEHOLDER] ?? urls['*'])
      : urls['*']
  if (!value) {
    throw new CCIPError(
      opts.code,
      `No ${opts.subject} URL configured for party ${party || '(unknown)'}`,
      { context: { party } },
    )
  }
  if (value.includes(PARTY_URL_PLACEHOLDER)) {
    if (!party) {
      throw new CCIPError(
        opts.code,
        `${opts.subject} URL contains a ${PARTY_URL_PLACEHOLDER} placeholder but the party is unknown`,
        { context: { url: value } },
      )
    }
    return value.replaceAll(PARTY_URL_PLACEHOLDER, party)
  }
  return value
}
