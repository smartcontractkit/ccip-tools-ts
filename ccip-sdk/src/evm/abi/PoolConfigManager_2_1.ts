/**
 * Resolved-configuration views of a PoolConfigManager, the contract that holds the per-token and
 * per-lane configuration of a multi-token pool. Hand-written from the public `IPoolConfigManager`
 * and `PoolConfigManager` in smartcontractkit/chainlink-ccip
 * `chains/evm/contracts/{interfaces,pools/MultiTokenPool}` at
 * e6282c35ce2e053787714f9c8283789a577a22f8. Only the views the SDK reads are included. Two of them
 * are not in `IPoolConfigManager`: `getStaticConfig()` gives the three policy stores that emit the
 * configuration events, and `getLaneRecordLevelBatch` shows which record each lane resolves.
 * The errors include those of the three policy stores, which revert through the PCM and the pool.
 */
// TODO: replace with a `// generate:` gobinding block once chainlink-ccip publishes one

/** `IPoolConfigManager.LaneKey[]`: one token and remote chain per lane. */
const lanes = {
  type: 'tuple[]',
  name: 'lanes',
  components: [
    { type: 'address', name: 'localToken' },
    { type: 'uint64', name: 'remoteChainSelector' },
  ],
} as const

/** `IPoolConfigManager.TokenBucket` components. */
const tokenBucket = [
  { type: 'uint128', name: 'tokens' },
  { type: 'uint32', name: 'lastUpdated' },
  { type: 'bool', name: 'isEnabled' },
  { type: 'uint128', name: 'capacity' },
  { type: 'uint128', name: 'rate' },
] as const

/** `(address localToken, uint64 remoteChainSelector)` error inputs. */
const tokenAndChain = [
  { type: 'address', name: 'localToken' },
  { type: 'uint64', name: 'remoteChainSelector' },
] as const

