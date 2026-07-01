/**
 * EVM Cross-Chain Token (CCT) admin operations on the TokenAdminRegistry.
 * {@link EVMTokenManager} wraps an {@link EVMChain}: build with
 * `generateUnsigned<Op>` (sender in opts), then `<op>` with `wallet` in opts.
 *
 * @packageDocumentation
 */

import type { JsonRpcApiProvider } from 'ethers'

import type { ChainContext } from '../../chain.ts'
import { EVMChain } from '../../evm/index.ts'
import type { UnsignedEVMTx } from '../../evm/types.ts'
import type { ChainFamily } from '../../networks.ts'
import { TokenManager } from '../token-manager.ts'
import * as SetPool from './operations/set-pool.ts'

/** CCT admin operations for EVM chains, delegating each op to `./operations`. */
export class EVMTokenManager extends TokenManager<typeof ChainFamily.EVM> {
  readonly chain: EVMChain

  /** Wraps the chain this manager builds and submits through. */
  constructor(chain: EVMChain) {
    super()
    this.chain = chain
  }

  /** Wraps an existing {@link EVMChain}. */
  static fromChain(chain: EVMChain): EVMTokenManager {
    return new EVMTokenManager(chain)
  }

  /** Creates from an ethers provider. */
  static async fromProvider(
    provider: JsonRpcApiProvider,
    ctx?: ChainContext,
  ): Promise<EVMTokenManager> {
    return new EVMTokenManager(await EVMChain.fromProvider(provider, ctx))
  }

  /** Creates from an RPC URL. */
  static async fromUrl(url: string, ctx?: ChainContext): Promise<EVMTokenManager> {
    return new EVMTokenManager(await EVMChain.fromUrl(url, ctx))
  }

  /** Provider of the underlying chain. */
  get provider(): JsonRpcApiProvider {
    return this.chain.provider
  }

  /**
   * Builds an unsigned `setPool` tx (for multisig / offline signing).
   * @throws {@link CCIPCctParamsInvalidError} if any param is invalid
   */
  generateUnsignedSetPool(
    opts: SetPool.SetPoolParams & { sender?: string },
  ): Promise<UnsignedEVMTx> {
    return SetPool.generate(this.chain, opts)
  }

  /**
   * Registers a pool, signing + submitting with `opts.wallet` (the token admin).
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPCctParamsInvalidError} if any param is invalid
   * @throws {@link CCIPCctTxFailedError} if the tx reverts or fails
   */
  setPool(opts: SetPool.SetPoolParams & { wallet: unknown }): Promise<SetPool.SetPoolResult> {
    return SetPool.execute(this.chain, opts)
  }
}
