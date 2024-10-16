import {
  type BytesLike,
  type ErrorDescription,
  type EventFragment,
  type FunctionFragment,
  type InterfaceAbi,
  type Result,
  Interface,
  isBytesLike,
} from 'ethers'

import TokenABI from '../abi/BurnMintERC677Token.js'
import BurnMintTokenPool_1_5 from '../abi/BurnMintTokenPool_1_5.js'
import LockReleaseTokenPool_1_5 from '../abi/LockReleaseTokenPool_1_5.js'
import Router from '../abi/Router.js'
import { CCIPVersion_1_5, CCIP_ABIs, defaultAbiCoder } from './types.js'
import { lazyCached } from './utils.js'

const ifaces: Record<string, Interface> = {
  Router: lazyCached('Interface Router', () => new Interface(Router)),
  Token: lazyCached(`Interface Token`, () => new Interface(TokenABI)),
  'BurnMintTokenPool_1.5.0': lazyCached(
    `Interface BurnMintTokenPool ${CCIPVersion_1_5}`,
    () => new Interface(BurnMintTokenPool_1_5),
  ),
  'LockReleaseTokenPool_1.5.0': lazyCached(
    `Interface LockReleaseTokenPool ${CCIPVersion_1_5}`,
    () => new Interface(LockReleaseTokenPool_1_5),
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
 * Parse error data from revert call data, if possible, from our supported ABIs
 * @param data - error data from a revert call
 * @returns ErrorDescription if found
 **/
export function parseErrorData(data: BytesLike): [ErrorDescription, string] | undefined {
  for (const [name, iface] of Object.entries(ifaces)) {
    try {
      const parsed = iface.parseError(data)
      if (parsed) return [parsed, name]
    } catch (_) {
      // test all abis
    }
  }
}

/**
 * Get function fragment by selector from our supported ABIs
 * @param selector - function selector
 * @returns FunctionFragment if found
 **/
export function getFunctionBySelector(selector: string): [FunctionFragment, string] | undefined {
  for (const [name, iface] of Object.entries(ifaces)) {
    try {
      const parsed = iface.getFunction(selector)
      if (parsed) return [parsed, name]
    } catch (_) {
      // test all abis
    }
  }
}

/**
 * Get error data from an error object, if possible
 * @param err - error object
 * @returns error data if found
 **/
export function getErrorData(err: unknown): BytesLike | undefined {
  if (!err || typeof err != 'object') return
  if ('data' in err && err.data && isBytesLike(err.data)) return err.data
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

export function tryParseEventData(topicHashOrName: string, data: BytesLike) {
  let res: readonly [Result, EventFragment] | undefined
  for (const iface of Object.values(ifaces)) {
    iface.forEachEvent((event) => {
      if (event.topicHash !== topicHashOrName && event.name !== topicHashOrName) return
      try {
        const parsed = defaultAbiCoder.decode(
          event.inputs.filter(({ indexed }) => !indexed),
          data,
          false,
        )
        if (parsed) res = [parsed, event]
      } catch (_) {
        // test all abis
      }
    })
    if (res) break
  }
  return res
}
