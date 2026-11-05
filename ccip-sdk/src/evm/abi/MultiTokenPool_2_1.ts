/**
 * Read surface of a multi-token pool (`BurnMintMultiTokenPool 2.1.0-dev`), which serves many tokens
 * and keeps their configuration in a PoolConfigManager. Hand-written from the public interfaces
 * `IMultiTokenPool`, `IGetPoolConfigManager` and `MultiTokenPool` in smartcontractkit/chainlink-ccip
 * `chains/evm/contracts/{interfaces,pools/MultiTokenPool}` at
 * 21710ed66224ab6c141b57df81665853a29a4ede.
 * The single-token getters (`getToken()`, `getDynamicConfig()`, `getSupportedChains()`, rate
 * limiters) do not exist on these pools; `getRemoteToken(uint64)` and `isSupportedChain(uint64)`
 * revert with `LocalTokenRequired()`.
 * `getTokenTransferFeeConfig` has the same signature as on TokenPool 2.0. `getFee` reverts with
 * `LaneFeeNotFound` when the lane, its fee record or its destination overhead record is missing;
 * the v2 OnRamp then does not fall back to the FeeQuoter, so the send fails.
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
  {
    name: 'LaneFeeNotFound',
    type: 'error',
    inputs: [
      { type: 'address', name: 'localToken' },
      { type: 'uint64', name: 'destChainSelector' },
    ],
  },
] as const
