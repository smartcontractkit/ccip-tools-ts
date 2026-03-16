// TODO: track a v2 release tag and the v2.0.0 folder instead of a commit + latest/ folder, once 2.0.0 is released in `chainlink-ccip`
export default [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/refs/heads/develop/ccv/chains/evm/gobindings/generated/latest/usdc_token_pool_proxy/usdc_token_pool_proxy.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  {
    type: 'constructor',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'contract IERC20',
      },
      {
        name: 'pools',
        type: 'tuple',
        internalType: 'struct USDCTokenPoolProxy.PoolAddresses',
        components: [
          {
            name: 'cctpV1Pool',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'cctpV2Pool',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'cctpV2PoolWithCCV',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'siloedLockReleasePool',
            type: 'address',
            internalType: 'address',
          },
        ],
      },
      { name: 'router', type: 'address', internalType: 'address' },
      {
        name: 'cctpVerifier',
        type: 'address',
        internalType: 'address',
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
    name: 'getFee',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'destChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'amount', type: 'uint256', internalType: 'uint256' },
      { name: 'feeToken', type: 'address', internalType: 'address' },
      {
        name: 'blockConfirmationsRequested',
        type: 'uint16',
        internalType: 'uint16',
      },
      { name: 'tokenArgs', type: 'bytes', internalType: 'bytes' },
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
    name: 'getFeeAggregator',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getLockOrBurnMechanism',
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
        type: 'uint8',
        internalType: 'enum USDCTokenPoolProxy.LockOrBurnMechanism',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPools',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct USDCTokenPoolProxy.PoolAddresses',
        components: [
          {
            name: 'cctpV1Pool',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'cctpV2Pool',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'cctpV2PoolWithCCV',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'siloedLockReleasePool',
            type: 'address',
            internalType: 'address',
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
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: '', type: 'uint256', internalType: 'uint256' },
      { name: '', type: 'uint16', internalType: 'uint16' },
      { name: 'extraData', type: 'bytes', internalType: 'bytes' },
      {
        name: 'direction',
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
    name: 'getStaticConfig',
    inputs: [],
    outputs: [
      { name: 'token', type: 'address', internalType: 'address' },
      { name: 'router', type: 'address', internalType: 'address' },
      {
        name: 'cctpVerifier',
        type: 'address',
        internalType: 'address',
      },
    ],
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
    name: 'getTokenTransferFeeConfig',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'destChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'blockConfirmationsRequested',
        type: 'uint16',
        internalType: 'uint16',
      },
      { name: 'tokenArgs', type: 'bytes', internalType: 'bytes' },
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
            name: 'defaultBlockConfirmationsFeeUSDCents',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'customBlockConfirmationsFeeUSDCents',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'defaultBlockConfirmationsTransferFeeBps',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'customBlockConfirmationsTransferFeeBps',
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
        name: 'blockConfirmationsRequested',
        type: 'uint16',
        internalType: 'uint16',
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
      {
        name: 'blockConfirmationsRequested',
        type: 'uint16',
        internalType: 'uint16',
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
    name: 'setFeeAggregator',
    inputs: [
      {
        name: 'feeAggregator',
        type: 'address',
        internalType: 'address',
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
    name: 'updateLockOrBurnMechanisms',
    inputs: [
      {
        name: 'remoteChainSelectors',
        type: 'uint64[]',
        internalType: 'uint64[]',
      },
      {
        name: 'mechanisms',
        type: 'uint8[]',
        internalType: 'enum USDCTokenPoolProxy.LockOrBurnMechanism[]',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'updatePoolAddresses',
    inputs: [
      {
        name: 'pools',
        type: 'tuple',
        internalType: 'struct USDCTokenPoolProxy.PoolAddresses',
        components: [
          {
            name: 'cctpV1Pool',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'cctpV2Pool',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'cctpV2PoolWithCCV',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'siloedLockReleasePool',
            type: 'address',
            internalType: 'address',
          },
        ],
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
    ],
    outputs: [],
    stateMutability: 'nonpayable',
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
    name: 'LockOrBurnMechanismUpdated',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'mechanism',
        type: 'uint8',
        indexed: false,
        internalType: 'enum USDCTokenPoolProxy.LockOrBurnMechanism',
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
    name: 'PoolAddressesUpdated',
    inputs: [
      {
        name: 'pools',
        type: 'tuple',
        indexed: false,
        internalType: 'struct USDCTokenPoolProxy.PoolAddresses',
        components: [
          {
            name: 'cctpV1Pool',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'cctpV2Pool',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'cctpV2PoolWithCCV',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'siloedLockReleasePool',
            type: 'address',
            internalType: 'address',
          },
        ],
      },
    ],
    anonymous: false,
  },
  { type: 'error', name: 'AddressCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'CallerIsNotARampOnRouter',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  {
    type: 'error',
    name: 'ChainNotSupportedByVerifier',
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
    name: 'InvalidLockOrBurnMechanism',
    inputs: [
      {
        name: 'mechanism',
        type: 'uint8',
        internalType: 'enum USDCTokenPoolProxy.LockOrBurnMechanism',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidMessageVersion',
    inputs: [{ name: 'version', type: 'bytes4', internalType: 'bytes4' }],
  },
  { type: 'error', name: 'MismatchedArrayLengths', inputs: [] },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  {
    type: 'error',
    name: 'MustSetPoolForMechanism',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'mechanism',
        type: 'uint8',
        internalType: 'enum USDCTokenPoolProxy.LockOrBurnMechanism',
      },
    ],
  },
  {
    type: 'error',
    name: 'NoLockOrBurnMechanismSet',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  { type: 'error', name: 'PoolAddressCannotBeSelf', inputs: [] },
  {
    type: 'error',
    name: 'SafeERC20FailedOperation',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'TokenPoolUnsupported',
    inputs: [{ name: 'pool', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  // generate:end
] as const
