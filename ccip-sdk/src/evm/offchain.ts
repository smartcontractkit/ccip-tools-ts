import { type BytesLike, Contract, concat, dataLength, hexlify, toBeHex } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import { CCIPArgumentInvalidError } from '../errors/index.ts'
import type { TokenVerifier } from '../offchain.ts'
import type { OffchainTokenData } from '../types.ts'
import { getDataBytes } from '../utils.ts'
import type CCTPVerifier_2_0_ABI from './abi/CCTPVerifier_2_0.ts'
import type VersionedVerifierResolver_2_0_ABI from './abi/VersionedVerifierResolver_2_0.ts'
import { VerifierABI, defaultAbiCoder, interfaces } from './const.ts'
import { resultToObject } from './types.ts'
import type { EVMChain } from './index.ts'

/**
 * Encodes offchain token data for EVM execution.
 * @param data - Offchain token data to encode.
 * @returns ABI-encoded data or empty hex string.
 */
export function encodeEVMOffchainTokenData(data: OffchainTokenData): string {
  if (data?._tag === 'usdc') {
    return defaultAbiCoder.encode(['tuple(bytes message, bytes attestation)'], [data])
  } else if (data?._tag === 'lbtc') {
    return data.attestation as string
  }
  return '0x'
}

/**
 * Encodes offchain token data as a CCIP v2.0 token verifier's `ccvData`:
 * - usdc (CCTP verifier): `[versionTag][cctpMessage][attestation]`;
 * - lbtc (Lombard verifier): `[versionTag][payloadLength (2)][payload][proofLength (2)][proof]`,
 *   from the bridge's `abi.encode(bytes payload, bytes proof)` attestation.
 *
 * @param versionTag - The 4-byte tag that routes `ccvData` to a verifier implementation
 * @param data - The token issuer's offchain data, as returned by {@link getOffchainTokenData}
 * @returns The encoded `ccvData`
 * @throws {@link CCIPArgumentInvalidError} if `versionTag` is not 4 bytes, the attestation is
 *   malformed, or `data` is of an unsupported kind
 */
export function encodeEVMTokenCcvData(
  versionTag: BytesLike,
  data: NonNullable<OffchainTokenData>,
): string {
  if (dataLength(versionTag) !== 4)
    throw new CCIPArgumentInvalidError('versionTag', `expected 4 bytes, got ${hexlify(versionTag)}`)
  if (data._tag === 'usdc') return hexlify(concat([versionTag, data.message!, data.attestation!]))
  if (data._tag !== 'lbtc')
    throw new CCIPArgumentInvalidError('data', `unsupported offchain token data: ${data._tag}`)

  let payload: string, proof: string
  try {
    ;[payload, proof] = defaultAbiCoder.decode(['bytes', 'bytes'], getDataBytes(data.attestation!))
  } catch (cause) {
    throw new CCIPArgumentInvalidError('attestation', 'expected abi.encode(bytes, bytes)', {
      cause: cause instanceof Error ? cause : undefined,
    })
  }
  const lengthPrefixed = [payload, proof].flatMap((part) => {
    if (dataLength(part) > 0xffff)
      throw new CCIPArgumentInvalidError('attestation', `part longer than uint16: ${part}`)
    return [toBeHex(dataLength(part), 2), part]
  })
  return hexlify(concat([versionTag, ...lengthPrefixed]))
}

/** Implementation contract types of the token verifiers, by the offchain data they consume. */
const tokenVerifierTags: Record<string, TokenVerifier['tag']> = {
  CCTPVerifier: 'usdc',
  LombardVerifier: 'lbtc',
}

/** Describe the token verifier `impl` routed to by `ccv`, or `undefined` if it isn't one. */
async function getTokenVerifier(
  chain: EVMChain,
  ccv: string,
  impl: string,
  sourceChainSelector: bigint,
  versionTag?: string,
): Promise<TokenVerifier | undefined> {
  const [type, version] = await chain.typeAndVersion(impl)
  const tag = tokenVerifierTags[type]
  if (!tag) return
  versionTag ??= hexlify(
    await (
      new Contract(impl, VerifierABI, chain.provider) as unknown as TypedContract<
        typeof VerifierABI
      >
    ).versionTag(),
  )
  if (tag === 'lbtc') return { tag, ccv, versionTag, version }
  const { domainIdentifier, enabled } = await (
    new Contract(impl, interfaces.CCTPVerifier_v2_0, chain.provider) as unknown as TypedContract<
      typeof CCTPVerifier_2_0_ABI
    >
  ).getDomain(sourceChainSelector)
  return {
    tag,
    ccv,
    versionTag,
    version,
    ...(enabled && { cctpSourceDomain: Number(domainIdentifier) }),
  }
}

/**
 * List the token verifiers behind a destination CCV: itself, or a `VersionedVerifierResolver`'s
 * inbound implementations.
 *
 * @param chain - The destination chain
 * @param ccv - A destination CCV address
 * @param sourceChainSelector - The message's source chain, to read a CCTP verifier's domain
 * @returns The token verifiers behind `ccv`, possibly empty
 */
export async function getEVMTokenVerifiers(
  chain: EVMChain,
  ccv: string,
  sourceChainSelector: bigint,
): Promise<TokenVerifier[]> {
  let type: string
  try {
    ;[type] = await chain.typeAndVersion(ccv)
  } catch {
    return [] // not a versioned contract, so not a token verifier
  }
  if (type !== 'VersionedVerifierResolver') {
    const verifier = await getTokenVerifier(chain, ccv, ccv, sourceChainSelector)
    return verifier ? [verifier] : []
  }
  const resolver = new Contract(
    ccv,
    interfaces.VersionedVerifierResolver_v2_0,
    chain.provider,
  ) as unknown as TypedContract<typeof VersionedVerifierResolver_2_0_ABI>
  const entries = resultToObject(
    await resolver.getAllInboundImplementations(),
  ) as unknown as readonly { version: string; verifier: string }[]
  const verifiers = await Promise.all(
    entries.map(({ version, verifier }) =>
      getTokenVerifier(chain, ccv, verifier, sourceChainSelector, hexlify(version)).catch(
        () => undefined, // not a versioned verifier
      ),
    ),
  )
  return verifiers.filter((v) => v != null)
}
