import {
  type Provider,
  type TransactionRequest,
  type TransactionResponse,
  type TypedDataDomain,
  type TypedDataField,
  AbstractSigner,
  JsonRpcProvider,
} from 'ethers'
import type { Account, Chain, Transport, WalletClient } from 'viem'

import { CCIPViemAdapterError } from '../../errors/index.ts'

/**
 * Adapter that wraps viem WalletClient as ethers Signer.
 *
 * IMPORTANT: This uses a custom AbstractSigner implementation rather than
 * JsonRpcSigner to properly support LOCAL accounts (privateKeyToAccount).
 * The standard BrowserProvider approach fails for local accounts because
 * eth_accounts RPC call doesn't know about client-side accounts.
 *
 * @see https://github.com/wevm/viem/discussions/2066
 */
class ViemWalletAdapter extends AbstractSigner {
  private readonly walletClient: WalletClient<Transport, Chain, Account>

  /** Creates a new ViemWalletAdapter wrapping the given WalletClient. */
  constructor(walletClient: WalletClient<Transport, Chain, Account>, provider: JsonRpcProvider) {
    super(provider)
    this.walletClient = walletClient
  }

  /** Returns the address of the underlying viem account. */
  override getAddress(): Promise<string> {
    return Promise.resolve(this.walletClient.account.address as string)
  }

  /** Throws an error - viem wallet adapters cannot be reconnected. */
  override connect(_provider: Provider | null): never {
    throw new CCIPViemAdapterError(
      'ViemWalletAdapter cannot be reconnected to a different provider',
    )
  }

  /**
   * Sign a transaction using viem's WalletClient.
   * Required by AbstractSigner but rarely used directly (sendTransaction is more common).
   */
  override async signTransaction(tx: TransactionRequest): Promise<string> {
    const signedTx = await this.walletClient.signTransaction({
      to: tx.to as `0x${string}`,
      data: tx.data as `0x${string}`,
      value: tx.value ? BigInt(tx.value.toString()) : undefined,
      gas: tx.gasLimit ? BigInt(tx.gasLimit.toString()) : undefined,
      nonce: tx.nonce ? Number(tx.nonce) : undefined,
      chain: this.walletClient.chain,
      account: this.walletClient.account,
      ...(tx.maxFeePerGas
        ? {
            maxFeePerGas: BigInt(tx.maxFeePerGas.toString()),
            maxPriorityFeePerGas: tx.maxPriorityFeePerGas
              ? BigInt(tx.maxPriorityFeePerGas.toString())
              : undefined,
          }
        : tx.gasPrice
          ? { gasPrice: BigInt(tx.gasPrice.toString()) }
          : {}),
    })
    return signedTx
  }

  /**
   * Sign a message using viem's WalletClient.
   */
  override async signMessage(message: string | Uint8Array): Promise<string> {
    const messageToSign = typeof message === 'string' ? message : { raw: message }
    return this.walletClient.signMessage({
      account: this.walletClient.account,
      message: messageToSign,
    })
  }

