// TODO: FIXME: Remove local copies when chainlink-ton is published as npm package
import type { Address, ContractProvider } from '@ton/core'

/**
 * Configuration for a source chain on the TON OffRamp contract.
 */
export interface SourceChainConfig {
  router: Address
  isEnabled: boolean
  minSeqNr: bigint
  isRMNVerificationDisabled: boolean
  onRamp: Buffer
}

/**
 * Dynamic configuration for the OffRamp contract.
 * Contains addresses that can be updated without redeploying the contract.
 */
export interface DynamicConfig {
  router: Address
  feeQuoter: Address
  permissionlessExecutionThresholdSeconds: number
}

/**
 * TON OffRamp contract binding.
 * The OffRamp receives and executes cross-chain messages on the destination (TON) chain.
 * In CCIP v1.6, the OffRamp also serves as the CommitStore.
 */
export class OffRamp {
  readonly address: Address

  /**
   * Creates a new OffRamp instance.
   * @param address - The OffRamp contract address on TON.
   */
  constructor(address: Address) {
    this.address = address
  }

  /**
   * Creates an OffRamp instance from a contract address.
   * @param address - The OffRamp contract address on TON.
   * @returns A new OffRamp instance.
   */
  static createFromAddress(address: Address): OffRamp {
    return new OffRamp(address)
  }

  /**
   * Retrieves the source chain configuration for a given chain selector.
   * This includes the router, enabled status, sequence number, and the source OnRamp address.
   *
   * @param provider - TON contract provider for making RPC calls.
   * @param sourceChainSelector - The CCIP chain selector of the source chain.
   * @returns The source chain configuration.
   * @throws Error with exitCode 266 if the source chain is not enabled.
   */
  async getSourceChainConfig(
    provider: ContractProvider,
    sourceChainSelector: bigint,
  ): Promise<SourceChainConfig> {
    const result = await provider.get('sourceChainConfig', [
      { type: 'int', value: sourceChainSelector },
    ])

    // Tolk returns struct as tuple
    const router = result.stack.readAddress()
    const isEnabled = result.stack.readBoolean()
    const minSeqNr = result.stack.readBigNumber()
    const isRMNVerificationDisabled = result.stack.readBoolean()

    // onRamp is stored as CrossChainAddress cell
    const onRampCell = result.stack.readCell()
    const onRampSlice = onRampCell.beginParse()

    // Check if length-prefixed or raw format based on cell bit length
    const cellBits = onRampCell.bits.length
    let onRamp: Buffer

    if (cellBits === 160) {
      // Raw 20-byte EVM address (no length prefix)
      onRamp = onRampSlice.loadBuffer(20)
    } else {
      // Length-prefixed format: 8-bit length + data
      const onRampLength = onRampSlice.loadUint(8)
      onRamp = onRampSlice.loadBuffer(onRampLength)
    }

    return {
      router,
      isEnabled,
      minSeqNr,
      isRMNVerificationDisabled,
      onRamp,
    }
  }
}
