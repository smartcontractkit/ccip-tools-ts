/**
 * deployToken — deploys a CCT token via raw init-code, selected by `version`:
 * `2.0.0` (the default) deploys `CrossChainToken`; `1.5.1` / `1.6.2` deploy `FactoryBurnMintERC20`.
 * The tx has no `to`; `execute` returns the deployed contract address.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import type { DeployResult } from '../../../operation.ts'
import { EVMOperation, deploymentTx } from '../../operation.ts'
import { submit } from '../../submit.ts'
import {
  validateAddress,
  validateNonEmptyString,
  validateUint256,
  validateUint8,
} from '../../validate.ts'
import { TokenVersion, tokenArtifact } from '../version.ts'

/** Constructor params common to every deployable token version. */
interface BaseTokenParams {
  name: string
  symbol: string
  decimals: number
  /** Max supply cap; `0n` means unlimited. */
  maxSupply: bigint
  /** Amount minted at deploy; defaults to `0n`. Must be `<= maxSupply` when capped. */
  preMint?: bigint
  /** Receives ownership (and, on `FactoryBurnMintERC20`, any `preMint`); a valid address. */
  owner: string
  sender?: string
}

/** Params for token versions `1.5.1` / `1.6.2` — deploys `FactoryBurnMintERC20`. */
export interface FactoryBurnMintERC20Params extends BaseTokenParams {
  version: typeof TokenVersion.V1_5_1 | typeof TokenVersion.V1_6_2
}

/** Params for token version `2.0.0` (the default) — deploys `CrossChainToken`. */
export interface CrossChainTokenParams extends BaseTokenParams {
  version?: typeof TokenVersion.V2_0_0
  /** Recipient of `preMint`; defaults to `owner`. */
  preMintRecipient?: string
  /** CCIP admin (`getCCIPAdmin`); defaults to `owner`. */
  ccipAdmin?: string
  /** Admin of the burn/mint roles; defaults to `owner`. */
  burnMintRoleAdmin?: string
}

/**
 * Parameters for {@link DeployToken}, discriminated on `version`. Omitting `version`
 * deploys `CrossChainToken` (v2.0.0).
 */
export type DeployTokenParams = CrossChainTokenParams | FactoryBurnMintERC20Params

// --- Per-version constructor-arg encoders (the constructors differ across versions) ---

/** Encodes the `FactoryBurnMintERC20` (v1.5.1) constructor args. */
function encodeFactoryBurnMintERC20(iface: Interface, p: FactoryBurnMintERC20Params): string {
  return iface.encodeDeploy([p.name, p.symbol, p.decimals, p.maxSupply, p.preMint ?? 0n, p.owner])
}

/** Encodes the `CrossChainToken` (v2.0.0) constructor args; admin/recipient default to `owner`. */
function encodeCrossChainToken(iface: Interface, p: CrossChainTokenParams): string {
  return iface.encodeDeploy([
    [
      p.name,
      p.symbol,
      p.maxSupply,
      p.preMint ?? 0n,
      p.preMintRecipient ?? p.owner,
      p.decimals,
      p.ccipAdmin ?? p.owner,
    ],
    p.burnMintRoleAdmin ?? p.owner,
    p.owner,
  ])
}

// --- Per-version validators (shared base checks + version-specific extras) ---

/** Validates the params common to every token version. */
function validateBaseTokenParams(op: string, p: BaseTokenParams): void {
  validateNonEmptyString(op, 'name', p.name)
  validateNonEmptyString(op, 'symbol', p.symbol)
  validateUint8(op, 'decimals', p.decimals)
  validateUint256(op, 'maxSupply', p.maxSupply)
  const preMint = p.preMint ?? 0n
  validateUint256(op, 'preMint', preMint)
  validateAddress(op, 'owner', p.owner)
  if (p.maxSupply !== 0n && preMint > p.maxSupply)
    throw new CCTParamsInvalidError(
      op,
      'preMint',
      `must be <= maxSupply (${p.maxSupply}), got ${preMint}`,
    )
}

/** Validates `FactoryBurnMintERC20` (v1.5.1) deploy params. */
function validateFactoryBurnMintERC20(op: string, p: FactoryBurnMintERC20Params): void {
  validateBaseTokenParams(op, p)
}

/** Validates `CrossChainToken` (v2.0.0) deploy params; admin/recipient default to `owner`. */
function validateCrossChainToken(op: string, p: CrossChainTokenParams): void {
  validateBaseTokenParams(op, p)
  if (p.preMintRecipient !== undefined) validateAddress(op, 'preMintRecipient', p.preMintRecipient)
  if (p.ccipAdmin !== undefined) validateAddress(op, 'ccipAdmin', p.ccipAdmin)
  if (p.burnMintRoleAdmin !== undefined)
    validateAddress(op, 'burnMintRoleAdmin', p.burnMintRoleAdmin)
}

/** Deploys a CCT token (version-selected); `execute` resolves to `{ hash, address }`. */
export class DeployToken extends EVMOperation<DeployTokenParams> {
  readonly name = 'deployToken'

  /** Validates the constructor params before building init-code (dispatched by `version`). */
  protected validate(params: DeployTokenParams): void {
    if (params.version !== undefined && !Object.values(TokenVersion).includes(params.version))
      throw new CCTParamsInvalidError(
        this.name,
        'version',
        `unsupported token version ${params.version}`,
      )
    switch (params.version) {
      case TokenVersion.V1_5_1:
      case TokenVersion.V1_6_2:
        return validateFactoryBurnMintERC20(this.name, params)
      case undefined: // default → CrossChainToken v2.0.0
      case TokenVersion.V2_0_0:
        return validateCrossChainToken(this.name, params)
    }
  }

  /** Builds a deployment tx (no `to`): creation bytecode + ABI-encoded constructor args. */
  protected buildUnsigned(_chain: EVMChain, params: DeployTokenParams): UnsignedEVMTx {
    switch (params.version) {
      case TokenVersion.V1_5_1:
      case TokenVersion.V1_6_2: {
        const { iface, bytecode } = tokenArtifact(params.version)
        return deploymentTx(bytecode, encodeFactoryBurnMintERC20(iface, params))
      }
      case undefined: // default → CrossChainToken v2.0.0
      case TokenVersion.V2_0_0: {
        const { iface, bytecode } = tokenArtifact(TokenVersion.V2_0_0)
        return deploymentTx(bytecode, encodeCrossChainToken(iface, params))
      }
    }
  }

  /**
   * {@link generate}, then sign and submit; resolves to the tx hash and the newly
   * deployed contract address (read from the mined receipt).
   * @throws {@link CCTTxFailedError} if the tx mined without producing a contract address
   */
  override async execute(
    chain: EVMChain,
    params: DeployTokenParams & { wallet: unknown },
  ): Promise<DeployResult> {
    const { response, receipt } = await submit(
      chain,
      params.wallet,
      await this.generate(chain, params),
      this.name,
    )
    if (!receipt.contractAddress)
      throw new CCTTxFailedError(this.name, 'deployment produced no contract address', {
        context: { txHash: response.hash },
      })
    return { hash: response.hash, address: receipt.contractAddress }
  }
}
