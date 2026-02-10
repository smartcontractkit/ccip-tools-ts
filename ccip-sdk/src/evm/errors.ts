import {
  type BytesLike,
  type ErrorFragment,
  type EventFragment,
  type FunctionFragment,
  Result,
  dataLength,
  dataSlice,
  hexlify,
  isBytesLike,
  isHexString,
} from 'ethers'

import { defaultAbiCoder, interfaces } from './const.ts'
import { decodeExtraArgs } from '../extra-args.ts'
import { ChainFamily } from '../types.ts'

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
 * If data is provided, it will be parsed with the fragment's inputs. For events, only the
 * non-indexed arguments are parsed.
 *
 * @param selector - error, function or event selector
 * @param data - data to parse as fragment's inputs
 * @returns Fragment and contract name, if found, and parsed data if possible
 **/
export function parseWithFragment(
  selector: string,
  data?: BytesLike,
):
  | readonly [
      fragment: ErrorFragment | FunctionFragment | EventFragment,
      contractName: string,
      parsed?: Result,
    ]
  | undefined {
  if (!dataLength(data ?? '0x') && isBytesLike(selector)) {
    const len = dataLength(selector)
    if (len >= 4 && len !== 32) {
      data = dataSlice(selector, 4)
      selector = dataSlice(selector, 0, 4)
    }
  }
  let res: readonly [ErrorFragment | FunctionFragment | EventFragment, string] | undefined
  for (const [name, iface] of Object.entries(interfaces)) {
    try {
      const error = iface.getError(selector)
      if (error) {
        res = [error, name] as const
        break
      }
    } catch (_) {
      // test all abis
    }
    try {
      const func = iface.getFunction(selector)
      if (func) {
        res = [func, name] as const
        break
      }
    } catch (_) {
      // test all abis
    }
    try {
      const event = iface.getEvent(selector)
      if (event) {
        res = [event, name] as const
        break
      }
    } catch (_) {
      // test all abis
    }
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
      // eslint-disable-next-line no-restricted-syntax
      if (keys.length > 0 && keys.every((k) => k.startsWith('_'))) throw new Error('not an obj')
      kv = Object.entries(obj).map(([k, v]) => [j(key, k), v])
    } catch (_) {
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
  key = desc.split(' ')[0]!
  const res = [[key, desc.substring(key.length + 1)]] as ReturnType<typeof recursiveParseError>
  if (!args) return res
  if (['ReceiverError', 'TokenHandlingError'].includes(fragment.name) && args.err === '0x') {
    res.push([`${key}.err`, '0x [possibly out-of-gas or abi.decode error]'])
    return res
  }
  res.push(...recursiveParseError('', args))
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
    const parsed = recursiveParseError('', data)
    if (parsed.length === 1 && parsed[0]![1] === data) return
    return Object.fromEntries(parsed)
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
  if (!shortMessage || !transaction?.data) return

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
