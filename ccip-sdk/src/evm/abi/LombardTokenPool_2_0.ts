export default [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/refs/heads/main/chains/evm/gobindings/generated/v2_0_0/lombard_token_pool/lombard_token_pool.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((obj) => require('util').inspect(obj, {depth:99, maxArrayLength: Infinity}).split('\n').slice(1, -1))
  {
    type: 'constructor',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'contract IERC20Metadata',
      },
      { name: 'verifier', type: 'address', internalType: 'address' },
      {
        name: 'bridge',
        type: 'address',
        internalType: 'contract IBridgeV2',
      },
      { name: 'adapter', type: 'address', internalType: 'address' },
      {
        name: 'advancedPoolHooks',
        type: 'address',
        internalType: 'address',
      },
      { name: 'rmnProxy', type: 'address', internalType: 'address' },
      { name: 'router', type: 'address', internalType: 'address' },
      {
        name: 'fallbackDecimals',
        type: 'uint8',
        internalType: 'uint8',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'acceptOwnership',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'addRemotePool',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'applyChainUpdates',
    inputs: [
      {
        name: 'remoteChainSelectorsToRemove',
        type: 'uint64[]',
        internalType: 'uint64[]',
      },
      {
        name: 'chainsToAdd',
        type: 'tuple[]',
        internalType: 'struct TokenPool.ChainUpdate[]',
        components: [
          {
            name: 'remoteChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'remotePoolAddresses',
            type: 'bytes[]',
            internalType: 'bytes[]',
          },
          {
            name: 'remoteTokenAddress',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'outboundRateLimiterConfig',
            type: 'tuple',
            internalType: 'struct RateLimiter.Config',
            components: [
              { name: 'isEnabled', type: 'bool', internalType: 'bool' },
              {
                name: 'capacity',
                type: 'uint128',
                internalType: 'uint128',
              },
              {
                name: 'rate',
                type: 'uint128',
                internalType: 'uint128',
              },
            ],
          },
          {
            name: 'inboundRateLimiterConfig',
            type: 'tuple',
            internalType: 'struct RateLimiter.Config',
            components: [
              { name: 'isEnabled', type: 'bool', internalType: 'bool' },
              {
                name: 'capacity',
                type: 'uint128',
                internalType: 'uint128',
              },
              {
                name: 'rate',
                type: 'uint128',
                internalType: 'uint128',
              },
            ],
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'applyTokenTransferFeeConfigUpdates',
    inputs: [
      {
        name: 'tokenTransferFeeConfigArgs',
        type: 'tuple[]',
        internalType: 'struct TokenPool.TokenTransferFeeConfigArgs[]',
        components: [
          {
            name: 'destChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'tokenTransferFeeConfig',
            type: 'tuple',
            internalType: 'struct IPoolV2.TokenTransferFeeConfig',
            components: [
              {
                name: 'destGasOverhead',
                type: 'uint32',
                internalType: 'uint32',
              },
              {
                name: 'destBytesOverhead',
                type: 'uint32',
                internalType: 'uint32',
              },
              {
                name: 'finalityFeeUSDCents',
                type: 'uint32',
                internalType: 'uint32',
              },
              {
                name: 'fastFinalityFeeUSDCents',
                type: 'uint32',
                internalType: 'uint32',
              },
              {
                name: 'finalityTransferFeeBps',
                type: 'uint16',
                internalType: 'uint16',
              },
              {
                name: 'fastFinalityTransferFeeBps',
                type: 'uint16',
                internalType: 'uint16',
              },
              { name: 'isEnabled', type: 'bool', internalType: 'bool' },
            ],
          },
        ],
      },
      {
        name: 'disableTokenTransferFeeConfigs',
        type: 'uint64[]',
        internalType: 'uint64[]',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getAdvancedPoolHooks',
    inputs: [],
    outputs: [
      {
        name: 'advancedPoolHook',
        type: 'address',
        internalType: 'contract IAdvancedPoolHooks',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAllowedFinalityConfig',
    inputs: [],
    outputs: [
      {
        name: 'allowedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCurrentRateLimiterState',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'fastFinality', type: 'bool', internalType: 'bool' },
    ],
    outputs: [
      {
        name: 'outboundRateLimiterState',
        type: 'tuple',
        internalType: 'struct RateLimiter.TokenBucket',
        components: [
          { name: 'tokens', type: 'uint128', internalType: 'uint128' },
          {
            name: 'lastUpdated',
            type: 'uint32',
            internalType: 'uint32',
          },
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
      {
        name: 'inboundRateLimiterState',
        type: 'tuple',
        internalType: 'struct RateLimiter.TokenBucket',
        components: [
          { name: 'tokens', type: 'uint128', internalType: 'uint128' },
          {
            name: 'lastUpdated',
            type: 'uint32',
            internalType: 'uint32',
          },
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getDynamicConfig',
    inputs: [],
    outputs: [
      { name: 'router', type: 'address', internalType: 'address' },
      {
        name: 'rateLimitAdmin',
        type: 'address',
        internalType: 'address',
      },
      { name: 'feeAdmin', type: 'address', internalType: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getFee',
    inputs: [
      { name: '', type: 'address', internalType: 'address' },
      {
        name: 'destChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: '', type: 'uint256', internalType: 'uint256' },
      { name: '', type: 'address', internalType: 'address' },
      {
        name: 'requestedFinalityConfig',
        type: 'bytes4',
        internalType: 'bytes4',
      },
      { name: '', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [
      { name: 'feeUSDCents', type: 'uint256', internalType: 'uint256' },
      {
        name: 'destGasOverhead',
        type: 'uint32',
        internalType: 'uint32',
      },
      {
        name: 'destBytesOverhead',
        type: 'uint32',
        internalType: 'uint32',
      },
      { name: 'tokenFeeBps', type: 'uint16', internalType: 'uint16' },
      { name: 'isEnabled', type: 'bool', internalType: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getLombardConfig',
    inputs: [],
    outputs: [
      {
        name: 'verifierResolver',
        type: 'address',
        internalType: 'address',
      },
      { name: 'bridge', type: 'address', internalType: 'address' },
      {
        name: 'tokenAdapter',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPath',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct LombardTokenPool.Path',
        components: [
          {
            name: 'allowedCaller',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'lChainId',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'remoteAdapter',
            type: 'bytes32',
            internalType: 'bytes32',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getRemotePools',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
    outputs: [{ name: '', type: 'bytes[]', internalType: 'bytes[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getRemoteToken',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
    outputs: [{ name: '', type: 'bytes', internalType: 'bytes' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getRequiredCCVs',
    inputs: [
      { name: '', type: 'address', internalType: 'address' },
      { name: '', type: 'uint64', internalType: 'uint64' },
      { name: '', type: 'uint256', internalType: 'uint256' },
      { name: '', type: 'bytes4', internalType: 'bytes4' },
      { name: '', type: 'bytes', internalType: 'bytes' },
      {
        name: '',
        type: 'uint8',
        internalType: 'enum IPoolV2.MessageDirection',
      },
    ],
    outputs: [
      {
        name: 'requiredCCVs',
        type: 'address[]',
        internalType: 'address[]',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getRmnProxy',
    inputs: [],
    outputs: [{ name: 'rmnProxy', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getSupportedChains',
    inputs: [],
    outputs: [{ name: '', type: 'uint64[]', internalType: 'uint64[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getToken',
    inputs: [],
    outputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'contract IERC20',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTokenDecimals',
    inputs: [],
    outputs: [{ name: 'decimals', type: 'uint8', internalType: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTokenTransferFeeConfig',
    inputs: [
      { name: '', type: 'address', internalType: 'address' },
      {
        name: 'destChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: '', type: 'bytes4', internalType: 'bytes4' },
      { name: '', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [
      {
        name: 'feeConfig',
        type: 'tuple',
        internalType: 'struct IPoolV2.TokenTransferFeeConfig',
        components: [
          {
            name: 'destGasOverhead',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'destBytesOverhead',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'finalityFeeUSDCents',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'fastFinalityFeeUSDCents',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'finalityTransferFeeBps',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'fastFinalityTransferFeeBps',
            type: 'uint16',
            internalType: 'uint16',
          },
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'i_bridge',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'contract IBridgeV2' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isRemotePool',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isSupportedChain',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isSupportedToken',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'lockOrBurn',
    inputs: [
      {
        name: 'lockOrBurnIn',
        type: 'tuple',
        internalType: 'struct Pool.LockOrBurnInV1',
        components: [
          { name: 'receiver', type: 'bytes', internalType: 'bytes' },
          {
            name: 'remoteChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'originalSender',
            type: 'address',
            internalType: 'address',
          },
          { name: 'amount', type: 'uint256', internalType: 'uint256' },
          {
            name: 'localToken',
            type: 'address',
            internalType: 'address',
          },
        ],
      },
    ],
    outputs: [
      {
        name: 'lockOrBurnOut',
        type: 'tuple',
        internalType: 'struct Pool.LockOrBurnOutV1',
        components: [
          {
            name: 'destTokenAddress',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'destPoolData',
            type: 'bytes',
            internalType: 'bytes',
          },
        ],
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'lockOrBurn',
    inputs: [
      {
        name: 'lockOrBurnIn',
        type: 'tuple',
        internalType: 'struct Pool.LockOrBurnInV1',
        components: [
          { name: 'receiver', type: 'bytes', internalType: 'bytes' },
          {
            name: 'remoteChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'originalSender',
            type: 'address',
            internalType: 'address',
          },
          { name: 'amount', type: 'uint256', internalType: 'uint256' },
          {
            name: 'localToken',
            type: 'address',
            internalType: 'address',
          },
        ],
      },
      {
        name: 'requestedFinalityConfig',
        type: 'bytes4',
        internalType: 'bytes4',
      },
      { name: 'tokenArgs', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [
      {
        name: 'lockOrBurnOut',
        type: 'tuple',
        internalType: 'struct Pool.LockOrBurnOutV1',
        components: [
          {
            name: 'destTokenAddress',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'destPoolData',
            type: 'bytes',
            internalType: 'bytes',
          },
        ],
      },
      {
        name: 'destTokenAmount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'releaseOrMint',
    inputs: [
      {
        name: 'releaseOrMintIn',
        type: 'tuple',
        internalType: 'struct Pool.ReleaseOrMintInV1',
        components: [
          {
            name: 'originalSender',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'remoteChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'receiver',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'sourceDenominatedAmount',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'localToken',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'sourcePoolAddress',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'sourcePoolData',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'offchainTokenData',
            type: 'bytes',
            internalType: 'bytes',
          },
        ],
      },
      {
        name: 'requestedFinalityConfig',
        type: 'bytes4',
        internalType: 'bytes4',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct Pool.ReleaseOrMintOutV1',
        components: [
          {
            name: 'destinationAmount',
            type: 'uint256',
            internalType: 'uint256',
          },
        ],
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'releaseOrMint',
    inputs: [
      {
        name: 'releaseOrMintIn',
        type: 'tuple',
        internalType: 'struct Pool.ReleaseOrMintInV1',
        components: [
          {
            name: 'originalSender',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'remoteChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'receiver',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'sourceDenominatedAmount',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'localToken',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'sourcePoolAddress',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'sourcePoolData',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'offchainTokenData',
            type: 'bytes',
            internalType: 'bytes',
          },
        ],
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct Pool.ReleaseOrMintOutV1',
        components: [
          {
            name: 'destinationAmount',
            type: 'uint256',
            internalType: 'uint256',
          },
        ],
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'removePath',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'removeRemotePool',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setAllowedFinalityConfig',
    inputs: [
      {
        name: 'allowedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setDynamicConfig',
    inputs: [
      { name: 'router', type: 'address', internalType: 'address' },
      {
        name: 'rateLimitAdmin',
        type: 'address',
        internalType: 'address',
      },
      { name: 'feeAdmin', type: 'address', internalType: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setPath',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'lChainId', type: 'bytes32', internalType: 'bytes32' },
      { name: 'allowedCaller', type: 'bytes', internalType: 'bytes' },
      {
        name: 'remoteAdapter',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setRateLimitConfig',
    inputs: [
      {
        name: 'rateLimitConfigArgs',
        type: 'tuple[]',
        internalType: 'struct TokenPool.RateLimitConfigArgs[]',
        components: [
          {
            name: 'remoteChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          { name: 'fastFinality', type: 'bool', internalType: 'bool' },
          {
            name: 'outboundRateLimiterConfig',
            type: 'tuple',
            internalType: 'struct RateLimiter.Config',
            components: [
              { name: 'isEnabled', type: 'bool', internalType: 'bool' },
              {
                name: 'capacity',
                type: 'uint128',
                internalType: 'uint128',
              },
              {
                name: 'rate',
                type: 'uint128',
                internalType: 'uint128',
              },
            ],
          },
          {
            name: 'inboundRateLimiterConfig',
            type: 'tuple',
            internalType: 'struct RateLimiter.Config',
            components: [
              { name: 'isEnabled', type: 'bool', internalType: 'bool' },
              {
                name: 'capacity',
                type: 'uint128',
                internalType: 'uint128',
              },
              {
                name: 'rate',
                type: 'uint128',
                internalType: 'uint128',
              },
            ],
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'supportsInterface',
    inputs: [{ name: 'interfaceId', type: 'bytes4', internalType: 'bytes4' }],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'transferOwnership',
    inputs: [{ name: 'to', type: 'address', internalType: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'typeAndVersion',
    inputs: [],
    outputs: [{ name: '', type: 'string', internalType: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'updateAdvancedPoolHooks',
    inputs: [
      {
        name: 'newHook',
        type: 'address',
        internalType: 'contract IAdvancedPoolHooks',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdrawFeeTokens',
    inputs: [
      {
        name: 'feeTokens',
        type: 'address[]',
        internalType: 'address[]',
      },
      { name: 'recipient', type: 'address', internalType: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'AdvancedPoolHooksUpdated',
    inputs: [
      {
        name: 'oldHook',
        type: 'address',
        indexed: false,
        internalType: 'contract IAdvancedPoolHooks',
      },
      {
        name: 'newHook',
        type: 'address',
        indexed: false,
        internalType: 'contract IAdvancedPoolHooks',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ChainAdded',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
      },
      {
        name: 'remoteToken',
        type: 'bytes',
        indexed: false,
        internalType: 'bytes',
      },
      {
        name: 'outboundRateLimiterConfig',
        type: 'tuple',
        indexed: false,
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
      {
        name: 'inboundRateLimiterConfig',
        type: 'tuple',
        indexed: false,
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ChainRemoved',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'DynamicConfigSet',
    inputs: [
      {
        name: 'router',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'rateLimitAdmin',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'feeAdmin',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'FastFinalityInboundRateLimitConsumed',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'token',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'FastFinalityOutboundRateLimitConsumed',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'token',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'FeeTokenWithdrawn',
    inputs: [
      {
        name: 'receiver',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'feeToken',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'FinalityConfigSet',
    inputs: [
      {
        name: 'allowedFinality',
        type: 'bytes4',
        indexed: false,
        internalType: 'bytes4',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'InboundRateLimitConsumed',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'token',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'LockedOrBurned',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'token',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'sender',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'LombardConfigurationSet',
    inputs: [
      {
        name: 'verifier',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'bridge',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'tokenAdapter',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'OutboundRateLimitConsumed',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'token',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'OwnershipTransferRequested',
    inputs: [
      {
        name: 'from',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'to',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'OwnershipTransferred',
    inputs: [
      {
        name: 'from',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'to',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'PathRemoved',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'lChainId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'allowedCaller',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'remoteAdapter',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'PathSet',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'lChainId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'allowedCaller',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'remoteAdapter',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'RateLimitConfigured',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'fastFinality',
        type: 'bool',
        indexed: false,
        internalType: 'bool',
      },
      {
        name: 'outboundRateLimiterConfig',
        type: 'tuple',
        indexed: false,
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
      {
        name: 'inboundRateLimiterConfig',
        type: 'tuple',
        indexed: false,
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ReleasedOrMinted',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'token',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'sender',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'recipient',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'RemotePoolAdded',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        indexed: false,
        internalType: 'bytes',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'RemotePoolRemoved',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        indexed: false,
        internalType: 'bytes',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'TokenTransferFeeConfigDeleted',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'TokenTransferFeeConfigUpdated',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'tokenTransferFeeConfig',
        type: 'tuple',
        indexed: false,
        internalType: 'struct IPoolV2.TokenTransferFeeConfig',
        components: [
          {
            name: 'destGasOverhead',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'destBytesOverhead',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'finalityFeeUSDCents',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'fastFinalityFeeUSDCents',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'finalityTransferFeeBps',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'fastFinalityTransferFeeBps',
            type: 'uint16',
            internalType: 'uint16',
          },
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
        ],
      },
    ],
    anonymous: false,
  },
  { type: 'error', name: 'BucketOverfilled', inputs: [] },
  {
    type: 'error',
    name: 'CallerIsNotARampOnRouter',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'CallerIsNotOwnerOrFeeAdmin',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  {
    type: 'error',
    name: 'ChainAlreadyExists',
    inputs: [{ name: 'chainSelector', type: 'uint64', internalType: 'uint64' }],
  },
  {
    type: 'error',
    name: 'ChainNotAllowed',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'ChainNotSupported',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'CursedByRMN', inputs: [] },
  {
    type: 'error',
    name: 'DisabledNonZeroRateLimit',
    inputs: [
      {
        name: 'config',
        type: 'tuple',
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
  },
  { type: 'error', name: 'ExecutionError', inputs: [] },
  { type: 'error', name: 'HashMismatch', inputs: [] },
  {
    type: 'error',
    name: 'Invalid32ByteAddress',
    inputs: [{ name: 'encodedAddress', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'InvalidDecimalArgs',
    inputs: [
      { name: 'expected', type: 'uint8', internalType: 'uint8' },
      { name: 'actual', type: 'uint8', internalType: 'uint8' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidMessageVersion',
    inputs: [
      { name: 'expected', type: 'uint8', internalType: 'uint8' },
      { name: 'received', type: 'uint8', internalType: 'uint8' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRateLimitRate',
    inputs: [
      {
        name: 'rateLimiterConfig',
        type: 'tuple',
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidReceiver',
    inputs: [{ name: 'receiver', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'InvalidRemoteChainDecimals',
    inputs: [{ name: 'sourcePoolData', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'InvalidRemotePoolForChain',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRequestedFinality',
    inputs: [
      {
        name: 'requestedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
      },
      {
        name: 'allowedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidSourcePoolAddress',
    inputs: [
      {
        name: 'sourcePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidToken',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'InvalidTokenTransferFeeConfig',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidTransferFeeBps',
    inputs: [{ name: 'bps', type: 'uint256', internalType: 'uint256' }],
  },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  {
    type: 'error',
    name: 'NonExistentChain',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  {
    type: 'error',
    name: 'OutboundImplementationNotFoundForVerifier',
    inputs: [],
  },
  {
    type: 'error',
    name: 'OverflowDetected',
    inputs: [
      { name: 'remoteDecimals', type: 'uint8', internalType: 'uint8' },
      { name: 'localDecimals', type: 'uint8', internalType: 'uint8' },
      {
        name: 'remoteAmount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'PathNotExist',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'PoolAlreadyAdded',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'RemoteTokenOrAdapterMismatch',
    inputs: [
      { name: 'bridgeToken', type: 'bytes32', internalType: 'bytes32' },
      { name: 'remoteToken', type: 'bytes32', internalType: 'bytes32' },
      {
        name: 'remoteAdapter',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
  },
  {
    type: 'error',
    name: 'RequestedFinalityCanOnlyHaveOneMode',
    inputs: [
      {
        name: 'encodedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
      },
    ],
  },
  {
    type: 'error',
    name: 'SafeERC20FailedOperation',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'TokenMaxCapacityExceeded',
    inputs: [
      { name: 'capacity', type: 'uint256', internalType: 'uint256' },
      { name: 'requested', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tokenAddress',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'TokenRateLimitReached',
    inputs: [
      {
        name: 'minWaitInSeconds',
        type: 'uint256',
        internalType: 'uint256',
      },
      { name: 'available', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tokenAddress',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'Unauthorized',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'ZeroAddressInvalid', inputs: [] },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  { type: 'error', name: 'ZeroBridge', inputs: [] },
  { type: 'error', name: 'ZeroLombardChainId', inputs: [] },
  { type: 'error', name: 'ZeroVerifierNotAllowed', inputs: [] },
  // generate:end
] as const
