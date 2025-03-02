import { dataLength, isBytesLike, isHexString } from 'ethers'

import { parseExtraArgs, parseWithFragment, recursiveParseError } from '../lib/index.js'
import { formatResult } from './utils.js'

export function parseBytes({ data, selector }: { data: string; selector?: string }) {
  let parsed
  if (selector) {
    parsed = parseWithFragment(selector, data)
  } else {
    if (isBytesLike(data)) {
      const extraArgs = parseExtraArgs(data)
      if (extraArgs) {
        const { _tag, ...rest } = extraArgs
        console.info(`${_tag}:`, rest)
        return
      }
    }
    parsed = parseWithFragment(data)
  }
  if (!parsed) throw new Error('Unknown data')
  const [fragment, contract, args] = parsed
  const name = fragment.constructor.name.replace(/Fragment$/, '')
  console.info(`${name}: ${contract.replace(/_\d\.\d.*$/, '')} ${fragment.format('full')}`)
  if (args) {
    const formatted = formatResult(args, (val, key) => {
      if (key === 'extraArgs' && isHexString(val)) {
        const extraArgs = parseExtraArgs(val)
        if (extraArgs) {
          const { _tag, ...rest } = extraArgs
          return `${_tag}(${Object.entries(rest)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ')})`
        }
      }
      return val
    })
    const ps: unknown[] = []
    if (fragment.name === 'ReceiverError' && args.err === '0x') {
      ps.push('[possibly out-of-gas or abi.decode error]')
    }
    console.info('Args:', formatted ?? args, ...ps)
    if (dataLength(((args.err || args.error || args.returnData) as string) ?? '0x') > 0) {
      for (const [key, data] of Object.entries(args.toObject())) {
        if (isHexString(data)) {
          for (const [k, err] of recursiveParseError(key, data)) {
            console.info(`${k}:`, err)
          }
        } else {
          console.info(`${key}:`, data)
        }
      }
    }
  }
}