export default [
  {
    name: 'getTokenConfigBatch',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address[]', name: 'localTokens' }],
    outputs: [
      {
        type: 'tuple[]',
        name: 'configs',
        components: [
          { type: 'bool', name: 'isRegistered' },
          { type: 'uint8', name: 'localDecimals' },
          { type: 'uint8', name: 'lockOrBurnFlavor' },
          { type: 'bytes4', name: 'allowedFinalityConfig' },
          { type: 'address', name: 'lockOrBurnAddress' },
          { type: 'address', name: 'additionalPoolDataProvider' },
          { type: 'uint64[]', name: 'supportedChains' },
          { type: 'bytes32', name: 'connectionPolicyName' },
          { type: 'bytes32', name: 'remotePoolPolicyName' },
          { type: 'bytes32', name: 'rateLimitPolicyName' },
          { type: 'bytes32', name: 'feePolicyName' },
          { type: 'bytes32', name: 'destOverheadPolicyName' },
          { type: 'bytes32', name: 'securityPolicyName' },
        ],
      },
    ],
  },
  {
    name: 'getLaneConnectionBatch',
    type: 'function',
    stateMutability: 'view',
    inputs: [lanes],
    outputs: [
      {
        type: 'tuple[]',
        name: 'connections',
        components: [
          { type: 'bool', name: 'hasConnection' },
          { type: 'bool', name: 'isOutboundPaused' },
          { type: 'bool', name: 'isInboundPaused' },
          { type: 'bool', name: 'isGloballyPaused' },
          { type: 'bool', name: 'isTokenOutboundPaused' },
          { type: 'bool', name: 'isTokenInboundPaused' },
          { type: 'bool', name: 'isChainOutboundPaused' },
          { type: 'bool', name: 'isChainInboundPaused' },
          { type: 'bool', name: 'useLegacyPoolDataOnSend' },
          { type: 'bytes', name: 'remoteToken' },
          {
            type: 'tuple[]',
            name: 'remotePools',
            components: [
              { type: 'bytes', name: 'remotePoolAddress' },
              { type: 'bool', name: 'allowLegacyPoolDataOnReceive' },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'getCurrentRateLimiterStateBatch',
    type: 'function',
    stateMutability: 'view',
    inputs: [lanes],
    outputs: [
      {
        type: 'tuple[]',
        name: 'states',
        components: [
          { type: 'tuple', name: 'outbound', components: tokenBucket },
          { type: 'tuple', name: 'inbound', components: tokenBucket },
          { type: 'tuple', name: 'fastFinalityOutbound', components: tokenBucket },
          { type: 'tuple', name: 'fastFinalityInbound', components: tokenBucket },
        ],
      },
    ],
  },
  {
    name: 'getFeeBatch',
    type: 'function',
    stateMutability: 'view',
    inputs: [lanes, { type: 'bytes4', name: 'requestedFinalityConfig' }],
    outputs: [
      {
        type: 'tuple[]',
        name: 'fees',
        components: [
          { type: 'uint256', name: 'feeUSDCents' },
          { type: 'uint32', name: 'destGasOverhead' },
          { type: 'uint32', name: 'destBytesOverhead' },
          { type: 'uint16', name: 'tokenFeeBps' },
          { type: 'bool', name: 'isEnabled' },
        ],
      },
    ],
  },
  {
    // PolicyConfig.RecordLevel per lane and record type: 0 None, 1 Inline, 2 PolicyChain,
    // 3 PolicyDefault
    name: 'getLaneRecordLevelBatch',
    type: 'function',
    stateMutability: 'view',
    inputs: [lanes],
    outputs: [
      { type: 'uint8[]', name: 'connectionLevels' },
      { type: 'uint8[]', name: 'remotePoolLevels' },
      { type: 'uint8[]', name: 'rateLimitLevels' },
      { type: 'uint8[]', name: 'feeLevels' },
      { type: 'uint8[]', name: 'destOverheadLevels' },
      { type: 'uint8[]', name: 'securityLevels' },
    ],
  },
  {
    name: 'getAllConfiguredTokens',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { type: 'uint64', name: 'startIndex' },
      { type: 'uint64', name: 'maxCount' },
    ],
    outputs: [{ type: 'address[]', name: 'tokens' }],
  },
  {
    name: 'getTokenAdminRegistry',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address', name: 'tokenAdminRegistry' }],
  },
  {
    name: 'getStaticConfig',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { type: 'address', name: 'tokenAdminRegistry' },
      { type: 'address', name: 'connectionStore' },
      { type: 'address', name: 'feeStore' },
      { type: 'address', name: 'securityStore' },
    ],
  },
  // PoolConfigManager
  { name: 'ZeroAddressInvalid', type: 'error', inputs: [] },
  {
    name: 'CallerIsNotTokenPool',
    type: 'error',
    inputs: [
      { type: 'address', name: 'caller' },
      { type: 'address', name: 'localToken' },
    ],
  },
  {
    name: 'PoolConfigManagerMismatch',
    type: 'error',
    inputs: [
      { type: 'address', name: 'pool' },
      { type: 'address', name: 'poolConfigManager' },
    ],
  },
  // ConnectionPolicyStore: transfer and view reverts; PauseDirection is 0 Outbound, 1 Inbound
  { name: 'GloballyPaused', type: 'error', inputs: [] },
  {
    name: 'TokenIsPaused',
    type: 'error',
    inputs: [
      { type: 'address', name: 'localToken' },
      { type: 'uint8', name: 'direction' },
    ],
  },
  {
    name: 'ChainIsPaused',
    type: 'error',
    inputs: [
      { type: 'uint64', name: 'remoteChainSelector' },
      { type: 'uint8', name: 'direction' },
    ],
  },
  { name: 'ConnectionRecordNotFound', type: 'error', inputs: tokenAndChain },
  { name: 'RemotePoolRecordNotFound', type: 'error', inputs: tokenAndChain },
  { name: 'LegacyPoolDataNotAllowed', type: 'error', inputs: tokenAndChain },
  { name: 'InvalidRemoteToken', type: 'error', inputs: tokenAndChain },
  {
    name: 'InvalidSourcePoolAddress',
    type: 'error',
    inputs: [...tokenAndChain, { type: 'bytes', name: 'sourcePoolAddress' }],
  },
  {
    name: 'InvalidSourcePoolData',
    type: 'error',
    inputs: [{ type: 'bytes', name: 'sourcePoolData' }],
  },
  {
    name: 'SourceTokenMismatch',
    type: 'error',
    inputs: [
      ...tokenAndChain,
      { type: 'bytes', name: 'expectedSourceToken' },
      { type: 'bytes', name: 'actualSourceToken' },
    ],
  },
  {
    name: 'InvalidAdditionalPoolData',
    type: 'error',
    inputs: [...tokenAndChain, { type: 'bytes', name: 'additionalPoolData' }],
  },
  {
    name: 'OverflowDetected',
    type: 'error',
    inputs: [
      { type: 'uint8', name: 'remoteDecimals' },
      { type: 'uint8', name: 'localDecimals' },
      { type: 'uint256', name: 'remoteAmount' },
    ],
  },
  // FeePolicyStore
  { name: 'FeeRecordNotFound', type: 'error', inputs: tokenAndChain },
  { name: 'DestOverheadRecordNotFound', type: 'error', inputs: tokenAndChain },
  {
    name: 'PoolDataTooLarge',
    type: 'error',
    inputs: [
      ...tokenAndChain,
      { type: 'uint256', name: 'destPoolDataLength' },
      { type: 'uint32', name: 'destBytesOverhead' },
    ],
  },
  // SecurityPolicyStore
  { name: 'RateLimitRecordNotFound', type: 'error', inputs: tokenAndChain },
  { name: 'SecurityRecordNotFound', type: 'error', inputs: tokenAndChain },
  {
    name: 'InvalidDecimalArgs',
    type: 'error',
    inputs: [
      { type: 'address', name: 'localToken' },
      { type: 'uint8', name: 'expected' },
      { type: 'uint8', name: 'actual' },
    ],
  },
] as const
