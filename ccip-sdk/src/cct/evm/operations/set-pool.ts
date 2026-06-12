/**
 * `setPool` — registers a pool for a token in the TokenAdminRegistry.
 * Version-independent (v1.5/v1.6/v2.0 share one encoding).
 *
 * @packageDocumentation
 */

import { type TransactionRequest, Interface } from 'ethers'

import TokenAdminRegistryABI from '../../../evm/abi/TokenAdminRegistry_1_5.ts'
import type { EVMChain } from '../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../evm/types.ts'
import { ChainFamily } from '../../../networks.ts'
import type { CctTxResult } from '../../token-manager.ts'
import { submit } from '../submit.ts'
import { validateAddress } from '../validate.ts'

export const OPERATION = 'setPool'

/** Parameters for `setPool`. */
export type SetPoolParams = {
  tokenAddress: string
  /** Pool to register; zero address delists the token. */
  poolAddress: string
  /** Router — used to discover the TokenAdminRegistry. */
  routerAddress: string
}

/** Result of `setPool`. */
export type SetPoolResult = CctTxResult

/**
 * Validates {@link SetPoolParams} before any RPC.
 * @throws {@link CCIPCctParamsInvalidError} if any address is invalid
 */
function validate(params: SetPoolParams): void {
  validateAddress(OPERATION, 'tokenAddress', params.tokenAddress)
  validateAddress(OPERATION, 'poolAddress', params.poolAddress)
  validateAddress(OPERATION, 'routerAddress', params.routerAddress)
}

/** Encodes the `setPool(localToken, pool)` calldata. */
export function encode(params: SetPoolParams): string {
  return new Interface(TokenAdminRegistryABI).encodeFunctionData('setPool', [
    params.tokenAddress,
    params.poolAddress,
  ])
}

/**
 * Builds an unsigned `setPool` tx on the discovered TokenAdminRegistry; set
 * `sender` to populate `from`.
 * @throws {@link CCIPCctParamsInvalidError} if any param is invalid
 */
export async function generate(
  chain: EVMChain,
  opts: SetPoolParams & { sender?: string },
): Promise<UnsignedEVMTx> {
  validate(opts)

  const to = await chain.getTokenAdminRegistryFor(opts.routerAddress)
  const tx: TransactionRequest = { to, data: encode(opts) }
  if (opts.sender) tx.from = opts.sender

  chain.logger.debug(
    `${OPERATION}: TAR = ${to}, token = ${opts.tokenAddress}, pool = ${opts.poolAddress}`,
  )
  return { family: ChainFamily.EVM, transactions: [tx] }
}

/**
 * Builds and submits `setPool` with `opts.wallet` (the token admin).
 * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
 * @throws {@link CCIPCctParamsInvalidError} if any param is invalid
 * @throws {@link CCIPCctTxFailedError} if the tx reverts or fails
 */
export async function execute(
  chain: EVMChain,
  opts: SetPoolParams & { wallet: unknown },
): Promise<SetPoolResult> {
  const { wallet, ...params } = opts
  const unsigned = await generate(chain, params)
  return submit(chain, wallet, unsigned, OPERATION)
}
