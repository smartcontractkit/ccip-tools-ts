import { Buffer } from 'buffer'

import { type Address, type Idl, type Provider, BorshCoder, Program } from '@coral-xyz/anchor'
import { sha256, toUtf8Bytes } from 'ethers'

import { CCIPBorshMethodUnknownError, CCIPBorshTypeUnknownError } from '../errors/index.ts'
import { snakeToCamel } from '../utils.ts'
import { camelToSnakeCase } from './utils.ts'

type Layout_ = { encode: (value: unknown, buffer: Buffer) => number }

function sighash(nameSpace: string, ixName: string): Buffer {
  const name = camelToSnakeCase(ixName)
  const preimage = `${nameSpace}:${name}`
  return Buffer.from(sha256(toUtf8Bytes(preimage)).slice(2, 18), 'hex')
}

function encodeLayout(layout: Layout_, value: unknown): Buffer {
  let buffer = Buffer.alloc(512)
  let len
  try {
    len = layout.encode(value, buffer)
  } catch (err) {
    if (!(err instanceof RangeError)) throw err
    buffer = Buffer.alloc(32000)
    len = layout.encode(value, buffer)
  }
  return buffer.subarray(0, len)
}

const coders = new WeakMap<Idl, BorshCoder>()

/**
 * BorshCoder for `idl` whose types and instruction encoders grow their buffer as needed, instead of
 * Anchor 0.29's hardcoded 1000B. The overrides are own properties of this instance: they apply to
 * whichever Anchor build (cjs, esm, browser) a bundler resolves, and don't leak into other Anchor
 * users' coders. Memoized per IDL object.
 * @param idl - Anchor IDL
 * @returns shared coder for `idl`
 */
export function sizedCoder(idl: Idl): BorshCoder {
  let coder = coders.get(idl)
  if (coder) return coder
  coder = new BorshCoder(idl)
  const { typeLayouts } = coder.types as unknown as { typeLayouts: Map<string, Layout_> }
  const { ixLayout } = coder.instruction as unknown as { ixLayout: Map<string, Layout_> }
  Object.assign(coder.types, {
    encode(name: string, value: unknown): Buffer {
      const layout = typeLayouts.get(name)
      if (!layout) throw new CCIPBorshTypeUnknownError(name)
      return encodeLayout(layout, value)
    },
  })
  Object.assign(coder.instruction, {
    _encode(nameSpace: string, ixName: string, ix: unknown): Buffer {
      const methodName = snakeToCamel(ixName)
      const layout = ixLayout.get(methodName)
      if (!layout) throw new CCIPBorshMethodUnknownError(methodName)
      return Buffer.concat([sighash(nameSpace, ixName), encodeLayout(layout, ix)])
    },
  })
  coders.set(idl, coder)
  return coder
}

/**
 * Anchor `Program` using the {@link sizedCoder} for its IDL.
 * @param idl - Anchor IDL
 * @param programId - program address
 * @param provider - Anchor provider
 * @returns Program instance
 */
export function newProgram<I extends Idl>(
  idl: I,
  programId: Address,
  provider?: Provider,
): Program<I> {
  return new Program(idl, programId, provider, sizedCoder(idl))
}
