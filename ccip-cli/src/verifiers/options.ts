/**
 * Yargs options for the CCV verification sources that `show` and `manual-exec` hand to the SDK
 * (`Chain.getVerifications` / `Chain.execute`), which decides when to use them.
 *
 * @packageDocumentation
 */
import { CCIPArgumentInvalidError } from '@chainlink/ccip-sdk/src/index.ts'
import { isHexString } from 'ethers'

/** Split repeated and comma-separated array entries into trimmed, non-empty values. */
const entries = (values: unknown[], flag: string): string[] =>
  values.flatMap((value) => {
    if (typeof value !== 'string') {
      throw new CCIPArgumentInvalidError(flag, `expects strings, got ${typeof value}`)
    }
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  })

/** `--verifier`: extra verifier endpoints to read CCV attestations from. */
export const verifiersOption = {
  verifiers: {
    alias: 'verifier',
    type: 'array',
    string: true,
    describe:
      'Verifier endpoint URLs to read CCV attestations from directly, when the CCIP API and indexers ' +
      "don't cover the destination's CCV policy (e.g. a CCV no indexer has onboarded); tried in " +
      'order until covered. https:// or http:// for a grpc-web proxy; grpc:// (TLS, alias grpcs://) ' +
      'or grpc+plaintext:// for a native gRPC aggregator. Repeatable or comma-separated.',
    coerce: (values: unknown[]) =>
      entries(values, 'verifier').map((url) => {
        if (!URL.canParse(url))
          throw new CCIPArgumentInvalidError('verifier', `expects endpoint URLs, got "${url}"`)
        return url
      }),
  },
} as const

/** `--ccv-data`: attestations obtained out of band. */
export const ccvDataOption = {
  'ccv-data': {
    type: 'array',
    string: true,
    describe:
      'CCV attestations obtained out of band, as <dest-ccv-address>=<0x-hex>; they win over fetched ' +
      "ones. Validity is still decided onchain by the CCV's verifyMessage, so wrong bytes can only " +
      'waste gas. Repeatable or comma-separated.',
    coerce: (values: unknown[]): Record<string, string> =>
      Object.fromEntries(
        entries(values, 'ccv-data').map((entry) => {
          const sep = entry.indexOf('=')
          const [ccv, data] = [entry.slice(0, sep).trim(), entry.slice(sep + 1).trim()]
          if (sep < 1 || !ccv || !isHexString(data) || data.length <= 2 || data.length % 2) {
            throw new CCIPArgumentInvalidError(
              'ccv-data',
              `expects <dest-ccv-address>=<non-empty 0x-hex>, got "${entry}"`,
            )
          }
          return [ccv, data]
        }),
      ),
  },
} as const
