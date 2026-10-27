import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'

/**
 * The Sui client surface the SDK's Sui code consumes: the `SuiJsonRpcClient`
 * methods it calls, with their JSON-RPC request/response shapes.
 *
 * The HTTP client satisfies it unchanged, and alternate transports only have
 * to translate into these shapes. The in-tree gRPC adapter (`./grpc.ts`) is
 * one such translation; others inject via `SuiChain.fromClient`.
 */
export type SuiClientLike = Pick<
  SuiJsonRpcClient,
  | 'getChainIdentifier'
  | 'getLatestCheckpointSequenceNumber'
  | 'getCheckpoint'
  | 'getCheckpoints'
  | 'getTransactionBlock'
  | 'multiGetTransactionBlocks'
  | 'queryTransactionBlocks'
  | 'devInspectTransactionBlock'
  | 'getObject'
  | 'getOwnedObjects'
  | 'getDynamicFields'
  | 'getDynamicFieldObject'
  | 'getNormalizedMoveModule'
  | 'getNormalizedMoveModulesByPackage'
  | 'getBalance'
  | 'getCoins'
  | 'getCoinMetadata'
  | 'queryEvents'
  | 'signAndExecuteTransaction'
  | 'waitForTransaction'
> & {
  /**
   * Reads a package's disassembled module sources, keyed by module name.
   *
   * Optional: when a client provides it (the gRPC adapter does), the SDK's
   * `getPackageDisassembly` prefers it over the JSON-RPC package-object read,
   * whose `content.disassembled` shape has no gRPC equivalent.
   */
  getPackageDisassembly?(packageId: string): Promise<Record<string, string>>
}
