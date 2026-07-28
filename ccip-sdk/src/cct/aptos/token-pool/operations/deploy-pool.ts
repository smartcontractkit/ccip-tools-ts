/**
 * Aptos TokenPool `deployPool` operation.
 *
 * Deploys a Move token-pool package (compile → publish CCIPTokenPool → publish
 * pool). This is a **multi-step imperative deploy**: it produces **two sequential
 * publish transactions** where the second depends on the object created by the
 * first, so the single-tx base {@link AptosOperation.execute} is insufficient and
 * {@link DeployPool.execute} is overridden.
 *
 * **Requires the `aptos` CLI** — the Move source is compiled at deploy time.
 *
 * @packageDocumentation
 */

import { Buffer } from 'buffer'

import {
  AccountAddress,
  buildTransaction,
  createObjectAddress,
  generateTransactionPayloadWithABI,
  parseTypeTag,
} from '@aptos-labs/ts-sdk'

import type { AptosChain } from '../../../../aptos/index.ts'
import { type UnsignedAptosTx, isAptosAccount } from '../../../../aptos/types.ts'
import { CCIPPoolDeployFailedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import type { AptosDeployPoolParams } from '../../../../token-admin/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import {
  compilePoolPackages,
  ensureAptosCli,
  poolLabel,
  resolveCodeObjectAddress,
  resolveNamedAddresses,
  validatePoolParams,
} from '../../common.ts'
import {
  type AptosExecuteParams,
  type AptosGenerateParams,
  AptosOperation,
} from '../../operation.ts'
import { submit } from '../../submit.ts'

/** Domain separator used by `object_code_deployment::publish` to derive object addresses. */
const OBJECT_CODE_DEPLOYMENT_DOMAIN = 'aptos_framework::object_code_deployment'

/**
 * Parameters for deploying an Aptos CCIP token pool.
 *
 * Alias of the legacy {@link AptosDeployPoolParams}: `poolType`, `tokenAddress`,
 * `localTokenDecimals`, plus Aptos-specific `tokenModule`, `routerAddress`,
 * `mcmsAddress`, and optional `adminAddress`.
 */
export type DeployPoolParams = AptosDeployPoolParams

/** Parameters for unsigned Aptos TokenPool `deployPool` generation (carries `sender`). */
export type GenerateDeployPoolParams = AptosGenerateParams<DeployPoolParams>

/** Unsigned Aptos TokenPool `deployPool` result — two sequential publish transactions. */
export type GenerateDeployPoolResult = UnsignedAptosTx

/** Parameters for executing Aptos TokenPool `deployPool` (signs with `wallet`). */
export type ExecuteDeployPoolParams = AptosExecuteParams<DeployPoolParams>

/** Result of executing Aptos TokenPool `deployPool`: the last tx hash and the pool object address. */
export type ExecuteDeployPoolResult = TransactionHash & {
  /** Deployed pool object address (Aptos hex). */
  poolAddress: string
  /**
   * Whether the pool is ready for use. `false` for generic pools
   * (`burn_mint`/`lock_release`), which still require the token creator module to
   * call `initialize()` with the stored capability refs before CCIP operations.
   */
  initialized: boolean
}

/**
 * Aptos TokenPool `deployPool` operation.
 *
 * Compiles and publishes a Move token-pool package in two sequential transactions
 * (CCIPTokenPool object first, then the pool object referencing it). Overrides
 * {@link execute} to submit both transactions in order and return the deployed
 * `poolAddress` alongside the last confirmed hash.
 */
export class DeployPool extends AptosOperation<
  DeployPoolParams,
  UnsignedAptosTx,
  ExecuteDeployPoolResult
