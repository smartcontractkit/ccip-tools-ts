export default [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/refs/heads/main/chains/evm/gobindings/generated/v1_6_0/fast_transfer_token_pool/fast_transfer_token_pool.go')
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
        internalType: 'contract IBurnMintERC20',
      },
      {
        name: 'localTokenDecimals',
        type: 'uint8',
        internalType: 'uint8',
      },
      {
        name: 'allowlist',
        type: 'address[]',
        internalType: 'address[]',
      },
      { name: 'rmnProxy', type: 'address', internalType: 'address' },
      { name: 'router', type: 'address', internalType: 'address' },
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        internalType: 'uint64',
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
    name: 'applyAllowListUpdates',
    inputs: [
      { name: 'removes', type: 'address[]', internalType: 'address[]' },
      { name: 'adds', type: 'address[]', internalType: 'address[]' },
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
    name: 'ccipReceive',
    inputs: [
      {
        name: 'message',
        type: 'tuple',
        internalType: 'struct Client.Any2EVMMessage',
        components: [
          {
            name: 'messageId',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'sourceChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          { name: 'sender', type: 'bytes', internalType: 'bytes' },
          { name: 'data', type: 'bytes', internalType: 'bytes' },
          {
            name: 'destTokenAmounts',
            type: 'tuple[]',
            internalType: 'struct Client.EVMTokenAmount[]',
            components: [
              {
                name: 'token',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'amount',
                type: 'uint256',
                internalType: 'uint256',
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
    name: 'ccipSendToken',
    inputs: [
      {
        name: 'destinationChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'amount', type: 'uint256', internalType: 'uint256' },
      {
        name: 'maxFastTransferFee',
        type: 'uint256',
        internalType: 'uint256',
      },
      { name: 'receiver', type: 'bytes', internalType: 'bytes' },
      {
        name: 'settlementFeeToken',
        type: 'address',
        internalType: 'address',
      },
      { name: 'extraArgs', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [
      {
        name: 'settlementId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'computeFillId',
    inputs: [
      {
        name: 'settlementId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'sourceAmountNetFee',
        type: 'uint256',
        internalType: 'uint256',
      },
      { name: 'sourceDecimals', type: 'uint8', internalType: 'uint8' },
      { name: 'receiver', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'fastFill',
    inputs: [
      { name: 'fillId', type: 'bytes32', internalType: 'bytes32' },
      {
        name: 'settlementId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'sourceAmountNetFee',
        type: 'uint256',
        internalType: 'uint256',
      },
      { name: 'sourceDecimals', type: 'uint8', internalType: 'uint8' },
      { name: 'receiver', type: 'address', internalType: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getAccumulatedPoolFees',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAllowList',
    inputs: [],
    outputs: [{ name: '', type: 'address[]', internalType: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAllowListEnabled',
    inputs: [],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAllowedFillers',
    inputs: [],
    outputs: [{ name: '', type: 'address[]', internalType: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCcipSendTokenFee',
    inputs: [
      {
        name: 'destinationChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'amount', type: 'uint256', internalType: 'uint256' },
      { name: 'receiver', type: 'bytes', internalType: 'bytes' },
      {
        name: 'settlementFeeToken',
        type: 'address',
        internalType: 'address',
      },
      { name: 'extraArgs', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [
      {
        name: 'quote',
        type: 'tuple',
        internalType: 'struct IFastTransferPool.Quote',
        components: [
          {
            name: 'ccipSettlementFee',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'fastTransferFee',
            type: 'uint256',
            internalType: 'uint256',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCurrentInboundRateLimiterState',
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
    name: 'getCurrentOutboundRateLimiterState',
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
    name: 'getDestChainConfig',
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
        internalType: 'struct FastTransferTokenPoolAbstract.DestChainConfig',
        components: [
          {
            name: 'maxFillAmountPerRequest',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'fillerAllowlistEnabled',
            type: 'bool',
            internalType: 'bool',
          },
          {
            name: 'fastTransferFillerFeeBps',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'fastTransferPoolFeeBps',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'settlementOverheadGas',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'destinationPool',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'customExtraArgs',
            type: 'bytes',
            internalType: 'bytes',
          },
        ],
      },
      { name: '', type: 'address[]', internalType: 'address[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getFillInfo',
    inputs: [{ name: 'fillId', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct FastTransferTokenPoolAbstract.FillInfo',
        components: [
          {
            name: 'state',
            type: 'uint8',
            internalType: 'enum IFastTransferPool.FillState',
          },
          { name: 'filler', type: 'address', internalType: 'address' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getRateLimitAdmin',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
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
    name: 'getRmnProxy',
    inputs: [],
    outputs: [{ name: 'rmnProxy', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getRouter',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
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
    name: 'isAllowedFiller',
    inputs: [{ name: 'filler', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
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
        name: '',
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
    name: 'setChainRateLimiterConfig',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'outboundConfig',
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
      {
        name: 'inboundConfig',
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
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setChainRateLimiterConfigs',
    inputs: [
      {
        name: 'remoteChainSelectors',
        type: 'uint64[]',
        internalType: 'uint64[]',
      },
      {
        name: 'outboundConfigs',
        type: 'tuple[]',
        internalType: 'struct RateLimiter.Config[]',
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
        name: 'inboundConfigs',
        type: 'tuple[]',
        internalType: 'struct RateLimiter.Config[]',
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
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setRateLimitAdmin',
    inputs: [
      {
        name: 'rateLimitAdmin',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setRouter',
    inputs: [{ name: 'newRouter', type: 'address', internalType: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'supportsInterface',
    inputs: [{ name: 'interfaceId', type: 'bytes4', internalType: 'bytes4' }],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'pure',
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
    name: 'updateDestChainConfig',
    inputs: [
      {
        name: 'destChainConfigArgs',
        type: 'tuple[]',
        internalType: 'struct FastTransferTokenPoolAbstract.DestChainConfigUpdateArgs[]',
        components: [
          {
            name: 'fillerAllowlistEnabled',
            type: 'bool',
            internalType: 'bool',
          },
          {
            name: 'fastTransferFillerFeeBps',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'fastTransferPoolFeeBps',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'settlementOverheadGas',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'remoteChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'chainFamilySelector',
            type: 'bytes4',
            internalType: 'bytes4',
          },
          {
            name: 'maxFillAmountPerRequest',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'destinationPool',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'customExtraArgs',
            type: 'bytes',
            internalType: 'bytes',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'updateFillerAllowList',
    inputs: [
      {
        name: 'fillersToAdd',
        type: 'address[]',
        internalType: 'address[]',
      },
      {
        name: 'fillersToRemove',
        type: 'address[]',
        internalType: 'address[]',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdrawPoolFees',
    inputs: [{ name: 'recipient', type: 'address', internalType: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'AllowListAdd',
    inputs: [
      {
        name: 'sender',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AllowListRemove',
    inputs: [
      {
        name: 'sender',
        type: 'address',
        indexed: false,
        internalType: 'address',
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
    name: 'ChainConfigured',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
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
    name: 'ConfigChanged',
    inputs: [
      {
        name: 'config',
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
    name: 'DestChainConfigUpdated',
    inputs: [
      {
        name: 'destinationChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'fastTransferFillerFeeBps',
        type: 'uint16',
        indexed: false,
        internalType: 'uint16',
      },
      {
        name: 'fastTransferPoolFeeBps',
        type: 'uint16',
        indexed: false,
        internalType: 'uint16',
      },
      {
        name: 'maxFillAmountPerRequest',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'destinationPool',
        type: 'bytes',
        indexed: false,
        internalType: 'bytes',
      },
      {
        name: 'chainFamilySelector',
        type: 'bytes4',
        indexed: false,
        internalType: 'bytes4',
      },
      {
        name: 'settlementOverheadGas',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'fillerAllowlistEnabled',
        type: 'bool',
        indexed: false,
        internalType: 'bool',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'DestinationPoolUpdated',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'destinationPool',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'FastTransferFilled',
    inputs: [
      {
        name: 'fillId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'settlementId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'filler',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'destAmount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'receiver',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'FastTransferRequested',
    inputs: [
      {
        name: 'destinationChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'fillId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'settlementId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'sourceAmountNetFee',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'sourceDecimals',
        type: 'uint8',
        indexed: false,
        internalType: 'uint8',
      },
      {
        name: 'fillerFee',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'poolFee',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'destinationPool',
        type: 'bytes',
        indexed: false,
        internalType: 'bytes',
      },
      {
        name: 'receiver',
        type: 'bytes',
        indexed: false,
        internalType: 'bytes',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'FastTransferSettled',
    inputs: [
      {
        name: 'fillId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'settlementId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'fillerReimbursementAmount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'poolFeeAccumulated',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'prevState',
        type: 'uint8',
        indexed: false,
        internalType: 'enum IFastTransferPool.FillState',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'FillerAllowListUpdated',
    inputs: [
      {
        name: 'addFillers',
        type: 'address[]',
        indexed: false,
        internalType: 'address[]',
      },
      {
        name: 'removeFillers',
        type: 'address[]',
        indexed: false,
        internalType: 'address[]',
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
    name: 'PoolFeeWithdrawn',
    inputs: [
      {
        name: 'recipient',
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
    name: 'RateLimitAdminSet',
    inputs: [
      {
        name: 'rateLimitAdmin',
        type: 'address',
        indexed: false,
        internalType: 'address',
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
    name: 'RouterUpdated',
    inputs: [
      {
        name: 'oldRouter',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'newRouter',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  { type: 'error', name: 'AllowListNotEnabled', inputs: [] },
  {
    type: 'error',
    name: 'AlreadyFilledOrSettled',
    inputs: [{ name: 'fillId', type: 'bytes32', internalType: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'AlreadySettled',
    inputs: [{ name: 'fillId', type: 'bytes32', internalType: 'bytes32' }],
  },
  { type: 'error', name: 'BucketOverfilled', inputs: [] },
  {
    type: 'error',
    name: 'CallerIsNotARampOnRouter',
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
  {
    type: 'error',
    name: 'FillerNotAllowlisted',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'filler', type: 'address', internalType: 'address' },
    ],
  },
  {
    type: 'error',
    name: 'InsufficientPoolFees',
    inputs: [
      { name: 'requested', type: 'uint256', internalType: 'uint256' },
      { name: 'available', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidDecimalArgs',
    inputs: [
      { name: 'expected', type: 'uint8', internalType: 'uint8' },
      { name: 'actual', type: 'uint8', internalType: 'uint8' },
    ],
  },
  { type: 'error', name: 'InvalidDestChainConfig', inputs: [] },
  {
    type: 'error',
    name: 'InvalidEncodedAddress',
    inputs: [{ name: 'encodedAddress', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'InvalidFillId',
    inputs: [{ name: 'fillId', type: 'bytes32', internalType: 'bytes32' }],
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
    name: 'InvalidRouter',
    inputs: [{ name: 'router', type: 'address', internalType: 'address' }],
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
  { type: 'error', name: 'MismatchedArrayLengths', inputs: [] },
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
    name: 'QuoteFeeExceedsUserMaxLimit',
    inputs: [
      { name: 'quoteFee', type: 'uint256', internalType: 'uint256' },
      {
        name: 'maxFastTransferFee',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'SenderNotAllowed',
    inputs: [{ name: 'sender', type: 'address', internalType: 'address' }],
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
    name: 'TransferAmountExceedsMaxFillAmount',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'amount', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'Unauthorized',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'ZeroAddressInvalid', inputs: [] },
  // generate:end
] as const
