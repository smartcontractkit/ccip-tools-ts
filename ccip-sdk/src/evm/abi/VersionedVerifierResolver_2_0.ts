// TODO: track a v2 release tag and the v2.0.0 folder instead of a commit + latest/ folder, once 2.0.0 is released in `chainlink-ccip`
export default [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/refs/heads/develop/ccv/chains/evm/gobindings/generated/latest/versioned_verifier_resolver/versioned_verifier_resolver.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  {
    type: 'function',
    name: 'acceptOwnership',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'applyInboundImplementationUpdates',
    inputs: [
      {
        name: 'implementations',
        type: 'tuple[]',
        internalType: 'struct VersionedVerifierResolver.InboundImplementationArgs[]',
        components: [
          { name: 'version', type: 'bytes4', internalType: 'bytes4' },
          {
            name: 'verifier',
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
    name: 'applyOutboundImplementationUpdates',
    inputs: [
      {
        name: 'implementations',
        type: 'tuple[]',
        internalType: 'struct VersionedVerifierResolver.OutboundImplementationArgs[]',
        components: [
          {
            name: 'destChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'verifier',
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
    name: 'getAllInboundImplementations',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        internalType: 'struct VersionedVerifierResolver.InboundImplementationArgs[]',
        components: [
          { name: 'version', type: 'bytes4', internalType: 'bytes4' },
          {
            name: 'verifier',
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
    name: 'getAllOutboundImplementations',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        internalType: 'struct VersionedVerifierResolver.OutboundImplementationArgs[]',
        components: [
          {
            name: 'destChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'verifier',
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
    name: 'getFeeAggregator',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getInboundImplementation',
    inputs: [{ name: 'verifierResults', type: 'bytes', internalType: 'bytes' }],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getOutboundImplementation',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: '', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
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
    name: 'FeeAggregatorUpdated',
    inputs: [
      {
        name: 'oldFeeAggregator',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'newFeeAggregator',
        type: 'address',
        indexed: true,
        internalType: 'address',
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
    name: 'InboundImplementationRemoved',
    inputs: [
      {
        name: 'version',
        type: 'bytes4',
        indexed: false,
        internalType: 'bytes4',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'InboundImplementationUpdated',
    inputs: [
      {
        name: 'version',
        type: 'bytes4',
        indexed: false,
        internalType: 'bytes4',
      },
      {
        name: 'prevImpl',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'newImpl',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'OutboundImplementationRemoved',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'OutboundImplementationUpdated',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
      },
      {
        name: 'prevImpl',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'newImpl',
        type: 'address',
        indexed: false,
        internalType: 'address',
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
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  {
    type: 'error',
    name: 'InvalidDestChainSelector',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'InvalidVerifierResultsLength', inputs: [] },
  {
    type: 'error',
    name: 'InvalidVersion',
    inputs: [{ name: 'version', type: 'bytes4', internalType: 'bytes4' }],
  },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'SafeERC20FailedOperation',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  // generate:end
] as const
