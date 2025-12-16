export default [
  // generate:
  // fetch('https://github.com/smartcontractkit/ccip/raw/release/2.17.0-ccip1.5/core/gethwrappers/ccip/generated/price_registry_1_2_0/price_registry.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  {
    inputs: [
      {
        internalType: 'address[]',
        name: 'priceUpdaters',
        type: 'address[]',
      },
      {
        internalType: 'address[]',
        name: 'feeTokens',
        type: 'address[]',
      },
      {
        internalType: 'uint32',
        name: 'stalenessThreshold',
        type: 'uint32',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },
  {
    inputs: [{ internalType: 'uint64', name: 'chain', type: 'uint64' }],
    name: 'ChainNotSupported',
    type: 'error',
  },
  { inputs: [], name: 'InvalidStalenessThreshold', type: 'error' },
  { inputs: [], name: 'OnlyCallableByUpdaterOrOwner', type: 'error' },
  {
    inputs: [
      {
        internalType: 'uint64',
        name: 'destChainSelector',
        type: 'uint64',
      },
      { internalType: 'uint256', name: 'threshold', type: 'uint256' },
      { internalType: 'uint256', name: 'timePassed', type: 'uint256' },
    ],
    name: 'StaleGasPrice',
    type: 'error',
  },
  {
    inputs: [
      { internalType: 'address', name: 'token', type: 'address' },
      { internalType: 'uint256', name: 'threshold', type: 'uint256' },
      { internalType: 'uint256', name: 'timePassed', type: 'uint256' },
    ],
    name: 'StaleTokenPrice',
    type: 'error',
  },
  {
    inputs: [{ internalType: 'address', name: 'token', type: 'address' }],
    name: 'TokenNotSupported',
    type: 'error',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'feeToken',
        type: 'address',
      },
    ],
    name: 'FeeTokenAdded',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'feeToken',
        type: 'address',
      },
    ],
    name: 'FeeTokenRemoved',
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
        name: 'priceUpdater',
        type: 'address',
      },
    ],
    name: 'PriceUpdaterRemoved',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'priceUpdater',
        type: 'address',
      },
    ],
    name: 'PriceUpdaterSet',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'token',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'value',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'timestamp',
        type: 'uint256',
      },
    ],
    name: 'UsdPerTokenUpdated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'uint64',
        name: 'destChain',
        type: 'uint64',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'value',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'timestamp',
        type: 'uint256',
      },
    ],
    name: 'UsdPerUnitGasUpdated',
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
      {
        internalType: 'address[]',
        name: 'feeTokensToAdd',
        type: 'address[]',
      },
      {
        internalType: 'address[]',
        name: 'feeTokensToRemove',
        type: 'address[]',
      },
    ],
    name: 'applyFeeTokensUpdates',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address[]',
        name: 'priceUpdatersToAdd',
        type: 'address[]',
      },
      {
        internalType: 'address[]',
        name: 'priceUpdatersToRemove',
        type: 'address[]',
      },
    ],
    name: 'applyPriceUpdatersUpdates',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'fromToken', type: 'address' },
      {
        internalType: 'uint256',
        name: 'fromTokenAmount',
        type: 'uint256',
      },
      { internalType: 'address', name: 'toToken', type: 'address' },
    ],
    name: 'convertTokenAmount',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint64',
        name: 'destChainSelector',
        type: 'uint64',
      },
    ],
    name: 'getDestinationChainGasPrice',
    outputs: [
      {
        components: [
          { internalType: 'uint224', name: 'value', type: 'uint224' },
          { internalType: 'uint32', name: 'timestamp', type: 'uint32' },
        ],
        internalType: 'structInternal.TimestampedPackedUint224',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getFeeTokens',
    outputs: [{ internalType: 'address[]', name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getPriceUpdaters',
    outputs: [{ internalType: 'address[]', name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getStalenessThreshold',
    outputs: [{ internalType: 'uint128', name: '', type: 'uint128' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'token', type: 'address' },
      {
        internalType: 'uint64',
        name: 'destChainSelector',
        type: 'uint64',
      },
    ],
    name: 'getTokenAndGasPrices',
    outputs: [
      { internalType: 'uint224', name: 'tokenPrice', type: 'uint224' },
      {
        internalType: 'uint224',
        name: 'gasPriceValue',
        type: 'uint224',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'token', type: 'address' }],
    name: 'getTokenPrice',
    outputs: [
      {
        components: [
          { internalType: 'uint224', name: 'value', type: 'uint224' },
          { internalType: 'uint32', name: 'timestamp', type: 'uint32' },
        ],
        internalType: 'structInternal.TimestampedPackedUint224',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address[]', name: 'tokens', type: 'address[]' }],
    name: 'getTokenPrices',
    outputs: [
      {
        components: [
          { internalType: 'uint224', name: 'value', type: 'uint224' },
          { internalType: 'uint32', name: 'timestamp', type: 'uint32' },
        ],
        internalType: 'structInternal.TimestampedPackedUint224[]',
        name: '',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'token', type: 'address' }],
    name: 'getValidatedTokenPrice',
    outputs: [{ internalType: 'uint224', name: '', type: 'uint224' }],
    stateMutability: 'view',
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
    inputs: [
      {
        components: [
          {
            components: [
              {
                internalType: 'address',
                name: 'sourceToken',
                type: 'address',
              },
              {
                internalType: 'uint224',
                name: 'usdPerToken',
                type: 'uint224',
              },
            ],
            internalType: 'structInternal.TokenPriceUpdate[]',
            name: 'tokenPriceUpdates',
            type: 'tuple[]',
          },
          {
            components: [
              {
                internalType: 'uint64',
                name: 'destChainSelector',
                type: 'uint64',
              },
              {
                internalType: 'uint224',
                name: 'usdPerUnitGas',
                type: 'uint224',
              },
            ],
            internalType: 'structInternal.GasPriceUpdate[]',
            name: 'gasPriceUpdates',
            type: 'tuple[]',
          },
        ],
        internalType: 'structInternal.PriceUpdates',
        name: 'priceUpdates',
        type: 'tuple',
      },
    ],
    name: 'updatePrices',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // generate:end
] as const
