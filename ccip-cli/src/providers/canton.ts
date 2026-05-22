import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

import type {
  CantonConfig,
  Logger,
  PartySignatures,
  TransactionSigner,
} from '@chainlink/ccip-sdk/src/index.ts'

/**
 * Wallet object returned by {@link loadCantonWallet}.
 *
 * `signer` is present only when the caller supplied a private key, enabling the
 * external-signing (prepare → sign → execute) flow.
 */
export interface CantonWalletWithSigner {
  party: string
  signer?: Ed25519TransactionSigner
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
   * @returns PartySignatures ready for the execute submission request.
   */
  sign(hash: Uint8Array): Promise<PartySignatures> {
    const signature = sign(null, Buffer.from(hash), this.privateKeyObject)

    return Promise.resolve({
      signatures: [
        {
          party: this.party,
          signatures: [
            {
              format: 'SIGNATURE_FORMAT_RAW',
              signature: signature.toString('base64'),
              signedBy: this.fingerprint,
              signingAlgorithmSpec: 'SIGNING_ALGORITHM_SPEC_ED25519',
            },
          ],
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
  // prettier-ignore
  const prefix = Buffer.from([
    0x30, 0x2e,             // SEQUENCE, 46 bytes
    0x02, 0x01, 0x00,       // INTEGER 0 (version)
    0x30, 0x05,             // SEQUENCE, 5 bytes (AlgorithmIdentifier)
    0x06, 0x03,             // OID, 3 bytes
    0x2b, 0x65, 0x70,       // 1.3.101.112 (Ed25519)
    0x04, 0x22,             // OCTET STRING, 34 bytes
    0x04, 0x20,             // OCTET STRING, 32 bytes (the seed)
  ])
  return Buffer.concat([prefix, seed])
}

/**
 * Load and validate a Canton config JSON file.
 *
 * @param configPath - Path to JSON file, or undefined if not provided.
 * @param logger - Logger for debug output.
 * @returns Parsed CantonConfig or undefined.
 */
export function loadCantonConfig(
  configPath: string | undefined,
  logger?: Logger,
): CantonConfig | undefined {
  if (!configPath) return undefined
  if (!existsSync(configPath)) {
    throw new Error(`Canton config file not found: ${configPath}`)
  }
  const raw = readFileSync(configPath, 'utf8')
  const parsed = JSON.parse(raw) as Record<string, unknown>

  const required = ['party', 'ccipParty', 'jwt', 'edsUrl', 'transferInstructionUrl'] as const
  for (const field of required) {
    if (typeof parsed[field] !== 'string' || !parsed[field].length) {
      throw new Error(`Canton config: "${field}" is required and must be a non-empty string`)
    }
  }

  logger?.debug('Loaded Canton config from', configPath, 'for party', parsed['party'])
  return parsed as unknown as CantonConfig
}

/**
 * Resolve a Canton wallet from CLI argv.
 *
 * The `party` is sourced from the Canton config file. When a private key is
 * provided (via `--wallet`, `PRIVATE_KEY` env, or rpcsFile — resolved upstream
 * by `loadChainWallet`), an {@link Ed25519TransactionSigner} is attached so
 * `sendMessage` / `execute` use the interactive submission API
 * (prepare → sign → execute).
 */
export function loadCantonWallet(
  argv: { wallet?: unknown; cantonConfig?: string },
  logger?: Logger,
): CantonWalletWithSigner {
  const cantonCfg = loadCantonConfig(argv.cantonConfig, logger)
  const party = cantonCfg?.party
  if (!party) {
    throw new Error(
      'Canton wallet requires a party ID: provide --canton-config with a "party" field',
    )
  }

  const privateKey = typeof argv.wallet === 'string' ? argv.wallet : undefined
  if (privateKey && /^(0x)?[0-9a-fA-F]{64}$/.test(privateKey)) {
    const signer = new Ed25519TransactionSigner(privateKey, party)
    logger?.debug(`Canton wallet: external signer created (fingerprint=${signer.getFingerprint()})`)
    return { party, signer }
  }

  return { party }
}