  /**
   * Sign typed data using viem's WalletClient.
   * Converts ethers.js typed data format to viem format.
   */
  override async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ): Promise<string> {
    // Convert ethers domain to viem domain format
    const viemDomain: {
      chainId?: number | bigint
      name?: string
      salt?: `0x${string}`
      verifyingContract?: `0x${string}`
      version?: string
    } = {}

    if (domain.name) viemDomain.name = domain.name
    if (domain.version) viemDomain.version = domain.version
    if (domain.chainId != null) viemDomain.chainId = BigInt(domain.chainId.toString())
    if (domain.verifyingContract)
      viemDomain.verifyingContract = domain.verifyingContract as `0x${string}`
    if (domain.salt) viemDomain.salt = domain.salt as `0x${string}`

    // Convert ethers types to viem types format
    const viemTypes: Record<string, { name: string; type: string }[]> = {}
    for (const [key, fields] of Object.entries(types)) {
      viemTypes[key] = fields.map((f) => ({ name: f.name, type: f.type }))
    }

    return this.walletClient.signTypedData({
      account: this.walletClient.account,
      domain: viemDomain,
      types: viemTypes,
      primaryType: Object.keys(types).find((k) => k !== 'EIP712Domain') || '',
      message: value,
    })
  }

  /**
   * Send a transaction using viem's WalletClient.
   * This delegates directly to viem for signing, avoiding eth_accounts issues.
   */
  override async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    // Build transaction params, handling EIP-1559 vs legacy gas
    const txParams: Parameters<WalletClient<Transport, Chain, Account>['sendTransaction']>[0] = {
      to: tx.to as `0x${string}`,
      data: tx.data as `0x${string}`,
      value: tx.value ? BigInt(tx.value.toString()) : undefined,
      gas: tx.gasLimit ? BigInt(tx.gasLimit.toString()) : undefined,
      nonce: tx.nonce ? Number(tx.nonce) : undefined,
      chain: this.walletClient.chain,
      account: this.walletClient.account,
    }

    // Use EIP-1559 if available, otherwise legacy gasPrice
    if (tx.maxFeePerGas) {
      txParams.maxFeePerGas = BigInt(tx.maxFeePerGas.toString())
      if (tx.maxPriorityFeePerGas) {
        txParams.maxPriorityFeePerGas = BigInt(tx.maxPriorityFeePerGas.toString())
      }
    } else if (tx.gasPrice) {
      txParams.gasPrice = BigInt(tx.gasPrice.toString())
    }

    const hash = await this.walletClient.sendTransaction(txParams)

    // Wait for transaction and return ethers-compatible response
    await this.provider!.waitForTransaction(hash)
    return this.provider!.getTransaction(hash) as Promise<TransactionResponse>
  }
}

/**
 * Convert viem WalletClient to ethers-compatible Signer.
 *
 * Supports both:
 * - Local accounts (privateKeyToAccount, mnemonicToAccount)
 * - JSON-RPC accounts (browser wallets like MetaMask)
 *
 * @param client - viem WalletClient instance with account and chain defined
 * @returns ethers AbstractSigner for use with sendMessage, manuallyExecute, etc.
 *
 * @example
 * ```typescript
 * import { createWalletClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { mainnet } from 'viem/chains'
 * import { fromViemClient, viemWallet } from '@chainlink/ccip-sdk/viem'
 *
 * const account = privateKeyToAccount('0x...')
 * const walletClient = createWalletClient({
 *   chain: mainnet,
 *   transport: http('https://eth.llamarpc.com'),
 *   account,
 * })
 *
 * const chain = await fromViemClient(publicClient)
 * const request = await chain.sendMessage(
 *   router,
 *   destChainSelector,
 *   message,
 *   { wallet: viemWallet(walletClient) }
 * )
 * ```
 */
export function viemWallet(client: WalletClient<Transport, Chain, Account>): AbstractSigner {
  // Validate account is defined
  if (!client.account) {
    throw new CCIPViemAdapterError('WalletClient must have an account defined', {
      recovery: 'Pass an account to createWalletClient or use .extend(walletActions)',
    })
  }

  if (!client.chain) {
    throw new CCIPViemAdapterError('WalletClient must have a chain defined', {
      recovery: 'Pass a chain to createWalletClient: createWalletClient({ chain: mainnet, ... })',
    })
  }

  // Extract RPC URL from transport for read operations
  const transport = client.transport
  let rpcUrl: string | undefined
  if ('url' in transport && typeof transport.url === 'string') {
    rpcUrl = transport.url
  } else if (
    'value' in transport &&
    transport.value &&
    typeof transport.value === 'object' &&
    'url' in transport.value
  ) {
    rpcUrl = (transport.value as { url?: string }).url
  }

  if (!rpcUrl) {
    throw new CCIPViemAdapterError('Could not extract RPC URL from WalletClient transport', {
      recovery: 'Ensure your WalletClient uses http() transport with a URL',
    })
  }

  // Create read-only provider for blockchain queries
  const provider = new JsonRpcProvider(rpcUrl, client.chain.id)

  // Return adapter that delegates signing to viem
  return new ViemWalletAdapter(client, provider)
}
