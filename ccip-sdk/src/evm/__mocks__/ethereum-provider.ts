/**
 * Mock EIP-1193 provider for testing browser wallet behavior.
 * Used by both ethers.js and viem tests.
 */
import { mock } from 'node:test'

/** Options for creating a mock Ethereum provider */
export interface MockEthereumProviderOptions {
  accounts?: string[]
  chainId?: number
  signMessageResult?: string
  sendTransactionResult?: string
  rejectWith?: { code: number; message: string }
}

/** Mock EIP-1193 provider interface */
export interface MockEthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on: (event: string, callback: (data: unknown) => void) => void
  removeListener: (event: string, callback: (data: unknown) => void) => void
  isMetaMask?: boolean
}

/**
 * Creates a mock EIP-1193 provider that simulates MetaMask/browser wallet behavior.
 * Supports common RPC methods needed for ethers.js and viem tests.
 */
export function createMockEthereumProvider(
  options: MockEthereumProviderOptions = {},
): MockEthereumProvider {
  const accounts = options.accounts ?? ['0x1234567890123456789012345678901234567890']
  const chainId = options.chainId ?? 1

  return {
    isMetaMask: true,
    request: mock.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
      // Simulate user rejection if configured
      if (options.rejectWith) {
        const error = new Error(options.rejectWith.message) as Error & { code: number }
        error.code = options.rejectWith.code
        throw error
      }

      switch (method) {
        case 'eth_chainId':
          return `0x${chainId.toString(16)}`
        case 'net_version':
          return chainId.toString()
        case 'eth_accounts':
        case 'eth_requestAccounts':
          return accounts
        case 'eth_getBalance':
          return '0x1000000000000000' // 0.0625 ETH
        case 'eth_blockNumber':
          return '0x123456'
        case 'eth_getBlockByNumber':
          return {
            number: '0x123456',
            hash: '0x' + '1'.repeat(64),
            timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16),
            gasLimit: '0x1c9c380',
            gasUsed: '0x0',
            baseFeePerGas: '0x3b9aca00',
          }
        case 'eth_gasPrice':
          return '0x3b9aca00' // 1 gwei
        case 'eth_maxPriorityFeePerGas':
          return '0x3b9aca00' // 1 gwei
        case 'eth_estimateGas':
          return '0x5208' // 21000
        case 'eth_getTransactionCount':
          return '0x0'
        case 'personal_sign':
        case 'eth_sign':
          return options.signMessageResult ?? '0x' + '1'.repeat(130)
        case 'eth_signTypedData_v4':
          return '0x' + '3'.repeat(130)
        case 'eth_sendTransaction':
          return options.sendTransactionResult ?? '0x' + '2'.repeat(64)
        case 'eth_getTransactionReceipt':
          return {
            transactionHash: params?.[0] ?? '0x' + '2'.repeat(64),
            blockNumber: '0x123456',
            blockHash: '0x' + '1'.repeat(64),
            status: '0x1',
            gasUsed: '0x5208',
          }
        case 'eth_call':
          return '0x'
        case 'eth_getLogs':
          return []
        case 'eth_getCode':
          return '0x'
        case 'eth_getStorageAt':
          return '0x0000000000000000000000000000000000000000000000000000000000000000'
        default:
          // Return null for unknown methods instead of throwing
          // This allows providers to handle missing methods gracefully
          console.log(`Unmocked method: ${method}`)
          return null
      }
    }),
    on: mock.fn(),
    removeListener: mock.fn(),
  }
}

// Global type declaration for window.ethereum
declare global {
  var ethereum: MockEthereumProvider
}
