import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'

import {
  type Logger,
  type SinglePartySignatures,
  type TransactionSigner,
  CCIPArgumentInvalidError,
  CCIPInteractiveRequiredError,
} from '@chainlink/ccip-sdk/src/index.ts'
import CantonLedger, {
  type CantonAddress,
  type CantonSignature,
  CLA,
  INS,
  P2_FIRST,
  P2_MORE,
  P2_MSG_END,
  SIGNATURE_END_BYTE,
  SIGNATURE_FRAMING_BYTE,
  STATUS,
} from '@ledgerhq/hw-app-canton/lib/index'
import HIDTransport from '@ledgerhq/hw-transport-node-hid'
import { TransportStatusError } from '@ledgerhq/hw-transport/errors'
// @ts-ignore
import BIPPath from 'bip32-path'

import { loadCantonConfig } from './config.ts'

// Unexported constants, copied from:
// https://github.com/LedgerHQ/ledger-live/blob/6651fb6c9687afec979ffc7d8eddb0fcded452a7/libs/ledgerjs/packages/hw-app-canton/src/Canton.ts#L34-L40
const TLV_SIGNATURE_LENGTH = 131 // bytes: [40][64B main][00][40][64B challenge]
const TLV_SIGNATURE_START_OFFSET = 1 // After framing byte
const TLV_SIGNATURE_END_OFFSET = 65 // End of main signature
const TLV_APPLICATION_SIGNATURE_START_OFFSET = 67 // After [00][40]
const TLV_APPLICATION_SIGNATURE_END_OFFSET = 131 // End of application signature
const ED25519_SIGNATURE_BYTE_LENGTH = 64 // bytes

// Missing P1 parameter to sign raw tx hashes, not present in hw-app-canton:
const P1_SIGN_HASH = 0x00

/**
 * Wallet object returned by {@link loadCantonWallet}.
 *
 * `signer` is reserved for the external-signing (prepare → sign → execute)
 * flow, which is not yet enabled in `loadCantonWallet`. Canton sends currently
 * use JWT-authenticated direct submit.
 */
export interface CantonWalletWithSigner {
  party: string
  signer?: TransactionSigner
}

export class CantonLedgerSigner implements TransactionSigner {
  private readonly party: string
  private readonly derivationPath: string
  private readonly cantonSigner: CantonLedger.default
  private readonly fingerprint: string

  private constructor(signer: CantonLedger.default, derivationPath: string, party: string) {
    this.derivationPath = derivationPath
    this.cantonSigner = signer
    this.party = party
    this.fingerprint = derivePartyFingerprint(party)
  }

