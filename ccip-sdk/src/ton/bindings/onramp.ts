// TODO: FIXME: Remove local copies when chainlink-ton is published as npm package
import { type Address, type ContractProvider, Dictionary } from '@ton/core'

/**
 * Configuration for a destination chain on the TON OnRamp contract.
 * Contains routing and access control settings for messages going to a specific destination chain.
 */
export interface DestChainConfig {
  router: Address
  sequenceNumber: bigint
  allowlistEnabled: boolean
  allowedSenders: Dictionary<Address, boolean>
}

/**
 * TON OnRamp contract binding.
 * The OnRamp sends cross-chain messages from the source (TON) chain to destination chains.
 * It validates messages, assigns sequence numbers, and emits events for the CCIP network.
 */
export class OnRamp {
  readonly address: Address

  /**
   * Creates a new OnRamp instance.
   * @param address - The OnRamp contract address on TON.
   */
  constructor(address: Address) {
    this.address = address
  }

  /**
   * Creates an OnRamp instance from a contract address.
   * @param address - The OnRamp contract address on TON.
   * @returns A new OnRamp instance.
   */
  static createFromAddress(address: Address): OnRamp {
    return new OnRamp(address)
  }

  /**
   * Retrieves the destination chain configuration for a given chain selector.
   * This includes the router, current sequence number, and allowlist settings.
   *
   * @param provider - TON contract provider for making RPC calls.
   * @param destChainSelector - The CCIP chain selector of the destination chain.
   * @returns The destination chain configuration.
   */
  async getDestChainConfig(
    provider: ContractProvider,
    destChainSelector: bigint,
  ): Promise<DestChainConfig> {
    const { stack } = await provider.get('destChainConfig', [
      { type: 'int', value: destChainSelector },
    ])
    const router = stack.readAddress()
    const sequenceNumber = stack.readBigNumber()
    const allowlistEnabled = stack.readBoolean()
    const allowedSendersCell = stack.readCellOpt()
    return {
      router,
      sequenceNumber,
      allowlistEnabled,
      allowedSenders: allowedSendersCell
        ? Dictionary.loadDirect(
            Dictionary.Keys.Address(),
            Dictionary.Values.Bool(),
            allowedSendersCell,
          )
        : Dictionary.empty(),
    }
  }
}
