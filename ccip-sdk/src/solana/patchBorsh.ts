import { Buffer } from 'buffer'

import { BorshInstructionCoder } from '@coral-xyz/anchor'
import { BorshTypesCoder } from '@coral-xyz/anchor/dist/cjs/coder/borsh/types.js'
import { sha256, toUtf8Bytes } from 'ethers'

import { snakeToCamel } from '../utils.ts'
import { camelToSnakeCase } from './utils.ts'

type Layout_<T = unknown> = { encode: (type: T, buffer: Buffer) => number }

function sighash(nameSpace: string, ixName: string): Buffer {
  const name = camelToSnakeCase(ixName)
  const preimage = `${nameSpace}:${name}`
  return Buffer.from(sha256(toUtf8Bytes(preimage)).slice(2, 18), 'hex')
}

let patched = false
/**
 * Patches BorshTypesCoder to ensure correct buffer allocation for large messages.
 * Should be called before encoding Solana CCIP messages.
 */
export function patchBorsh() {
  if (patched) return
  patched = true
  // monkey patch some functions to ensure correct buffer allocation (usually, hardcoded 1000B)
  Object.assign(BorshTypesCoder.prototype, {
    encode: function <T>(this: BorshTypesCoder, name: string, type: T): Buffer {
      const layout = (this as unknown as { typeLayouts: Map<string, Layout_> }).typeLayouts.get(
        name,
      )
      if (!layout) {
        throw new Error(`Unknown type: ${name}`)
      }
      let buffer = Buffer.alloc(512)
      let len
      try {
        len = layout.encode(type, buffer)
      } catch (err) {
        if (err instanceof RangeError) {
          buffer = Buffer.alloc(32000)
          len = layout.encode(type, buffer)
        } else {
          throw err
        }
      }

      return buffer.subarray(0, len)
    },
  })

  Object.assign(BorshInstructionCoder.prototype, {
    _encode: function (
      this: BorshInstructionCoder,
      nameSpace: string,
      ixName: string,
      ix: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    ): Buffer {
      const methodName = snakeToCamel(ixName)
      const layout = (this as unknown as { ixLayout: Map<string, Layout_> }).ixLayout.get(
        methodName,
      )
      if (!layout) {
        throw new Error(`Unknown method: ${methodName}`)
      }
      let buffer = Buffer.alloc(512)
      let len
      try {
        len = layout.encode(ix, buffer)
      } catch (err) {
        if (err instanceof RangeError) {
          buffer = Buffer.alloc(32000)
          len = layout.encode(ix, buffer)
        } else {
          throw err
        }
      }
      const data = buffer.subarray(0, len)
      return Buffer.concat([sighash(nameSpace, ixName), data])
    },
  })
}
