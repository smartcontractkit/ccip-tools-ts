import type { Account, Chain, PublicClient, Transport, WalletClient } from 'viem'

/**
 * Viem PublicClient with required chain property.
 * Chain is required to determine the network for EVMChain.
 */
export type ViemPublicClient = PublicClient<Transport, Chain>

/**
 * Viem WalletClient with required account and chain properties.
 * Account is required to get the signer address.
 * Chain is required to determine the network.
 */
export type ViemWalletClient = WalletClient<Transport, Chain, Account>
