import { Buffer } from 'buffer'

import bs58 from 'bs58'
import { type BytesLike, decodeBase64, getBytes, id as keccak256Utf8 } from 'ethers'

/**
 * Pure byte/JSON/address codecs used by both `utils.ts` and the
 * `errors/index.ts` tree.
 *
 * Extracted as a leaf module (no `errors/` or `chain.ts` imports) so that
 * `errors/specialized.ts` can use these helpers without creating a runtime
 * cycle through `utils.ts` (which re-exports fetch helpers that pull in
 * `errors/`). Mirrors the existing `shared/constants.ts` / `shared/bcs-codecs.ts`
 * pattern.
 */

function createUncircularReplacer() {
  const holderStack: object[] = []
  const ancestorStack: object[] = []
  const originals = new WeakMap<object, object>()

  const uncircularReplacer = function (this: unknown, _key: string, value: unknown) {
    // bigints pass through untouched; serialization to bare JSON numbers is
    // handled by stringifyExtended below.
    const replaced = value
    if (typeof replaced !== 'object' || replaced == null) return replaced

    while (holderStack.length > 0 && holderStack.at(-1) !== this) {
      holderStack.pop()
      ancestorStack.pop()
    }

    if (ancestorStack.includes(replaced)) return undefined

    let returned = replaced
    if (Array.isArray(replaced)) {
      const filtered = replaced.filter(
        (item) =>
          typeof item !== 'object' ||
          item === null ||
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          (item !== replaced && !ancestorStack.includes(originals.get(item) ?? item)),
      )
      if (filtered.length !== replaced.length) {
        originals.set(filtered, replaced)
        returned = filtered
      }
    }

    holderStack.push(returned)
    ancestorStack.push(replaced)
    return returned
  }
  return uncircularReplacer
}

// Private-use sentinel: JSON.stringify can't emit a bigint, so bigints are first
// tagged as a string, then the quotes+tag are stripped to leave a bare JSON
// number.  is in the Unicode private-use area and is left unescaped by
// JSON.stringify, so it never collides with real (hex/decimal) string data.
const INT_TAG = 'int:'
const INT_TAG_RE = new RegExp(`"${INT_TAG}(-?\\d+(?:.0)?)"`, 'g')

/**
 * JSON.stringify that drops circular references (via createUncircularReplacer)
 * and serializes bigints as bare JSON numbers, preserving full precision so a
 * uint64/uint256 survives the round-trip to Go without becoming a decimal string.
 * plain `number` integers are also tagged with `.0` suffix, to differentiate them from `bigint`s.
 * @example
 * ```typescript
 * jsonStringify({ a: 1n, b: 2, c: { d: 3n } }) // '{"a":1,"b":2.0,"c":{"d":3}}'
 * yaml.parse('{"a":1,"b":2.0,"c":{"d":3}}', { intAsBigInt: true }) // { a: 1n, b: 2, c: { d: 3n } }
 * ```
 */
export function jsonStringify(value: unknown, space?: string | number): string {
  if (value == null) return 'null'
  const uncircular = createUncircularReplacer()
  const json = JSON.stringify(
    value,
    function (this: unknown, key: string, val: unknown) {
      const replaced = uncircular.call(this, key, val)
      return typeof replaced === 'bigint'
        ? INT_TAG + replaced.toString()
        : typeof replaced === 'number' && Number.isSafeInteger(replaced)
          ? INT_TAG + replaced.toString() + '.0' // use .0 suffix to distinguish plain numbers
          : replaced
    },
    space,
  )
  // JSON.stringify is typed `string` but returns undefined for undefined input.
  return json.replace(INT_TAG_RE, '$1')
}

/** Strip optional `0x` prefix and lowercase for stable hex string comparison. */
export function normalizeHex(value: string): string {
  const trimmed = value.trim()
  return (trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed).toLowerCase()
}

/** keccak256(utf8 string) as normalized hex (no `0x`). Used for Canton party / InstanceAddress hashes. */
export function hashedUtf8Hex(value: string): string {
  return normalizeHex(keccak256Utf8(value))
}

/** Daml party ID: `hint::1220<64-hex-fingerprint>` (not a 3-part instrument id). */
export function isCantonPartyId(address: string): boolean {
  return /^[\w.-]+::1220[0-9a-fA-F]{64}$/.test(address)
}

/**
 * Extracts address bytes, handling both hex and Base58 formats.
 * @param address - Address in hex or Base58 format.
 * @returns Address bytes as Uint8Array.
 */
export function getAddressBytes(address: BytesLike | readonly number[]): Uint8Array {
  let bytes
  if (address instanceof Uint8Array) {
    bytes = address
  } else if (Array.isArray(address)) {
    bytes = new Uint8Array(address)
  } else if (
    typeof address === 'string' &&
    address.match(/^((0x[0-9a-f]*)|[0-9a-f]{40,})(::.*)?$/i)
  ) {
    address = address.split('::')[0]! // discard possible Aptos/Sui module suffix
    // supports with or without (long>=20B) 0x-prefix, odd or even length
    bytes = getBytes(
      address.length % 2
        ? '0x0' + (address.match(/^0x/i) ? address.slice(2) : address)
        : !address.match(/^0x/i)
          ? '0x' + address
          : address,
    )
    if (bytes.length < 32 && bytes.length !== 20) {
      const padded = new Uint8Array(32)
      padded.set(bytes, 32 - bytes.length)
      bytes = padded
    }
  } else if (typeof address === 'string' && isCantonPartyId(address)) {
    // Canton CCIP receivers use keccak256(partyId) as a 32-byte address (see HashedPartyFromString in chainlink-canton).
    bytes = getBytes(`0x${hashedUtf8Hex(address)}`)
  } else if (typeof address === 'string' && /^-?\d+:[0-9a-f]{64}$/i.test(address)) {
    // TON raw format: "workchain:hash" → 36-byte CCIP format (4-byte BE workchain + 32-byte hash)
    const [workchain, hash] = address.split(':')
    const buf = new Uint8Array(36)
    const view = new DataView(buf.buffer)
    view.setInt32(0, parseInt(workchain!, 10), false) // big-endian
    buf.set(getBytes('0x' + hash), 4)
    bytes = buf
  } else {
    try {
      const bytes_ = bs58.decode(address as string)
      if (bytes_.length % 32 === 0) bytes = bytes_
    } catch (_) {
      // pass
    }
    if (!bytes) bytes = decodeBase64(address as string)
  }
  return bytes
}

/**
 * Encodes remote/alien addresses for Any SRC
 *
 * Addresses less than 32 bytes (EVM 20B, Aptos/Solana/Sui 32B) are zero-padded to 32 bytes
 * Addresses greater than 32 bytes (e.g., TON 4+32=36B) are used as raw bytes without padding
 */
export function encodeAddressToAny(address: BytesLike): Buffer {
  const bytes = getAddressBytes(address)
  return bytes.length < 32
    ? Buffer.concat([Buffer.alloc(32 - bytes.length), Buffer.from(bytes)]) // pad to 32 bytes
    : Buffer.from(bytes)
}

// barebones `node:util` backfill, if needed
const util =
  'util' in globalThis
    ? (
        globalThis as unknown as {
          util: {
            inspect: ((v: unknown) => string) & {
              custom: symbol
              defaultOptions: Record<string, unknown>
            }
          }
        }
      ).util
    : {
        inspect: Object.assign((v: unknown) => JSON.stringify(v), {
          custom: Symbol('custom'),
          defaultOptions: { depth: 2 },
        }),
      }
export { util }
