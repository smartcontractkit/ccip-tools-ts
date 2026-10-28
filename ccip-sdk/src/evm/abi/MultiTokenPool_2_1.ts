/**
 * Read surface of a multi-token pool (`BurnMintMultiTokenPool 2.1.0-dev`), which serves many tokens
 * and keeps their configuration in a PoolConfigManager. Hand-written from the public interfaces
 * `IMultiTokenPool`, `IGetPoolConfigManager` and `MultiTokenPool` in smartcontractkit/chainlink-ccip
 * `chains/evm/contracts/{interfaces,pools/MultiTokenPool}` at
 * ede0ec8b73e6e0dc32e317068c0a246d7aafc564.
 * The single-token getters (`getToken()`, `getDynamicConfig()`, `getSupportedChains()`, rate
 * limiters) do not exist on these pools; `getRemoteToken(uint64)` and `isSupportedChain(uint64)`
 * revert with `LocalTokenRequired()`.
 * `getTokenTransferFeeConfig` has the same signature as on TokenPool 2.0.
 */
// TODO: replace with a `// generate:` gobinding block once chainlink-ccip publishes one
export default [
  {
    name: 'typeAndVersion',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'getRouter',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address', name: 'router' }],
  },
  {
    name: 'getRmnProxy',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address', name: 'rmnProxy' }],
  },
  {
    name: 'getPoolConfigManager',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address', name: 'poolConfigManager' }],
  },
  {
    name: 'isSupportedToken',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address', name: 'token' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'isSupportedChain',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { type: 'address', name: 'localToken' },
      { type: 'uint64', name: 'remoteChainSelector' },
    ],
    outputs: [{ type: 'bool', name: 'supported' }],
  },
  {
    name: 'getRemoteToken',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { type: 'address', name: 'localToken' },
      { type: 'uint64', name: 'remoteChainSelector' },
    ],
    outputs: [{ type: 'bytes', name: 'remoteToken' }],
  },
  {
    name: 'getTokenDecimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address', name: 'localToken' }],
    outputs: [{ type: 'uint8', name: 'decimals' }],
  },
  { name: 'LocalTokenRequired', type: 'error', inputs: [] },
  { name: 'ZeroAddressInvalid', type: 'error', inputs: [] },
  { name: 'CursedByRMN', type: 'error', inputs: [] },
  {
    name: 'CallerIsNotARampOnRouter',
    type: 'error',
    inputs: [{ type: 'address', name: 'caller' }],
  },
  {
    name: 'CallerIsNotPoolConfigManager',
    type: 'error',
    inputs: [{ type: 'address', name: 'caller' }],
  },
  {
    name: 'UnsupportedLockOrBurnFlavor',
    type: 'error',
    inputs: [
      { type: 'address', name: 'token' },
      { type: 'uint8', name: 'flavor' },
    ],
  },
] as const
