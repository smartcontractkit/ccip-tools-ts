export default [
  // generate:
  // fetch('https://github.com/smartcontractkit/ccip/raw/release/2.14.0-ccip1.5/core/gethwrappers/ccip/generated/lock_release_token_pool/lock_release_token_pool.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  {
    inputs: [
      {
        internalType: 'contractIERC20',
        name: 'token',
        type: 'address',
      },
      {
        internalType: 'address[]',
        name: 'allowlist',
        type: 'address[]',
      },
      { internalType: 'address', name: 'rmnProxy', type: 'address' },
      { internalType: 'bool', name: 'acceptLiquidity', type: 'bool' },
      { internalType: 'address', name: 'router', type: 'address' },
    ],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'capacity', type: 'uint256' },
      { internalType: 'uint256', name: 'requested', type: 'uint256' },
    ],
    name: 'AggregateValueMaxCapacityExceeded',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'minWaitInSeconds',
        type: 'uint256',
      },
      { internalType: 'uint256', name: 'available', type: 'uint256' },
    ],
    name: 'AggregateValueRateLimitReached',
    type: 'error',
  },
  { inputs: [], name: 'AllowListNotEnabled', type: 'error' },
  { inputs: [], name: 'BucketOverfilled', type: 'error' },
  {
    inputs: [{ internalType: 'address', name: 'caller', type: 'address' }],
    name: 'CallerIsNotARampOnRouter',
    type: 'error',
  },
  {
    inputs: [{ internalType: 'uint64', name: 'chainSelector', type: 'uint64' }],
    name: 'ChainAlreadyExists',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint64',
        name: 'remoteChainSelector',
        type: 'uint64',
      },
    ],
    name: 'ChainNotAllowed',
    type: 'error',
  },
  { inputs: [], name: 'CursedByRMN', type: 'error' },
  {
    inputs: [
      {
        components: [
          { internalType: 'bool', name: 'isEnabled', type: 'bool' },
          {
            internalType: 'uint128',
            name: 'capacity',
            type: 'uint128',
          },
          { internalType: 'uint128', name: 'rate', type: 'uint128' },
        ],
        internalType: 'structRateLimiter.Config',
        name: 'config',
        type: 'tuple',
      },
    ],
    name: 'DisabledNonZeroRateLimit',
    type: 'error',
  },
  { inputs: [], name: 'InsufficientLiquidity', type: 'error' },
  {
    inputs: [
      {
        components: [
          { internalType: 'bool', name: 'isEnabled', type: 'bool' },
          {
            internalType: 'uint128',
            name: 'capacity',
            type: 'uint128',
          },
          { internalType: 'uint128', name: 'rate', type: 'uint128' },
        ],
        internalType: 'structRateLimiter.Config',
        name: 'rateLimiterConfig',
        type: 'tuple',
      },
    ],
    name: 'InvalidRateLimitRate',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'bytes',
        name: 'sourcePoolAddress',
        type: 'bytes',
      },
    ],
    name: 'InvalidSourcePoolAddress',
    type: 'error',
  },
  {
    inputs: [{ internalType: 'address', name: 'token', type: 'address' }],
    name: 'InvalidToken',
    type: 'error',
  },
  { inputs: [], name: 'LiquidityNotAccepted', type: 'error' },
  {
    inputs: [
      {
        internalType: 'uint64',
        name: 'remoteChainSelector',
        type: 'uint64',
      },
    ],
    name: 'NonExistentChain',
    type: 'error',
  },
  { inputs: [], name: 'RateLimitMustBeDisabled', type: 'error' },
  {
    inputs: [{ internalType: 'address', name: 'sender', type: 'address' }],
    name: 'SenderNotAllowed',
    type: 'error',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'capacity', type: 'uint256' },
      { internalType: 'uint256', name: 'requested', type: 'uint256' },
      {
        internalType: 'address',
        name: 'tokenAddress',
        type: 'address',
      },
    ],
    name: 'TokenMaxCapacityExceeded',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'minWaitInSeconds',
        type: 'uint256',
      },
      { internalType: 'uint256', name: 'available', type: 'uint256' },
      {
        internalType: 'address',
        name: 'tokenAddress',
        type: 'address',
      },
    ],
    name: 'TokenRateLimitReached',
    type: 'error',
  },
  {
    inputs: [{ internalType: 'address', name: 'caller', type: 'address' }],
    name: 'Unauthorized',
    type: 'error',
  },
  { inputs: [], name: 'ZeroAddressNotAllowed', type: 'error' },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'address',
        name: 'sender',
        type: 'address',
      },
    ],
    name: 'AllowListAdd',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'address',
        name: 'sender',
        type: 'address',
      },
    ],
    name: 'AllowListRemove',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'sender',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
    ],
    name: 'Burned',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'uint64',
        name: 'remoteChainSelector',
        type: 'uint64',
      },
      {
        indexed: false,
        internalType: 'bytes',
        name: 'remoteToken',
        type: 'bytes',
      },
      {
        components: [
          { internalType: 'bool', name: 'isEnabled', type: 'bool' },
          {
            internalType: 'uint128',
            name: 'capacity',
            type: 'uint128',
          },
          { internalType: 'uint128', name: 'rate', type: 'uint128' },
        ],
        indexed: false,
        internalType: 'structRateLimiter.Config',
        name: 'outboundRateLimiterConfig',
        type: 'tuple',
      },
      {
        components: [
          { internalType: 'bool', name: 'isEnabled', type: 'bool' },
          {
            internalType: 'uint128',
            name: 'capacity',
            type: 'uint128',
          },
          { internalType: 'uint128', name: 'rate', type: 'uint128' },
        ],
        indexed: false,
        internalType: 'structRateLimiter.Config',
        name: 'inboundRateLimiterConfig',
        type: 'tuple',
      },
    ],
    name: 'ChainAdded',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'uint64',
        name: 'remoteChainSelector',
        type: 'uint64',
      },
      {
        components: [
          { internalType: 'bool', name: 'isEnabled', type: 'bool' },
          {
            internalType: 'uint128',
            name: 'capacity',
            type: 'uint128',
          },
          { internalType: 'uint128', name: 'rate', type: 'uint128' },
        ],
        indexed: false,
        internalType: 'structRateLimiter.Config',
        name: 'outboundRateLimiterConfig',
        type: 'tuple',
      },
      {
        components: [
          { internalType: 'bool', name: 'isEnabled', type: 'bool' },
          {
            internalType: 'uint128',
            name: 'capacity',
            type: 'uint128',
          },
          { internalType: 'uint128', name: 'rate', type: 'uint128' },
        ],
        indexed: false,
        internalType: 'structRateLimiter.Config',
        name: 'inboundRateLimiterConfig',
        type: 'tuple',
      },
    ],
    name: 'ChainConfigured',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'uint64',
        name: 'remoteChainSelector',
        type: 'uint64',
      },
    ],
    name: 'ChainRemoved',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        components: [
          { internalType: 'bool', name: 'isEnabled', type: 'bool' },
          {
            internalType: 'uint128',
            name: 'capacity',
            type: 'uint128',
          },
          { internalType: 'uint128', name: 'rate', type: 'uint128' },
        ],
        indexed: false,
        internalType: 'structRateLimiter.Config',
        name: 'config',
        type: 'tuple',
      },
    ],
    name: 'ConfigChanged',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'provider',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
    ],
    name: 'LiquidityAdded',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'provider',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
    ],
    name: 'LiquidityRemoved',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'from',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
    ],
    name: 'LiquidityTransferred',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'sender',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
    ],
    name: 'Locked',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'sender',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'recipient',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
    ],
    name: 'Minted',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'from',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'to',
        type: 'address',
      },
    ],
    name: 'OwnershipTransferRequested',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'from',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'to',
        type: 'address',
      },
    ],
    name: 'OwnershipTransferred',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'sender',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'recipient',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
    ],
    name: 'Released',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'uint64',
        name: 'remoteChainSelector',
        type: 'uint64',
      },
      {
        indexed: false,
        internalType: 'bytes',
        name: 'previousPoolAddress',
        type: 'bytes',
      },
      {
        indexed: false,
        internalType: 'bytes',
        name: 'remotePoolAddress',
        type: 'bytes',
      },
    ],
    name: 'RemotePoolSet',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'address',
        name: 'oldRouter',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'address',
        name: 'newRouter',
        type: 'address',
      },
    ],
    name: 'RouterUpdated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'uint256',
        name: 'tokens',
        type: 'uint256',
      },
    ],
    name: 'TokensConsumed',
    type: 'event',
  },
  {
    inputs: [],
    name: 'acceptOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address[]', name: 'removes', type: 'address[]' },
      { internalType: 'address[]', name: 'adds', type: 'address[]' },
    ],
    name: 'applyAllowListUpdates',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: 'uint64',
            name: 'remoteChainSelector',
            type: 'uint64',
          },
          { internalType: 'bool', name: 'allowed', type: 'bool' },
          {
            internalType: 'bytes',
            name: 'remotePoolAddress',
            type: 'bytes',
          },
          {
            internalType: 'bytes',
            name: 'remoteTokenAddress',
            type: 'bytes',
          },
          {
            components: [
              { internalType: 'bool', name: 'isEnabled', type: 'bool' },
              {
                internalType: 'uint128',
                name: 'capacity',
                type: 'uint128',
              },
              {
                internalType: 'uint128',
                name: 'rate',
                type: 'uint128',
              },
            ],
            internalType: 'structRateLimiter.Config',
            name: 'outboundRateLimiterConfig',
            type: 'tuple',
          },
          {
            components: [
              { internalType: 'bool', name: 'isEnabled', type: 'bool' },
              {
                internalType: 'uint128',
                name: 'capacity',
                type: 'uint128',
              },
              {
                internalType: 'uint128',
                name: 'rate',
                type: 'uint128',
              },
            ],
            internalType: 'structRateLimiter.Config',
            name: 'inboundRateLimiterConfig',
            type: 'tuple',
          },
        ],
        internalType: 'structTokenPool.ChainUpdate[]',
        name: 'chains',
        type: 'tuple[]',
      },
    ],
    name: 'applyChainUpdates',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'canAcceptLiquidity',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getAllowList',
    outputs: [{ internalType: 'address[]', name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getAllowListEnabled',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint64',
        name: 'remoteChainSelector',
        type: 'uint64',
      },
    ],
    name: 'getCurrentInboundRateLimiterState',
    outputs: [
      {
        components: [
          { internalType: 'uint128', name: 'tokens', type: 'uint128' },
          {
            internalType: 'uint32',
            name: 'lastUpdated',
            type: 'uint32',
          },
          { internalType: 'bool', name: 'isEnabled', type: 'bool' },
          {
            internalType: 'uint128',
            name: 'capacity',
            type: 'uint128',
          },
          { internalType: 'uint128', name: 'rate', type: 'uint128' },
        ],
        internalType: 'structRateLimiter.TokenBucket',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint64',
        name: 'remoteChainSelector',
        type: 'uint64',
      },
    ],
    name: 'getCurrentOutboundRateLimiterState',
    outputs: [
      {
        components: [
          { internalType: 'uint128', name: 'tokens', type: 'uint128' },
          {
            internalType: 'uint32',
            name: 'lastUpdated',
            type: 'uint32',
          },
          { internalType: 'bool', name: 'isEnabled', type: 'bool' },
          {
            internalType: 'uint128',
            name: 'capacity',
            type: 'uint128',
          },
          { internalType: 'uint128', name: 'rate', type: 'uint128' },
        ],
        internalType: 'structRateLimiter.TokenBucket',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getRateLimitAdmin',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getRebalancer',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint64',
        name: 'remoteChainSelector',
        type: 'uint64',
      },
    ],
    name: 'getRemotePool',
    outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint64',
        name: 'remoteChainSelector',
        type: 'uint64',
      },
    ],
    name: 'getRemoteToken',
    outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getRmnProxy',
    outputs: [{ internalType: 'address', name: 'rmnProxy', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getRouter',
    outputs: [{ internalType: 'address', name: 'router', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getSupportedChains',
    outputs: [{ internalType: 'uint64[]', name: '', type: 'uint64[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getToken',
    outputs: [
      {
        internalType: 'contractIERC20',
        name: 'token',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint64',
        name: 'remoteChainSelector',
        type: 'uint64',
      },
    ],
    name: 'isSupportedChain',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'token', type: 'address' }],
    name: 'isSupportedToken',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'bytes', name: 'receiver', type: 'bytes' },
          {
            internalType: 'uint64',
            name: 'remoteChainSelector',
            type: 'uint64',
          },
          {
            internalType: 'address',
            name: 'originalSender',
            type: 'address',
          },
          { internalType: 'uint256', name: 'amount', type: 'uint256' },
          {
            internalType: 'address',
            name: 'localToken',
            type: 'address',
          },
        ],
        internalType: 'structPool.LockOrBurnInV1',
        name: 'lockOrBurnIn',
        type: 'tuple',
      },
    ],
    name: 'lockOrBurn',
    outputs: [
      {
        components: [
          {
            internalType: 'bytes',
            name: 'destTokenAddress',
            type: 'bytes',
          },
          {
            internalType: 'bytes',
            name: 'destPoolData',
            type: 'bytes',
          },
        ],
        internalType: 'structPool.LockOrBurnOutV1',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'owner',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'amount', type: 'uint256' }],
    name: 'provideLiquidity',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: 'bytes',
            name: 'originalSender',
            type: 'bytes',
          },
          {
            internalType: 'uint64',
            name: 'remoteChainSelector',
            type: 'uint64',
          },
          {
            internalType: 'address',
            name: 'receiver',
            type: 'address',
          },
          { internalType: 'uint256', name: 'amount', type: 'uint256' },
          {
            internalType: 'address',
            name: 'localToken',
            type: 'address',
          },
          {
            internalType: 'bytes',
            name: 'sourcePoolAddress',
            type: 'bytes',
          },
          {
            internalType: 'bytes',
            name: 'sourcePoolData',
            type: 'bytes',
          },
          {
            internalType: 'bytes',
            name: 'offchainTokenData',
            type: 'bytes',
          },
        ],
        internalType: 'structPool.ReleaseOrMintInV1',
        name: 'releaseOrMintIn',
        type: 'tuple',
      },
    ],
    name: 'releaseOrMint',
    outputs: [
      {
        components: [
          {
            internalType: 'uint256',
            name: 'destinationAmount',
            type: 'uint256',
          },
        ],
        internalType: 'structPool.ReleaseOrMintOutV1',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint64',
        name: 'remoteChainSelector',
        type: 'uint64',
      },
      {
        components: [
          { internalType: 'bool', name: 'isEnabled', type: 'bool' },
          {
            internalType: 'uint128',
            name: 'capacity',
            type: 'uint128',
          },
          { internalType: 'uint128', name: 'rate', type: 'uint128' },
        ],
        internalType: 'structRateLimiter.Config',
        name: 'outboundConfig',
        type: 'tuple',
      },
      {
        components: [
          { internalType: 'bool', name: 'isEnabled', type: 'bool' },
          {
            internalType: 'uint128',
            name: 'capacity',
            type: 'uint128',
          },
          { internalType: 'uint128', name: 'rate', type: 'uint128' },
        ],
        internalType: 'structRateLimiter.Config',
        name: 'inboundConfig',
        type: 'tuple',
      },
    ],
    name: 'setChainRateLimiterConfig',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'rateLimitAdmin',
        type: 'address',
      },
    ],
    name: 'setRateLimitAdmin',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'rebalancer', type: 'address' }],
    name: 'setRebalancer',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint64',
        name: 'remoteChainSelector',
        type: 'uint64',
      },
      {
        internalType: 'bytes',
        name: 'remotePoolAddress',
        type: 'bytes',
      },
    ],
    name: 'setRemotePool',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'newRouter', type: 'address' }],
    name: 'setRouter',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'bytes4', name: 'interfaceId', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'from', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'transferLiquidity',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'to', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'typeAndVersion',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'amount', type: 'uint256' }],
    name: 'withdrawLiquidity',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // generate:end
] as const
