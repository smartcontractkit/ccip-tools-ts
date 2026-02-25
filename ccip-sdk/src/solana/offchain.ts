import { BorshCoder } from '@coral-xyz/anchor'
import { hexlify } from 'ethers'

import type { OffchainTokenData } from '../types.ts'
import { bytesToBuffer } from '../utils.ts'
import { IDL as BASE_TOKEN_POOL } from './idl/1.6.0/BASE_TOKEN_POOL.ts'
import { IDL as CCTP_TOKEN_POOL } from './idl/1.6.0/CCIP_CCTP_TOKEN_POOL.ts'

interface CcipCctpMessageAndAttestation {
  message: {
    data: Uint8Array
  }
  attestation: Uint8Array
}
const cctpTokenPoolCoder = new BorshCoder({
  ...CCTP_TOKEN_POOL,
  types: [...BASE_TOKEN_POOL.types, ...CCTP_TOKEN_POOL.types],
  events: [...BASE_TOKEN_POOL.events, ...CCTP_TOKEN_POOL.events],
  errors: [...BASE_TOKEN_POOL.errors, ...CCTP_TOKEN_POOL.errors],
})

/**
 * Encodes CCTP message and attestation
 *
 * @param data - OffchainTokenData (_tag="usdc")
 * @returns Encoded data - Borsh-encoded attestation for Solana
 */
export function encodeSolanaOffchainTokenData(data: OffchainTokenData): string {
  if (data?._tag === 'usdc' && data.message && data.attestation) {
    const messageBuffer = bytesToBuffer(data.message)
    const attestationBuffer = bytesToBuffer(data.attestation)

    // Solana destination: use Borsh encoding
    const messageAndAttestation: CcipCctpMessageAndAttestation = {
      message: {
        data: messageBuffer, // u8 array
      },
      attestation: attestationBuffer, // u8 array
    }

    const encoded = cctpTokenPoolCoder.types.encode('MessageAndAttestation', messageAndAttestation)
    return hexlify(encoded)
  }
  return '0x'
}
