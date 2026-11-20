import {
  type BytesLike,
  type EventFragment,
  type FunctionFragment,
  type Interface,
  ErrorFragment,
  Fragment,
  Result,
  dataLength,
  dataSlice,
  hexlify,
  isBytesLike,
  isHexString,
} from 'ethers'

import { decodeExtraArgs } from '../extra-args.ts'
import { decodeMessageV1 } from '../messages.ts'
import { ChainFamily } from '../networks.ts'
import { defaultAbiCoder, getPoolErrorInterfaces, interfaces } from './const.ts'

type FragmentMatch = readonly [
  fragment: ErrorFragment | FunctionFragment | EventFragment,
  contractName: string,
]
type Interfaces = Readonly<Record<string, Interface>>
type HexIndex = ReadonlyMap<string, FragmentMatch>

// ethers resolves these errors in each Interface, before the errors of its ABI
const builtinErrors = ['Error(string)', 'Panic(uint256)'].map((sig) => ErrorFragment.from(sig))

let coreHexIndex: HexIndex | undefined
let poolHexIndex: HexIndex | undefined

/**
 * Index the fragments by 4-byte selector (errors, functions) and by 32-byte topicHash (events).
 * `Interface.getError/getFunction/getEvent` hash each fragment again on each hex lookup.
 * The first fragment of a key wins, in the order of their scan: interface by interface, and
 * errors before functions in each interface.
 */
function buildHexIndex(ifaces: Interfaces): HexIndex {
  const index = new Map<string, FragmentMatch>()
  for (const [name, iface] of Object.entries(ifaces)) {
    const fragments = [
      ...builtinErrors,
      ...iface.fragments.filter((f) => Fragment.isError(f)),
      ...iface.fragments.filter((f) => Fragment.isFunction(f)),
      ...iface.fragments.filter((f) => Fragment.isEvent(f)),
    ]
    for (const fragment of fragments) {
      const key = Fragment.isEvent(fragment) ? fragment.topicHash : fragment.selector
      if (!index.has(key)) index.set(key, [fragment, name])
    }
  }
  return index
}

function findHexFragment(selector: string, index: HexIndex): FragmentMatch | undefined {
  const topic = selector.slice(0, 66).toLowerCase()
  // a full topicHash match is exact, thus it wins over a 4-byte selector match
  return index.get(topic) ?? index.get(topic.slice(0, 10))
}

function findNamedFragment(key: string, ifaces: Interfaces): FragmentMatch | undefined {
  for (const [name, iface] of Object.entries(ifaces)) {
    for (const getFragment of ['getError', 'getFunction', 'getEvent'] as const) {
      try {
        const fragment = iface[getFragment](key)
        if (fragment) return [fragment, name]
      } catch (_) {
        // test all abis
      }
    }
  }
}

/**
 * Get error data from an error object, if possible
 * @param err - error object
 * @returns error data if found
 **/
export function getErrorData(err: unknown): string | undefined {
  if (!err || typeof err != 'object') return
  if ('data' in err && err.data && isHexString(err.data)) return err.data
  if (
    !('info' in err) ||
    !err.info ||
    typeof err.info != 'object' ||
    !('error' in err.info) ||
    !err.info.error ||
    typeof err.info.error != 'object' ||
    !('data' in err.info.error) ||
    typeof err.info.error.data !== 'string' ||
    !err.info.error.data
  )
    return
  const match = err.info.error.data.match(/\b0x[0-9a-fA-F]+\b/)
  if (!match) return
  return match[0]
}

/**
 * Try to parse selector and data with any known ABI
 * selector must be either:
 * - Error, Function or Event name or signature
 * - 4-byte for Error or Function selector (first 4B of its keccak256(signature))
 * - 32-byte for Event topicHash (keccak256(signature))
 * A 32-byte topicHash match wins over a 4-byte selector match.
 * If data is provided, it will be parsed with the fragment's inputs. For events, only the
 * non-indexed arguments are parsed. Without data, the bytes after a hex selector are the data.
 *
 * @param selector - error, function or event selector
 * @param data - data to parse as fragment's inputs
 * @returns Fragment and contract name, if found, and parsed data if possible
 **/
export function parseWithFragment(
  selector: string,
  data?: BytesLike,
): readonly [...FragmentMatch, parsed?: Result] | undefined {
  let res: FragmentMatch | undefined
  const isHex = isHexString(selector)
  // the pool interfaces have only errors: they add revert-decoding coverage after a miss in the
  // main interfaces, and are lazily built
  if (!isHex) {
    res =
      findNamedFragment(selector, interfaces) ??
      findNamedFragment(selector, getPoolErrorInterfaces())
  } else if (selector.length >= 10 && selector.length % 2 === 0) {
    res =
      findHexFragment(selector, (coreHexIndex ??= buildHexIndex(interfaces))) ??
      findHexFragment(selector, (poolHexIndex ??= buildHexIndex(getPoolErrorInterfaces())))
  }
  if (res && isHex && !data) {
    const keyLength = Fragment.isEvent(res[0]) ? 66 : 10
    if (selector.length > keyLength) data = '0x' + selector.slice(keyLength)
  }
  if (res && data) {
    let parsed
    const [fragment] = res
    try {
      parsed = defaultAbiCoder.decode(
        fragment.inputs.filter(({ indexed }) => !indexed),
        data,
      )
    } catch (_) {
      // ignore
    }
    if (parsed) return [...res, parsed]
  }
  return res
}

