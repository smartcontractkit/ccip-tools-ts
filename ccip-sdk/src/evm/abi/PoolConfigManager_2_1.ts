/**
 * Resolved-configuration views of a PoolConfigManager, the contract that holds the per-token and
 * per-lane configuration of a multi-token pool. Hand-written from the public `IPoolConfigManager`
 * in smartcontractkit/chainlink-ccip `chains/evm/contracts/interfaces/IPoolConfigManager.sol` at
 * ede0ec8b73e6e0dc32e317068c0a246d7aafc564. Only the batch views the SDK reads are included,
 * plus the implementation's `getStaticConfig()` (not in `IPoolConfigManager`), which gives the
 * ConnectionPolicyStore and SecurityPolicyStore that emit the configuration events.
 */
// TODO: replace with a `// generate:` gobinding block once chainlink-ccip publishes one
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
          { type: 'address', name: 'tokenIdentityMetadataProvider' },
          { type: 'uint64[]', name: 'supportedChains' },
          { type: 'bytes32', name: 'connectionPolicyName' },
          { type: 'bytes32', name: 'chainPolicyName' },
          { type: 'bytes32', name: 'rateLimitPolicyName' },
          { type: 'bytes32', name: 'feePolicyName' },
          { type: 'bytes32', name: 'securityPolicyName' },
        ],
      },
    ],
  },
  {
    name: 'getLaneConnectionBatch',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      {
        type: 'tuple[]',
        name: 'lanes',
        components: [
          { type: 'address', name: 'localToken' },
          { type: 'uint64', name: 'remoteChainSelector' },
        ],
      },
    ],
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
          { type: 'bool', name: 'omitSourceTokenAddressOnSend' },
          { type: 'bool', name: 'allowSourceTokenAddressMissingOnReceive' },
          { type: 'uint32', name: 'destGasOverhead' },
          { type: 'uint32', name: 'destBytesOverhead' },
          { type: 'bytes', name: 'remoteToken' },
          { type: 'bytes[]', name: 'remotePools' },
        ],
      },
    ],
  },
  {
    name: 'getCurrentRateLimiterStateBatch',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      {
        type: 'tuple[]',
        name: 'lanes',
        components: [
          { type: 'address', name: 'localToken' },
          { type: 'uint64', name: 'remoteChainSelector' },
        ],
      },
    ],
    outputs: [
      {
        type: 'tuple[]',
        name: 'states',
        components: [
          {
            type: 'tuple',
            name: 'outbound',
            components: [
              { type: 'uint128', name: 'tokens' },
              { type: 'uint32', name: 'lastUpdated' },
              { type: 'bool', name: 'isEnabled' },
              { type: 'uint128', name: 'capacity' },
              { type: 'uint128', name: 'rate' },
            ],
          },
          {
            type: 'tuple',
            name: 'inbound',
            components: [
              { type: 'uint128', name: 'tokens' },
              { type: 'uint32', name: 'lastUpdated' },
              { type: 'bool', name: 'isEnabled' },
              { type: 'uint128', name: 'capacity' },
              { type: 'uint128', name: 'rate' },
            ],
          },
          {
            type: 'tuple',
            name: 'fastFinalityOutbound',
            components: [
              { type: 'uint128', name: 'tokens' },
              { type: 'uint32', name: 'lastUpdated' },
              { type: 'bool', name: 'isEnabled' },
              { type: 'uint128', name: 'capacity' },
              { type: 'uint128', name: 'rate' },
            ],
          },
          {
            type: 'tuple',
            name: 'fastFinalityInbound',
            components: [
              { type: 'uint128', name: 'tokens' },
              { type: 'uint32', name: 'lastUpdated' },
              { type: 'bool', name: 'isEnabled' },
              { type: 'uint128', name: 'capacity' },
              { type: 'uint128', name: 'rate' },
            ],
          },
        ],
      },
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
      { type: 'address', name: 'securityStore' },
    ],
  },
] as const