  static async create(derivationPath: string, party: string) {
    const transport = await HIDTransport.default.create()
    const signer = new CantonLedger.default(transport)
    const ledgerSigner = new CantonLedgerSigner(signer, derivationPath, party)

    // Validate that the key at the derivation path points to the expected/configured party
    // by comparing their fingerprints:
    let addressResponse: CantonAddress
    try {
      addressResponse = await ledgerSigner.cantonSigner.getAddress(
        ledgerSigner.derivationPath,
        false,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Error validating Ledger key for derivation path ${derivationPath}: ${message}`,
      )
    }

    const expectedFingerprint = normalizeHex(ledgerSigner.fingerprint)
    const returnedFingerprint = normalizeHex(
      computeCantonFingerprint(decodeLedgerPublicKey(addressResponse.publicKey)),
    )
    if (returnedFingerprint !== expectedFingerprint) {
      throw new Error(
        `Ledger key mismatch for party "${party}" at derivation path ${derivationPath}: expected fingerprint ${expectedFingerprint}, got ${returnedFingerprint}`,
      )
    }

    return ledgerSigner
  }

  async signTxHash(hash: Uint8Array): Promise<SinglePartySignatures> {
    /*
    * This should just use:
        const txHashHex = Buffer.from(hash).toString('hex')
        const { signature } = await this.cantonSigner.signTransaction(this.derivationPath, txHashHex)
    * But hw-app-canton currently uses `signUntypedVersionedMessage` behind `signTxHash` which uses
    * the wrong APDU P1 parameter for raw tx hash signing.
    * Signing a raw tx hash should use P1_SIGN_HASH = 0x00, not P1_SIGN_UNTYPED_VERSIONED_MESSAGE = 0x01
    * See reference:
    * https://github.com/LedgerHQ/app-canton/blob/develop/doc/APDU.md#sign_hash-p1--0x00-example
    * Therefore, copying some of the logic from hw-app-canton to send the correct APDU commands for
    * signing a raw tx hash while still keeping the instantiated cantonSigner around in case support
    * is added in the future.
    * */

    const txHash = Buffer.from(hash)

    // 1. Send the derivation path
    const serializedPath = this.serializeBipPath(this.derivationPath)

    const pathResponse = await this.cantonSigner.transport.send(
      CLA,
      INS.SIGN,
      P1_SIGN_HASH,
      P2_FIRST | P2_MORE,
      serializedPath,
    )
    this.checkTransportResponse(pathResponse)

    // 2. Send the transaction hash as a single transaction
    const response = await this.cantonSigner.transport.send(
      CLA,
      INS.SIGN,
      P1_SIGN_HASH,
      P2_MSG_END,
      txHash,
    )

    this.checkTransportResponse(response)
    const responseData = this.extractResponseData(response)
    const signatureResponse = this.parseSignatureResponse(responseData)
    const signatureBytes = Buffer.from(signatureResponse.signature, 'hex')

    return {
      party: this.party,
      signatures: [
        {
          format: 'SIGNATURE_FORMAT_RAW',
          signature: signatureBytes.toString('base64'),
          signedBy: this.fingerprint,
          signingAlgorithmSpec: 'SIGNING_ALGORITHM_SPEC_ED25519',
        },
      ],
    }
  }

  /**
   * Check transport response for errors and throw appropriate exceptions
   * @private
   */
  private checkTransportResponse(response: Buffer): void {
    const statusCode = response.readUInt16BE(response.length - 2)

    if (statusCode !== STATUS.OK) {
      throw new TransportStatusError(statusCode)
    }
  }

  /**
   * Extract response data from transport response
   * APDU responses have format: [data][status_code(2_bytes)]
   * @private
   */
  private extractResponseData(response: Buffer): Buffer {
    return response.slice(0, -2)
  }

  /**
   * Parse signature response - handles both TLV format (onboarding) and single signatures
   * @private
   */
  private parseSignatureResponse(response: Buffer, challenge?: string): CantonSignature {
    // Handle TLV (Type-Length-Value) format: [40][64B main][00][40][64B challenge] = 131 bytes
    if (
      response.length === TLV_SIGNATURE_LENGTH &&
      response.readUInt8(0) === SIGNATURE_FRAMING_BYTE &&
      response.readUInt8(TLV_SIGNATURE_END_OFFSET) === SIGNATURE_END_BYTE &&
      response.readUInt8(TLV_APPLICATION_SIGNATURE_START_OFFSET - 1) === SIGNATURE_FRAMING_BYTE
    ) {
      const signature = response
        .slice(TLV_SIGNATURE_START_OFFSET, TLV_SIGNATURE_END_OFFSET)
        .toString('hex')
      const applicationSignature = response
        .slice(TLV_APPLICATION_SIGNATURE_START_OFFSET, TLV_APPLICATION_SIGNATURE_END_OFFSET)
        .toString('hex')

      // Include applicationSignature only if challenge was provided in the request
      return {
        signature,
        ...(challenge && { applicationSignature }),
      }
    }

    // Handle single signature formats - check length before converting to hex
    if (response.length === ED25519_SIGNATURE_BYTE_LENGTH) {
      // Pure 64-byte Ed25519 signature = 128 hex chars (64 bytes)
      return { signature: response.toString('hex') }
    }

    if (response.length === ED25519_SIGNATURE_BYTE_LENGTH + 2) {
      // Canton-framed signature: [40][64B Ed25519 sig][00] = 66 bytes (132 hex chars)
      const cleanedSignature = response.slice(1, -1).toString('hex')
      return { signature: cleanedSignature }
    }

    // Fallback: return as hex string
    return { signature: response.toString('hex') }
  }

  /**
   * Serialize a BIP-32 path string to a data buffer for Canton BOLOS
   * @private
   */
  private serializeBipPath(pathString: string): Buffer {
    const bipPath = BIPPath.fromString(pathString).toPathArray()
    const data = Buffer.alloc(1 + bipPath.length * 4)

    data.writeUInt8(bipPath.length, 0) // Write path length as first byte
    bipPath.forEach((segment: any, index: any) => {
      data.writeUInt32BE(segment, 1 + index * 4) // Write each segment as 32-bit integer
    })

    return data
  }
}

function derivePartyFingerprint(party: string): string {
  const parts = party.split('::')
  const fingerprint = parts[parts.length - 1]?.trim()
  if (!fingerprint) {
    throw new Error(`Canton party "${party}" does not include a key fingerprint`)
  }
  return fingerprint
}

function decodeLedgerPublicKey(publicKey: string): Buffer {
  const normalized = publicKey.replace(/^0x/i, '').trim()
  if (!/^[\da-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error('Ledger publicKey is not valid hex')
  }
  const raw = Buffer.from(normalized, 'hex')

  if (raw.length !== 32) {
    throw new Error(`Ledger publicKey has invalid length ${raw.length}, expected 32`)
  }

  return raw
}

function normalizeHex(value: string): string {
  return value.trim().replace(/^0x/i, '').toLowerCase()
}

/**
 * An Ed25519 {@link TransactionSigner} for Canton external signing.
 *
 * Accepts a 32-byte Ed25519 seed (private key) and a Daml party ID, producing
 * the {@link PartySignatures} structure expected by the Canton interactive
 * submission API.
 *
 * The key fingerprint is computed using Canton's algorithm:
 * `hex( 0x12 0x20 || sha256( [0,0,0,12] || publicKeyBytes ) )`
 *
 * @example
 * ```ts
 * const signer = new Ed25519TransactionSigner(seedHex, partyId)
 * const wallet: CantonWallet = { party: partyId, signer }
 * await cantonChain.sendMessage({ wallet, ... })
 * ```
 */
export class Ed25519TransactionSigner implements TransactionSigner {
  private readonly privateKeyObject: ReturnType<typeof createPrivateKey>
  private readonly fingerprint: string
  private readonly party: string

  /**
   * Creates a new Ed25519 transaction signer.
   * @param privateKeyHex - 64-character hex string representing the 32-byte Ed25519 seed.
   * @param party - The Daml party ID this signer acts on behalf of.
   */
  constructor(privateKeyHex: string, party: string) {
    const seed = Buffer.from(privateKeyHex.replace(/^0x/, ''), 'hex')
    if (seed.length !== 32) {
      throw new Error(
        `Ed25519TransactionSigner: expected 32-byte seed (64 hex chars), got ${seed.length} bytes`,
      )
    }

    this.party = party

    // Node.js crypto expects Ed25519 private keys in PKCS8 DER format.
    // For a raw 32-byte seed, we wrap it in the standard PKCS8 ASN.1 envelope.
    this.privateKeyObject = createPrivateKey({
      key: buildEd25519Pkcs8Der(seed),
      format: 'der',
      type: 'pkcs8',
    })

    // Derive the public key and compute the Canton fingerprint.
    const publicKeyObject = createPublicKey(this.privateKeyObject)
    const publicKeyDer = publicKeyObject.export({ type: 'spki', format: 'der' }) as Buffer
    // Ed25519 SPKI DER is 44 bytes: 12-byte header + 32-byte key.
    const rawPublicKey = publicKeyDer.subarray(publicKeyDer.length - 32)
    this.fingerprint = computeCantonFingerprint(rawPublicKey)
  }

  /**
   * Sign a prepared transaction hash.
   *
   * @param hash - Raw hash bytes from the prepare response.
   * @returns SinglePartySignatures ready for the execute submission request.
   */
  signTxHash(hash: Uint8Array): Promise<SinglePartySignatures> {
    const signature = sign(null, Buffer.from(hash), this.privateKeyObject)

    return Promise.resolve({
      party: this.party,
      signatures: [
        {
          format: 'SIGNATURE_FORMAT_RAW',
          signature: signature.toString('base64'),
          signedBy: this.fingerprint,
          signingAlgorithmSpec: 'SIGNING_ALGORITHM_SPEC_ED25519',
        },
      ],
    })
  }

  /** Returns the Canton key fingerprint for this signer. */
  getFingerprint(): string {
    return this.fingerprint
  }
}

/**
 * Compute the Canton key fingerprint for a raw Ed25519 public key.
 *
 * Algorithm (from Canton's HashPurpose.scala, purpose 12 = PublicKeyFingerprint):
 * 1. SHA-256( [0, 0, 0, 12] || rawPublicKeyBytes )
 * 2. Prepend multihash header [0x12, 0x20]
 * 3. Hex-encode → 68-character string
 */
function computeCantonFingerprint(rawPublicKey: Buffer): string {
  const PURPOSE_PUBLIC_KEY_FINGERPRINT = 12
  const h = createHash('sha256')
  h.update(Buffer.from([0, 0, 0, PURPOSE_PUBLIC_KEY_FINGERPRINT]))
  h.update(rawPublicKey)
  const digest = h.digest()

  // Multihash header: 0x12 = sha256, 0x20 = 32 bytes
  const result = Buffer.concat([Buffer.from([0x12, 0x20]), digest])
  return result.toString('hex')
}

/**
 * Wrap a 32-byte Ed25519 seed in a PKCS8 DER envelope.
 *
 * The ASN.1 structure is:
 * ```
 *   SEQUENCE {
 *     INTEGER 0                          -- version
 *     SEQUENCE { OID 1.3.101.112 }       -- Ed25519 algorithm
 *     OCTET STRING { OCTET STRING seed } -- private key
 *   }
 * ```
 */
function buildEd25519Pkcs8Der(seed: Buffer): Buffer {
  // RFC 8410 §7 — Ed25519 private key encoded as PKCS#8 / OneAsymmetricKey.
  //
  // The DER prefix below is the fixed 16-byte ASN.1 envelope that wraps the
  // 32-byte seed.  Every Ed25519 PKCS8 key shares this exact prefix; only the
  // trailing 32 bytes change.
  //
  //   30 2e                  — SEQUENCE (46 bytes total)
  //     02 01 00             — INTEGER 0  (version = v1)
  //     30 05                — SEQUENCE (5 bytes, AlgorithmIdentifier)
  //       06 03 2b 65 70    — OID 1.3.101.112  (id-EdDSA / Ed25519)
  //     04 22                — OCTET STRING (34 bytes, wraps inner key)
  //       04 20              — OCTET STRING (32 bytes, the raw seed)
  //         <seed bytes>
  //
  // oxfmt-ignore
  const prefix = Buffer.from([
    0x30, 0x2e, // SEQUENCE, 46 bytes
    0x02, 0x01, 0x00, // INTEGER 0 (version)
    0x30, 0x05, // SEQUENCE, 5 bytes (AlgorithmIdentifier)
    0x06, 0x03, // OID, 3 bytes
    0x2b, 0x65, 0x70, // 1.3.101.112 (Ed25519)
    0x04, 0x22, // OCTET STRING, 34 bytes
    0x04, 0x20, // OCTET STRING, 32 bytes (the seed)
  ])
  return Buffer.concat([prefix, seed])
}

/**
 * Resolve a Canton wallet from CLI argv.
 *
 * The `party` is sourced from the Canton config file. Canton sends use
 * JWT-authenticated direct submit (no external signer); the `--wallet` flag
 * is accepted but ignored on Canton lanes.
 */
export async function loadCantonWallet(
  {
    cantonConfig,
    wallet: walletOpt,
    interactive,
  }: {
    cantonConfig?: string
    wallet?: unknown
    interactive?: boolean
  },
  logger?: Logger,
): Promise<CantonWalletWithSigner> {
  const cantonCfg = loadCantonConfig(cantonConfig, logger)
  const party = cantonCfg?.party
  if (!party) {
    throw new Error(
      'Canton wallet requires a party ID: provide --canton-config with a "party" field',
    )
  }

  if (walletOpt) {
    if (typeof walletOpt !== 'string')
      throw new CCIPArgumentInvalidError('wallet', 'expected a string')
    if (walletOpt.startsWith('ledger')) {
      if (interactive === false) {
        throw new CCIPInteractiveRequiredError('Ledger wallet requires USB interaction', {
          recovery:
            'Use a private key or keystore wallet with password env var for non-interactive mode',
        })
      }
      let derivationPath = walletOpt.split(':')[1]
      if (!derivationPath) derivationPath = `m/44'/6767'/0'/0'/0'`
      else if (!isNaN(Number(derivationPath)))
        derivationPath = `m/44'/6767'/0'/0'/${derivationPath}'`

      const ledgerSigner = await CantonLedgerSigner.create(derivationPath, party)
      logger?.info(`Ledger connected for Canton party: ${party}, derivationPath: ${derivationPath}`)
      return { party, signer: ledgerSigner }
    }
  }

  return { party }
}