// join truthy property names, separated by a dot
function j(...args: string[]): string {
  return args.reduce((acc, v) => (!v ? acc : acc ? acc + (v.match(/^\w/) ? '.' : '') + v : v), '')
}

/**
 * Recursively parse error data, returning an array of key/value pairs, where key is the path to
 * error, and error maybe an error description or format, or the raw data if not parsable.
 *
 * @param key - key to use for the error data
 * @param data - error bytearray data to parse
 * @returns array of key/value pairs
 **/
export function recursiveParseError(
  key: string,
  data: unknown,
): (readonly [key: string, error: unknown])[] {
  if (data instanceof Result) {
    if (data.length === 0) return key ? [[key, data.toArray()]] : []
    let kv: ReturnType<typeof recursiveParseError>
    try {
      const obj = data.toObject()
      const keys = Object.keys(obj)
      if (keys.length > 0 && keys.every((k) => k.startsWith('_'))) {
        kv = data.toArray().map((v, i) => [j(key, `[${i}]`), v])
      } else {
        kv = Object.entries(obj).map(([k, v]) => [j(key, k), v])
      }
    } catch {
      kv = data.toArray().map((v, i) => [j(key, `[${i}]`), v])
    }
    return kv.reduce(
      (acc, [k, v]) => [...acc, ...recursiveParseError(k, v)],
      [] as ReturnType<typeof recursiveParseError>,
    )
  }
  if (!isBytesLike(data) || [0, 20].includes(dataLength(data))) {
    return [[key, data]]
  }
  try {
    const parsed = decodeExtraArgs(data, ChainFamily.EVM)
    if (parsed) {
      const { _tag, ...rest } = parsed
      return [[key, _tag], ...Object.entries(rest).map(([k, v]) => [j(key, k), v] as const)]
    }
  } catch (_) {
    // pass
  }
  const parsed = parseWithFragment(hexlify(data))
  if (!parsed) return [[key, data]]
  const [fragment, _, args] = parsed
  const desc = fragment.format('full')
  const key_ = j(key, desc.split(' ')[0]!)
  const res = [[key_, desc.substring(desc.indexOf(' ') + 1)]] as ReturnType<
    typeof recursiveParseError
  >
  if (!args) return res
  res.push(...recursiveParseError(key, args))
  return res
}

/**
 * Parses error data and transaction responses to extract human-readable info.
 * @param data - Raw error data or transaction response.
 * @returns Parsed error information or undefined.
 */
export function parseData(data: unknown): Record<string, unknown> | undefined {
  if (!data) return
  if (isHexString(data)) {
    let parsed
    try {
      parsed = decodeMessageV1(data)
      return parsed
    } catch {
      parsed = recursiveParseError('', data)
      if (parsed.length === 1 && parsed[0]![1] === data) return
      // like Object.fromEntries, but on duplicated keys, add a space to first occurrence, to avoid overwriting and keep all values
      return parsed.reduceRight(
        (acc, [k, v]) => ({ ...{ [k && k in acc ? k + ' ' : k]: v }, ...acc }),
        {},
      )
    }
  }
  if (typeof data !== 'object') return
  // ethers tx/simulation/call errors
  const err_ = data as {
    shortMessage?: string
    message?: string
    transaction?: { to: string; data: string }
  }
  const shortMessage = err_.shortMessage || err_.message
  const transaction = err_.transaction
  if (!shortMessage) return
  if (!transaction?.data) {
    // No transaction calldata context (e.g. error from contract.fn.populateTransaction);
    // still try to surface decoded revert data if available.
    const errorData = getErrorData(data)
    if (!errorData) return
    const reason = Object.fromEntries(recursiveParseError('revert', errorData))
    if (!Object.keys(reason).length) return
    return { error: shortMessage, ...reason }
  }

  let method, invocation
  const invocation_ = (data as { invocation: { method: string; args: Result } | null }).invocation
  if (invocation_) {
    ;({ method, ...invocation } = invocation_)
  } else {
    method = dataSlice(transaction.data, 0, 4)
    const func = parseWithFragment(method)?.[0]
    if (func) method = func.name
  }
  let reason
  const errorData = getErrorData(data)
  if (errorData) reason = Object.fromEntries(recursiveParseError('revert', errorData))
  return {
    method,
    error: shortMessage,
    ...reason,
    call: { ...transaction, ...invocation },
  }
}