> {
  readonly name = 'deployPool'

  /** Front-checks `tokenAddress`, then delegates to {@link validatePoolParams}. */
  protected validate(params: GenerateDeployPoolParams): void {
    if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'tokenAddress', 'must be non-empty')
    }
    validatePoolParams(params)
  }

  /** Compiles the pool packages and builds the two publish transactions. */
  protected async buildUnsigned(
    chain: AptosChain,
    params: GenerateDeployPoolParams,
  ): Promise<UnsignedAptosTx> {
    const { tx } = await this.prepare(chain, params)
    return tx
  }

  /**
   * Compiles both pool packages and builds the two sequential publish transactions.
   *
   * Derives the two deterministic object addresses (`seq+1` → CCIPTokenPool,
   * `seq+2` → pool), resolves the token code object for managed/regulated pools,
   * compiles via the `aptos` CLI, and builds the publish payloads.
   */
  private async prepare(
    chain: AptosChain,
    params: GenerateDeployPoolParams,
  ): Promise<{ tx: UnsignedAptosTx; poolAddress: string }> {
    const tokenModule = validatePoolParams(params)
    ensureAptosCli()

    const { sender } = params

    // We need 2 sequential object addresses:
    //   seq+1 → CCIPTokenPool object
    //   seq+2 → pool object
    const { sequence_number } = await chain.provider.getAccountInfo({ accountAddress: sender })
    const sequenceNumber = BigInt(sequence_number)

    const domainBytes = Buffer.from(OBJECT_CODE_DEPLOYMENT_DOMAIN, 'utf8')
    const uleb = Buffer.from([domainBytes.length])

    // Object address for CCIPTokenPool (seq + 1)
    const seqBuf1 = Buffer.alloc(8)
    seqBuf1.writeBigUInt64LE(sequenceNumber + 1n)
    const tokenPoolObjectAddress = createObjectAddress(
      AccountAddress.from(sender),
      new Uint8Array(Buffer.concat([uleb, domainBytes, seqBuf1])),
    ).toString()

    // Object address for the pool (seq + 2)
    const seqBuf2 = Buffer.alloc(8)
    seqBuf2.writeBigUInt64LE(sequenceNumber + 2n)
    const poolObjectAddress = createObjectAddress(
      AccountAddress.from(sender),
      new Uint8Array(Buffer.concat([uleb, domainBytes, seqBuf2])),
    ).toString()

    const label = poolLabel(tokenModule, params.poolType)

    chain.logger.debug(
      `${this.name}: ${label} tokenPool =`,
      tokenPoolObjectAddress,
      'pool =',
      poolObjectAddress,
    )

    // For managed/regulated pools, resolve the code object address from the FA metadata
    // by walking the Aptos object ownership chain on-chain.
    // Generic pools use tokenAddress (FA metadata) directly as a named address.
    let tokenCodeObjectAddress: string | undefined
    if (tokenModule === 'managed' || tokenModule === 'regulated') {
      tokenCodeObjectAddress = await resolveCodeObjectAddress(chain.provider, params.tokenAddress)
      chain.logger.debug(
        `${this.name}: resolved code object =`,
        tokenCodeObjectAddress,
        'from FA metadata =',
        params.tokenAddress,
      )
    }

    const namedAddresses = resolveNamedAddresses(
      tokenPoolObjectAddress,
      poolObjectAddress,
      tokenModule,
      params.poolType,
      params,
      tokenCodeObjectAddress,
    )

    const { tokenPool, pool } = await compilePoolPackages(
      tokenPoolObjectAddress,
      poolObjectAddress,
      tokenModule,
      params.poolType,
      namedAddresses,
      chain.logger,
    )

    // Build 2 publish transactions (sequential: token_pool first, then pool)
    const buildPublishTx = (
      compiled: { metadataBytes: string; byteCode: string[] },
      seq: bigint,
    ) => {
      const payload = generateTransactionPayloadWithABI({
        function: '0x1::object_code_deployment::publish',
        functionArguments: [
          Buffer.from(compiled.metadataBytes.replace(/^0x/, ''), 'hex'),
          compiled.byteCode.map((b) => Buffer.from(b.replace(/^0x/, ''), 'hex')),
        ],
        abi: {
          typeParameters: [],
          parameters: [parseTypeTag('vector<u8>'), parseTypeTag('vector<vector<u8>>')],
        },
      })
      return buildTransaction({
        aptosConfig: chain.provider.config,
        sender,
        payload,
        options: { accountSequenceNumber: seq },
      })
    }

    const tokenPoolTx = await buildPublishTx(tokenPool, sequenceNumber)
    const poolTx = await buildPublishTx(pool, sequenceNumber + 1n)

    chain.logger.debug(
      `${this.name}: ${label} sender =`,
      sender,
      'tokenPool =',
      tokenPoolObjectAddress,
      'pool =',
      poolObjectAddress,
      'transactions = 2',
    )

    return {
      tx: {
        family: ChainFamily.Aptos,
        transactions: [tokenPoolTx.bcsToBytes(), poolTx.bcsToBytes()],
      },
      poolAddress: poolObjectAddress,
    }
  }

  /**
   * Compiles, publishes, and initializes the pool by submitting the two publish
   * transactions sequentially, returning the deployed `poolAddress` and last hash.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid Aptos account
   * @throws {@link CCIPPoolDeployFailedError} if compilation or any publish tx fails
   */
  override async execute(
    chain: AptosChain,
    params: ExecuteDeployPoolParams,
  ): Promise<ExecuteDeployPoolResult> {
    const { wallet } = params
    if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

    const { wallet: _wallet, ...rest } = params
    const sender = wallet.accountAddress.toString()
    const genParams: GenerateDeployPoolParams = { ...rest, sender }

    this.validate(genParams)

    const { tx, poolAddress } = await this.prepare(chain, genParams)

    const tokenModule = params.tokenModule ?? 'managed'
    const label = poolLabel(tokenModule, params.poolType)
    chain.logger.debug(
      `${this.name}: deploying ${label}...`,
      tx.transactions.length,
      'transactions',
    )

    try {
      let lastHash = ''
      for (const [i, txn] of tx.transactions.entries()) {
        const { hash } = await submit(chain, wallet, [txn], this.name)
        lastHash = hash
        chain.logger.debug(`${this.name}: tx ${i + 1}/${tx.transactions.length} confirmed:`, hash)
      }

      // Generic pools (burn_mint / lock_release) are NOT usable until the token
      // creator module calls initialize() with the stored capability refs.
      if (tokenModule === 'generic') {
        const poolModule =
          params.poolType === 'burn-mint' ? 'burn_mint_token_pool' : 'lock_release_token_pool'
        chain.logger.warn(
          `${this.name}: Generic pool deployed but NOT initialized. ` +
            `The token creator module must call ${poolModule}::initialize() ` +
            `with the stored capability refs (BurnRef/MintRef/TransferRef) ` +
            `before the pool can be used for CCIP operations.`,
        )
      }

      chain.logger.info(`${this.name}: pool at`, poolAddress, 'tx =', lastHash)

      return { hash: lastHash, poolAddress, initialized: tokenModule !== 'generic' }
    } catch (error) {
      if (error instanceof CCIPPoolDeployFailedError) throw error
      throw new CCIPPoolDeployFailedError(error instanceof Error ? error.message : String(error), {
        cause: error instanceof Error ? error : undefined,
      })
    }
  }
}
