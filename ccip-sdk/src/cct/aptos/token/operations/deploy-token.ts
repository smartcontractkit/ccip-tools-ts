/**
 * Aptos ManagedToken `deployToken` operation.
 *
 * Deploys a CCIP-compatible `managed_token` Fungible Asset by compiling the Move
 * source with the deployer's deterministic object address, publishing it, calling
 * `initialize`, and — when `initialSupply > 0` — pre-minting the initial supply to
 * the recipient (or the deployer). This is an imperative **multi-step** deploy: each
 * transaction depends on the previous one, so {@link execute} is overridden to sign
 * and submit them sequentially rather than using the single-tx base flow.
 *
 * **Node.js/CLI only** — Move compilation requires the `aptos` CLI plus filesystem
 * and child-process access, so it cannot run in a browser. See the module docs on the
 * legacy `AptosTokenAdmin` for the backend-relay pattern for frontend integration.
 *
 * @packageDocumentation
 */

import { Buffer } from 'buffer'

import {
  buildTransaction,
  generateTransactionPayloadWithABI,
  parseTypeTag,
} from '@aptos-labs/ts-sdk'

import type { AptosChain } from '../../../../aptos/index.ts'
import { type UnsignedAptosTx, isAptosAccount } from '../../../../aptos/types.ts'
import { CCIPTokenDeployFailedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import {
  compilePackage,
  computeObjectAddress,
  deriveFungibleAssetAddress,
  ensureAptosCli,
  validateParams,
} from '../../common.ts'
import {
  type AptosExecuteParams,
  type AptosGenerateParams,
  AptosOperation,
} from '../../operation.ts'
import { submit } from '../../submit.ts'

/** Parameters shared by Aptos ManagedToken `deployToken` generation and execution. */
type DeployTokenParams = {
  /** Token display name. Must be non-empty. */
  name: string
  /** Token symbol. Must be non-empty; also seeds the FA metadata address. */
  symbol: string
  /** Token decimals. */
  decimals: number
  /** Maximum supply cap. `undefined` or `0n` means unlimited. */
  maxSupply?: bigint
  /** Amount to pre-mint to `recipient`/deployer. `undefined` or `0n` means none. */
  initialSupply?: bigint
  /** Token icon URI. Passed to `initialize()` as empty string if omitted. */
  icon?: string
  /** Project URL. Passed to `initialize()` as empty string if omitted. */
  project?: string
  /** Recipient for `initialSupply`. Default: sender/deployer address. */
  recipient?: string
}

/** Parameters for unsigned Aptos ManagedToken `deployToken` generation. */
export type GenerateDeployTokenParams = AptosGenerateParams<DeployTokenParams>

/** Unsigned Aptos ManagedToken `deployToken` result (publish → initialize → optional mint). */
export type GenerateDeployTokenResult = UnsignedAptosTx

/** Parameters for executing Aptos ManagedToken `deployToken`. */
export type ExecuteDeployTokenParams = AptosExecuteParams<DeployTokenParams>

/** Result of executing Aptos ManagedToken `deployToken`: primary tx hash + deployed FA address. */
export type ExecuteDeployTokenResult = TransactionHash & {
  /** Deployed fungible-asset (managed_token) metadata address. */
  tokenAddress: string
  /** Deployed code object address (the published `managed_token` package object). */
  codeObjectAddress: string
}

/** Aptos ManagedToken `deployToken` operation — multi-step, preserves initial-supply minting. */
export class DeployToken extends AptosOperation<
  DeployTokenParams,
  GenerateDeployTokenResult,
  ExecuteDeployTokenResult
> {
  readonly name = 'deployToken'

  /** Validates deploy params before any RPC or Move compilation. */
  protected validate(params: GenerateDeployTokenParams): void {
    if (!Number.isInteger(params.decimals) || params.decimals < 0) {
      throw new CCTParamsInvalidError(this.name, 'decimals', 'must be a non-negative integer')
    }
    // Deep name/symbol/supply validation (throws CCIPTokenDeployParamsInvalidError).
    validateParams(params)
  }

  /**
   * Compiles the ManagedToken Move package and builds the sequential deploy
   * transactions: publish → initialize → (optional) mint of `initialSupply`.
   *
   * Each transaction carries an explicit, consecutive account sequence number so
   * they can be signed up-front and submitted in order.
   */
  protected async buildUnsigned(
    chain: AptosChain,
    params: GenerateDeployTokenParams,
  ): Promise<GenerateDeployTokenResult> {
    ensureAptosCli()

    // Step 1: Compute the deterministic object address from sender + sequence number.
    const { objectAddress, sequenceNumber } = await computeObjectAddress(
      chain.provider,
      params.sender,
    )
    let nextSeq = sequenceNumber

    chain.logger.debug(`${this.name}: object address = ${objectAddress}`)

    // Step 2: Compile Move package with the object address as named address.
    const { metadataBytes, byteCode } = await compilePackage(objectAddress, chain.logger)

    // Step 3: Build publish transaction via object_code_deployment::publish.
    const publishPayload = generateTransactionPayloadWithABI({
      function: '0x1::object_code_deployment::publish',
      functionArguments: [
        Buffer.from(metadataBytes.replace(/^0x/, ''), 'hex'),
        byteCode.map((b) => Buffer.from(b.replace(/^0x/, ''), 'hex')),
      ],
      abi: {
        typeParameters: [],
        parameters: [parseTypeTag('vector<u8>'), parseTypeTag('vector<vector<u8>>')],
      },
    })
    const publishTx = await buildTransaction({
      aptosConfig: chain.provider.config,
      sender: params.sender,
      payload: publishPayload,
      options: { accountSequenceNumber: nextSeq++ },
    })

    const transactions: [Uint8Array, ...Uint8Array[]] = [publishTx.bcsToBytes()]

    // Step 4: Build initialize transaction using local ABI (module not yet on-chain).
    // initialize(max_supply: Option<u128>, name, symbol, decimals, icon, project)
    const maxSupply =
      params.maxSupply !== undefined && params.maxSupply > 0n ? params.maxSupply : null

    const initPayload = generateTransactionPayloadWithABI({
      function: `${objectAddress}::managed_token::initialize`,
      functionArguments: [
        maxSupply,
        params.name,
        params.symbol,
        params.decimals,
        params.icon ?? '',
        params.project ?? '',
      ],
      abi: {
        typeParameters: [],
        parameters: [
          parseTypeTag('0x1::option::Option<u128>'),
          parseTypeTag('0x1::string::String'),
          parseTypeTag('0x1::string::String'),
          parseTypeTag('u8'),
          parseTypeTag('0x1::string::String'),
          parseTypeTag('0x1::string::String'),
        ],
      },
    })
    const initTx = await buildTransaction({
      aptosConfig: chain.provider.config,
      sender: params.sender,
      payload: initPayload,
      options: { accountSequenceNumber: nextSeq++ },
    })
    transactions.push(initTx.bcsToBytes())

    // Step 5: Build mint transaction (only if initialSupply > 0) — PRESERVED for parity.
    const initialSupply = params.initialSupply ?? 0n
    if (initialSupply > 0n) {
      const recipient = params.recipient ?? params.sender
      const mintPayload = generateTransactionPayloadWithABI({
        function: `${objectAddress}::managed_token::mint`,
        functionArguments: [recipient, initialSupply.toString()],
        abi: {
          typeParameters: [],
          parameters: [parseTypeTag('address'), parseTypeTag('u64')],
        },
      })
      const mintTx = await buildTransaction({
        aptosConfig: chain.provider.config,
        sender: params.sender,
        payload: mintPayload,
        options: { accountSequenceNumber: nextSeq },
      })
      transactions.push(mintTx.bcsToBytes())
    }

    chain.logger.debug(
      `${this.name}: sender = ${params.sender}, object = ${objectAddress}, transactions = ${transactions.length}`,
    )
    return { family: ChainFamily.Aptos, transactions }
  }

  /**
   * Signs and submits the deploy transactions in order (publish → initialize →
   * optional mint), then returns the primary (publish) hash and the deployed FA
   * metadata address. Overrides the single-tx base flow because deploy is a
   * dependent, multi-step sequence.
   */
  override async execute(
    chain: AptosChain,
    params: ExecuteDeployTokenParams,
  ): Promise<ExecuteDeployTokenResult> {
    const { wallet } = params
    if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.accountAddress.toString()
    const { wallet: _wallet, ...rest } = params
    const genParams: GenerateDeployTokenParams = { ...rest, sender }

    // Derive the deployed FA metadata address (deterministic from sender + symbol).
    const { objectAddress } = await computeObjectAddress(chain.provider, sender)
    const tokenAddress = deriveFungibleAssetAddress(objectAddress, params.symbol)

    // Validate + compile + build the sequential transactions.
    const unsigned = await this.generate(chain, genParams)

    chain.logger.debug(
      `${this.name}: deploying ManagedToken, ${unsigned.transactions.length} transactions`,
    )

    try {
      let firstHash = ''
      for (let i = 0; i < unsigned.transactions.length; i++) {
        const bytes = unsigned.transactions[i]
        if (bytes === undefined) continue
        const { hash } = await submit(chain, wallet, [bytes], this.name)
        if (i === 0) firstHash = hash
        chain.logger.debug(`${this.name}: tx ${i} confirmed: ${hash}`)
      }

      chain.logger.info(`${this.name}: FA at ${tokenAddress}, tx = ${firstHash}`)
      return { hash: firstHash, tokenAddress, codeObjectAddress: objectAddress }
    } catch (error) {
      if (error instanceof CCIPTokenDeployFailedError) throw error
      throw new CCIPTokenDeployFailedError(error instanceof Error ? error.message : String(error), {
        cause: error instanceof Error ? error : undefined,
      })
    }
  }
}
