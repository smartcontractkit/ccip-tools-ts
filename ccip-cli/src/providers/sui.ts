import { createHash } from 'node:crypto'

import {
  type Logger,
  CCIPArgumentInvalidError,
  CCIPInteractiveRequiredError,
  CCIPNotImplementedError,
  bytesToBuffer,
} from '@chainlink/ccip-sdk/src/index.ts'
import HIDTransport from '@ledgerhq/hw-transport-node-hid'
import {
  type PublicKey,
  type SignatureScheme,
  type SignatureWithBytes,
  Signer,
  messageWithIntent,
  toSerializedSignature,
} from '@mysten/sui/cryptography'
import { Ed25519Keypair, Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import { toBase64 } from '@mysten/sui/utils'

type LedgerTransport = Awaited<ReturnType<typeof HIDTransport.default.create>>

/** Default BIP44 derivation path for Sui (coin type 784), used when only an index is given. */
const SUI_LEDGER_DEFAULT_PATH = "m/44'/784'/0'/0'/0'"

// APDU protocol of the "Sui" Ledger app (same protocol as @mysten/ledgerjs-hw-app-sui).
const LEDGER_CLA = 0
const INS_GET_PUBLIC_KEY = 2
const INS_SIGN_TRANSACTION = 3
const CHUNK_SIZE = 180
const LedgerToHost = {
  RESULT_ACCUMULATING: 0,
  RESULT_FINAL: 1,
  GET_CHUNK: 2,
  PUT_CHUNK: 3,
} as const
const HostToLedger = {
  START: 0,
  GET_CHUNK_RESPONSE_SUCCESS: 1,
  GET_CHUNK_RESPONSE_FAILURE: 2,
  PUT_CHUNK_RESPONSE: 3,
  RESULT_ACCUMULATING_RESPONSE: 4,
} as const

/**
 * Minimal client for the "Sui" Ledger application, speaking the device APDU protocol directly.
 *
 * The device holds the private key and computes the intent digest itself, so signing is done
 * with raw transaction bytes (as in the official mysten ledgerjs-hw-app-sui package, whose
 * dependency chain is not Node-ESM compatible).
 */
export class SuiLedgerClient {
  readonly transport: LedgerTransport

  /**
   * Creates a SuiLedgerClient over an open HID transport.
   */
  constructor(transport: LedgerTransport) {
    this.transport = transport
  }

  /**
   * Retrieves the public key associated with a BIP32 path from the Ledger Sui app.
   * @param path - BIP32 derivation path.
   * @returns Raw 32-byte Ed25519 public key.
   */
  async getPublicKey(path: string): Promise<Uint8Array> {
    const response = await this.sendChunks(INS_GET_PUBLIC_KEY, [bip32PathPayload(path)])
    const keySize = response[0]!
    return response.subarray(1, 1 + keySize)
  }

  /**
   * Signs a serialized Sui transaction on the Ledger device. The device
   * blake2b-hashes exactly the bytes it receives (after its 4-byte length
   * prefix) and signs the hash, so callers pass the intent message bytes
   * (`intent prefix || TransactionData`).
   * @param path - BIP32 derivation path.
   * @param txn - Intent-message-encoded transaction bytes to sign.
   * @returns Raw 64-byte Ed25519 signature.
   */
  async signTransaction(path: string, txn: Uint8Array): Promise<Uint8Array> {
    const len = Buffer.alloc(4)
    len.writeUInt32LE(txn.length, 0)
    const response = await this.sendChunks(INS_SIGN_TRANSACTION, [
      Buffer.concat([len, Buffer.from(txn)]),
      bip32PathPayload(path),
    ])
    return response
  }

  /** Terminates the Ledger connection. */
  async close() {
    await this.transport.close()
  }

  /**
   * Sends payloads as a SHA-256 linked list of 180-byte chunks, and collects the
   * device's chunked result until the RESULT_FINAL frame is received.
   */
  private async sendChunks(ins: number, payloads: Uint8Array[]): Promise<Buffer> {
    const blocks = new Map<string, Buffer>()
    const roots: Buffer[] = []
    for (const payload of payloads) {
      let lastHash = Buffer.alloc(32)
      for (let i = payload.length; i > 0; i -= CHUNK_SIZE) {
        const chunk = Buffer.from(payload.slice(Math.max(0, i - CHUNK_SIZE), i))
        const linkedChunk = Buffer.concat([lastHash, chunk])
        lastHash = sha256(linkedChunk)
        blocks.set(lastHash.toString('hex'), linkedChunk)
      }
      roots.push(lastHash)
    }

    let payload = Buffer.concat([Buffer.from([HostToLedger.START]), ...roots])
    let result = Buffer.alloc(0)
    for (;;) {
      const rv = await this.transport.send(LEDGER_CLA, ins, 0, 0, payload)
      const rvInstruction = rv[0]
      // The HID transport returns the response with its 2 status bytes
      // appended; strip them before using the frame payload.
      const rvPayload = rv.slice(1, rv.length - 2)
      switch (rvInstruction) {
        case LedgerToHost.RESULT_ACCUMULATING:
        case LedgerToHost.RESULT_FINAL:
          result = Buffer.concat([result, rvPayload])
          payload = Buffer.from([HostToLedger.RESULT_ACCUMULATING_RESPONSE])
          break
        case LedgerToHost.GET_CHUNK: {
          const chunk = blocks.get(rvPayload.toString('hex'))
          payload = chunk
            ? Buffer.concat([Buffer.from([HostToLedger.GET_CHUNK_RESPONSE_SUCCESS]), chunk])
            : Buffer.from([HostToLedger.GET_CHUNK_RESPONSE_FAILURE])
          break
        }
        case LedgerToHost.PUT_CHUNK: {
          blocks.set(sha256(rvPayload).toString('hex'), rvPayload)
          payload = Buffer.from([HostToLedger.PUT_CHUNK_RESPONSE])
          break
        }
        default:
          throw new Error(
            `Unknown instruction ${rvInstruction} received from Ledger Sui app. ` +
              'Is the Sui app on the Ledger device up to date?',
          )
      }
      if (rvInstruction === LedgerToHost.RESULT_FINAL) return result
    }
  }
}

/** Builds the BIP32 path APDU payload ([count, u32le components] with hardened bit). */
function bip32PathPayload(path: string): Buffer {
  const components: number[] = []
  for (const element of path.split('/')) {
    const number = parseInt(element, 10)
    if (isNaN(number)) continue
    components.push(element.endsWith("'") ? number + 0x80000000 : number)
  }
  const payload = Buffer.alloc(1 + components.length * 4)
  payload[0] = components.length
  components.forEach((element, index) => {
    payload.writeUInt32LE(element, 1 + index * 4)
  })
  return payload
}

function sha256(data: Uint8Array): Buffer<ArrayBuffer> {
  return createHash('sha256').update(data).digest()
}

/**
 * Ledger hardware wallet signer for Sui.
 *
 * Unlike a {@link Signer} backed by a local keypair, the device holds the private key and
 * computes the intent digest itself, so signing must always go through {@link signTransaction}
 * with the raw transaction bytes. The abstract `sign` is intentionally unsupported.
 */
export class SuiLedgerSigner extends Signer {
  readonly ledger: SuiLedgerClient
  readonly derivationPath: string
  readonly #publicKey: Ed25519PublicKey

  /**
   * Private constructor - use static `create` method instead.
   * @internal
   */
  private constructor(ledger: SuiLedgerClient, derivationPath: string, publicKey: Uint8Array) {
    super()
    this.ledger = ledger
    this.derivationPath = derivationPath
    this.#publicKey = new Ed25519PublicKey(publicKey)
  }

  /**
   * Creates a new SuiLedgerSigner instance.
   * @param derivationPath - BIP44 derivation path.
   * @param logger - Optional logger (falls back to console).
   * @returns A new SuiLedgerSigner instance.
   */
  static async create(derivationPath: string, logger: Logger = console) {
    const transport = await HIDTransport.default.create()
    const ledger = new SuiLedgerClient(transport)
    // Retrieves the public key from the device; the device does not need to sign here.
    const publicKey = await ledger.getPublicKey(derivationPath)
    const signer = new SuiLedgerSigner(ledger, derivationPath, publicKey)
    logger.info(
      'Ledger connected:',
      signer.toSuiAddress(),
      ', derivationPath:',
      signer.derivationPath,
    )
    return signer
  }

  /**
   * Signs raw transaction bytes on the Ledger device, and returns the serialized
   * Sui signature.
   *
   * The device blake2b-hashes exactly the bytes it is given (after the length
   * prefix) and signs that hash, so the 3-byte `TransactionData` intent prefix
   * must be prepended here — the signature is then over
   * `blake2b(intent || transactionBytes)`, which is what the node verifies.
   * (Same as the official `LedgerSigner` from `@mysten/sui`.)
   * @param bytes - Serialized TransactionData bytes (without intent).
   * @returns Base64 transaction bytes and serialized signature.
   */
  override async signTransaction(bytes: Uint8Array): Promise<SignatureWithBytes> {
    const intentMessage = messageWithIntent('TransactionData', bytes)
    const signature = await this.ledger.signTransaction(this.derivationPath, intentMessage)
    return {
      bytes: toBase64(bytes),
      signature: toSerializedSignature({
        signature,
        signatureScheme: this.getKeyScheme(),
        publicKey: this.getPublicKey(),
      }),
    }
  }

  /**
   * Signing raw bytes is not supported on Ledger: the device only signs transaction
   * bytes (with intent handling) via {@link signTransaction}.
   */
  sign(_data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    throw new CCIPNotImplementedError('Ledger sign for raw bytes (use signTransaction instead)')
  }

  /** {@inheritDoc Signer.getKeyScheme} */
  getKeyScheme(): SignatureScheme {
    return 'ED25519'
  }

  /** {@inheritDoc Signer.getPublicKey} */
  getPublicKey(): PublicKey {
    return this.#publicKey
  }
}

/**
 * Loads a Sui wallet from the provided options.
 * @param wallet - wallet options (as passed from yargs argv)
 * @returns Promise to Sui wallet instance (Signer)
 */
export async function loadSuiWallet(
  { wallet: walletOpt, interactive }: { wallet?: unknown; interactive?: boolean },
  logger: Logger = console,
): Promise<Signer> {
  if (typeof walletOpt !== 'string') throw new CCIPArgumentInvalidError('wallet', String(walletOpt))
  if (walletOpt.startsWith('ledger')) {
    if (interactive === false) {
      throw new CCIPInteractiveRequiredError('Ledger wallet requires USB interaction', {
        recovery:
          'Use a private key or keystore wallet with password env var for non-interactive mode',
      })
    }
    let derivationPath = walletOpt.split(':')[1]
    if (!derivationPath) derivationPath = SUI_LEDGER_DEFAULT_PATH
    else if (!isNaN(Number(derivationPath))) derivationPath = `m/44'/784'/${derivationPath}'/0'/0'`
    return await SuiLedgerSigner.create(derivationPath, logger)
  }
  // bech32 secret keys (`suiprivkey1...`, 33 bytes after decode: flag + seed)
  const trimmed = walletOpt.trim()
  if (/^suiprivkey/i.test(trimmed)) {
    return Ed25519Keypair.fromSecretKey(trimmed)
  }

  // raw 32-byte secret key seed as hex, with or without 0x prefix
  let keyBytes: Uint8Array
  try {
    keyBytes = bytesToBuffer(walletOpt)
  } catch (e) {
    throw new CCIPArgumentInvalidError(
      'wallet',
      `expects a raw 32-byte hex secret key, a suiprivkey bech32 string, or 'ledger[:path]' (got: ${walletOpt.slice(0, 12)}...). ${(e as Error).message}`,
    )
  }

  return Ed25519Keypair.fromSecretKey(keyBytes)
}
