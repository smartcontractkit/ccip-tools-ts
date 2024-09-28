import { type BytesLike, Interface, type InterfaceAbi, isBytesLike } from 'ethers'

import TokenABI from '../abi/BurnMintERC677Token.js'
import BurnMintTokenPool_1_5 from '../abi/BurnMintTokenPool_1_5.js'
import LockReleaseTokenPool_1_5 from '../abi/LockReleaseTokenPool_1_5.js'
import Router from '../abi/Router.js'
import { CCIP_ABIs, CCIPVersion_1_5 } from './types.js'
import { lazyCached } from './utils.js'

const ifaces = [
  lazyCached('Interface Router', () => new Interface(Router)),
  lazyCached(`Interface Token`, () => new Interface(TokenABI)),
  lazyCached(
    `Interface BurnMintTokenPool ${CCIPVersion_1_5}`,
    () => new Interface(BurnMintTokenPool_1_5),
  ),
  lazyCached(
    `Interface LockReleaseTokenPool ${CCIPVersion_1_5}`,
    () => new Interface(LockReleaseTokenPool_1_5),
  ),
  ...Object.entries(CCIP_ABIs)
    .map(([type_, obj]) =>
      Object.entries(obj).map(([version, abi]) =>
        lazyCached(`Interface ${type_} ${version}`, () => new Interface(abi as InterfaceAbi)),
      ),
    )
    .flat(1),
]

/**
 * Parse error data from revert call data, if possible, from our supported ABIs
 * @param data - error data from a revert call
 * @returns ErrorDescription if found
 **/
export function parseErrorData(data: BytesLike) {
  for (const iface of ifaces) {
    try {
      const parsed = iface.parseError(data)
      if (parsed) return parsed
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
