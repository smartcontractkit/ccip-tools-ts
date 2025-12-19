// TODO: FIXME: Remove local copies and import when chainlink-ton is published as npm package
import type { Address, ContractProvider } from '@ton/core'

/**
 * Represents a ramp (OnRamp or OffRamp) configuration in the Router.
 */
export interface Ramp {
  chainSelector: bigint
  address: Address
}

/**
 * TON Router contract binding.
 * The Router is the main entry point for CCIP on TON. It routes messages to the appropriate
 * OnRamp (for sending) or OffRamp (for receiving) based on the chain selector.
 */
export class Router {
  readonly address: Address

  /**
   * Creates a new Router instance.
   * @param address - The Router contract address on TON.
   */
  constructor(address: Address) {
    this.address = address
  }

  /**
   * Creates a Router instance from a contract address.
   * @param address - The Router contract address on TON.
   * @returns A new Router instance.
   */
  static createFromAddress(address: Address): Router {
    return new Router(address)
  }

  /**
   * Gets the OffRamp address for a given source chain selector.
   * The OffRamp handles incoming messages from the specified source chain.
   *
   * @param provider - TON contract provider for making RPC calls.
   * @param chainSelector - The CCIP chain selector of the source chain.
   * @returns The OffRamp contract address.
   * @throws Error with exitCode 261 if the source chain is not enabled.
   */
  async getOffRamp(provider: ContractProvider, chainSelector: bigint): Promise<Address> {
    return provider
      .get('offRamp', [{ type: 'int', value: chainSelector }])
      .then((r) => r.stack.readAddress())
  }

  /**
   * Gets the OnRamp address for a given destination chain selector.
   * The OnRamp handles outgoing messages to the specified destination chain.
   *
   * @param provider - TON contract provider for making RPC calls.
   * @param destChainSelector - The CCIP chain selector of the destination chain.
   * @returns The OnRamp contract address.
   */
  async getOnRamp(provider: ContractProvider, destChainSelector: bigint): Promise<Address> {
    return provider
      .get('onRamp', [{ type: 'int', value: destChainSelector }])
      .then((r) => r.stack.readAddress())
  }
}
