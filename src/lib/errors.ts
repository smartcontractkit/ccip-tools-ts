import {
  type BytesLike,
  type ErrorFragment,
  type EventFragment,
  type FunctionFragment,
  type InterfaceAbi,
  type Result,
  Interface,
  dataLength,
  dataSlice,
  isBytesLike,
  isHexString,
} from 'ethers'

import Token from '../abi/BurnMintERC677Token.ts'
import BurnMintTokenPool from '../abi/BurnMintTokenPool_1_5_1.ts'
import FeeQuoter from '../abi/FeeQuoter_1_6.ts'
import LockReleaseTokenPool from '../abi/LockReleaseTokenPool_1_5_1.ts'
import Router from '../abi/Router.ts'
import TokenAdminRegistry from '../abi/TokenAdminRegistry_1_5.ts'
import { CCIP_ABIs, defaultAbiCoder } from './types.ts'
import { lazyCached } from './utils.ts'

const ifaces: Record<string, Interface> = {
  Router: lazyCached('Interface Router', () => new Interface(Router)),
  Token: lazyCached(`Interface Token`, () => new Interface(Token)),
  TokenAdminRegistry: lazyCached(
    `Interface TokenAdminRegistry 1.5`,
    () => new Interface(TokenAdminRegistry),
  ),
  FeeQuoter: lazyCached(`Interface FeeQuoter 1.6`, () => new Interface(FeeQuoter)),
  BurnMintTokenPool: lazyCached(
    `Interface BurnMintTokenPool 1.5.1`,
    () => new Interface(BurnMintTokenPool),
  ),
  LockReleaseTokenPool: lazyCached(
    `Interface LockReleaseTokenPool 1.5.1`,
    () => new Interface(LockReleaseTokenPool),
  ),
  ...Object.fromEntries(
    Object.entries(CCIP_ABIs)
      .map(([type_, obj]) =>
        Object.entries(obj).map(
          ([version, abi]) =>
            [
              `${type_}_${version}`,
              lazyCached(`Interface ${type_} ${version}`, () => new Interface(abi as InterfaceAbi)),
            ] as const,
        ),
      )
      .flat(1),
  ),
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
  for (const [name, iface] of Object.entries(ifaces)) {
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
  data: string,
): (readonly [key: string, error: unknown])[] {
  if (!isBytesLike(data) || [0, 20, 32].includes(dataLength(data))) {
    return [[key, data]]
  }
  const parsed = parseWithFragment(data)
  if (!parsed?.[2]) return [[key, data]]
  const [fragment, contractName, args] = parsed
  const res = [
    [key, `${contractName.replace(/_\d\.\d.*$/, '')} ${fragment.format('full')}`],
  ] as ReturnType<typeof recursiveParseError>
  if (fragment.name === 'ReceiverError' && args.err === '0x') {
    res.push([`${key}.err`, '0x [possibly out-of-gas or abi.decode error]'])
    return res
  }
  try {
    const argsObj = args.toObject()
    if (!(Object.keys(argsObj)[0] ?? '').match(/^[a-z]/)) throw new Error('Not an object')
    for (const [k, v] of Object.entries(argsObj)) {
      if (isHexString(v)) {
        res.push(...recursiveParseError(`${key}.${k}`, v))
      } else {
        res.push([`${key}.${k}`, v])
      }
    }
  } catch (_) {
    const argsArr = args.toArray()
    for (let i = 0; i < argsArr.length; i++) {
      const v: unknown = argsArr[i]
      if (isHexString(v)) {
        res.push(...recursiveParseError(`${key}[${i}]`, v))
      } else {
        res.push([`${key}[${i}]`, v])
      }
    }
  }
  return res
}
