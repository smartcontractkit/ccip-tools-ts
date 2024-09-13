export default [
  // generate:
  // fetch('https://github.com/smartcontractkit/ccip/raw/release/2.14.0-ccip1.5/core/gethwrappers/ccip/generated/evm_2_evm_offramp/evm_2_evm_offramp.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  {
    inputs: [
      {
        components: [
          {
            internalType: 'address',
            name: 'commitStore',
            type: 'address',
          },
          {
            internalType: 'uint64',
            name: 'chainSelector',
            type: 'uint64',
          },
          {
            internalType: 'uint64',
            name: 'sourceChainSelector',
            type: 'uint64',
          },
          { internalType: 'address', name: 'onRamp', type: 'address' },
          {
            internalType: 'address',
            name: 'prevOffRamp',
            type: 'address',
          },
          {
            internalType: 'address',
            name: 'rmnProxy',
            type: 'address',
          },
          {
            internalType: 'address',
            name: 'tokenAdminRegistry',
            type: 'address',
          },
        ],
        internalType: 'structEVM2EVMOffRamp.StaticConfig',
        name: 'staticConfig',
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
        name: 'rateLimiterConfig',
        type: 'tuple',
      },
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
  { inputs: [], name: 'BucketOverfilled', type: 'error' },
  { inputs: [], name: 'CanOnlySelfCall', type: 'error' },
  { inputs: [], name: 'CommitStoreAlreadyInUse', type: 'error' },
  {
    inputs: [
      { internalType: 'bytes32', name: 'expected', type: 'bytes32' },
      { internalType: 'bytes32', name: 'actual', type: 'bytes32' },
    ],
    name: 'ConfigDigestMismatch',
    type: 'error',
  },
  { inputs: [], name: 'CursedByRMN', type: 'error' },
  {
    inputs: [
      { internalType: 'bytes32', name: 'messageId', type: 'bytes32' },
      {
        internalType: 'uint64',
        name: 'sequenceNumber',
        type: 'uint64',
      },
    ],
    name: 'DestinationGasAmountCountMismatch',
    type: 'error',
  },
  { inputs: [], name: 'EmptyReport', type: 'error' },
  {
    inputs: [{ internalType: 'bytes', name: 'err', type: 'bytes' }],
    name: 'ExecutionError',
    type: 'error',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'expected', type: 'uint256' },
      { internalType: 'uint256', name: 'actual', type: 'uint256' },
    ],
    name: 'ForkedChain',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'enumOCR2BaseNoChecks.InvalidConfigErrorType',
        name: 'errorType',
        type: 'uint8',
      },
    ],
    name: 'InvalidConfig',
    type: 'error',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'expected', type: 'uint256' },
      { internalType: 'uint256', name: 'got', type: 'uint256' },
    ],
    name: 'InvalidDataLength',
    type: 'error',
  },
  {
    inputs: [{ internalType: 'bytes', name: 'encodedAddress', type: 'bytes' }],
    name: 'InvalidEVMAddress',
    type: 'error',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'messageId', type: 'bytes32' },
      { internalType: 'uint256', name: 'oldLimit', type: 'uint256' },
      { internalType: 'uint256', name: 'newLimit', type: 'uint256' },
    ],
    name: 'InvalidManualExecutionGasLimit',
    type: 'error',
  },
  { inputs: [], name: 'InvalidMessageId', type: 'error' },
  {
    inputs: [
      {
        internalType: 'uint64',
        name: 'sequenceNumber',
        type: 'uint64',
      },
      {
        internalType: 'enumInternal.MessageExecutionState',
        name: 'newState',
        type: 'uint8',
      },
    ],
    name: 'InvalidNewState',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint64',
        name: 'sourceChainSelector',
        type: 'uint64',
      },
    ],
    name: 'InvalidSourceChain',
    type: 'error',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'messageId', type: 'bytes32' },
      { internalType: 'uint256', name: 'tokenIndex', type: 'uint256' },
      { internalType: 'uint256', name: 'oldLimit', type: 'uint256' },
      {
        internalType: 'uint256',
        name: 'tokenGasOverride',
        type: 'uint256',
      },
    ],
    name: 'InvalidTokenGasOverride',
    type: 'error',
  },
  {
    inputs: [],
    name: 'ManualExecutionGasLimitMismatch',
    type: 'error',
  },
  { inputs: [], name: 'ManualExecutionNotYetEnabled', type: 'error' },
  {
    inputs: [
      { internalType: 'uint256', name: 'maxSize', type: 'uint256' },
      { internalType: 'uint256', name: 'actualSize', type: 'uint256' },
    ],
    name: 'MessageTooLarge',
    type: 'error',
  },
  {
    inputs: [{ internalType: 'address', name: 'notPool', type: 'address' }],
    name: 'NotACompatiblePool',
    type: 'error',
  },
  { inputs: [], name: 'OnlyCallableByAdminOrOwner', type: 'error' },
  { inputs: [], name: 'OracleCannotBeZeroAddress', type: 'error' },
  {
    inputs: [{ internalType: 'address', name: 'token', type: 'address' }],
    name: 'PriceNotFoundForToken',
    type: 'error',
  },
  {
    inputs: [{ internalType: 'bytes', name: 'err', type: 'bytes' }],
    name: 'ReceiverError',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'amountReleased',
        type: 'uint256',
      },
      { internalType: 'uint256', name: 'balancePre', type: 'uint256' },
      { internalType: 'uint256', name: 'balancePost', type: 'uint256' },
    ],
    name: 'ReleaseOrMintBalanceMismatch',
    type: 'error',
  },
  { inputs: [], name: 'RootNotCommitted', type: 'error' },
  {
    inputs: [
      {
        internalType: 'uint64',
        name: 'sequenceNumber',
        type: 'uint64',
      },
    ],
    name: 'TokenDataMismatch',
    type: 'error',
  },
  {
    inputs: [{ internalType: 'bytes', name: 'err', type: 'bytes' }],
    name: 'TokenHandlingError',
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
  { inputs: [], name: 'UnauthorizedTransmitter', type: 'error' },
  { inputs: [], name: 'UnexpectedTokenData', type: 'error' },
  {
    inputs: [
      {
        internalType: 'uint64',
        name: 'sequenceNumber',
        type: 'uint64',
      },
    ],
    name: 'UnsupportedNumberOfTokens',
    type: 'error',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'expected', type: 'uint256' },
      { internalType: 'uint256', name: 'actual', type: 'uint256' },
    ],
    name: 'WrongMessageLength',
    type: 'error',
  },
  { inputs: [], name: 'ZeroAddressNotAllowed', type: 'error' },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'address',
        name: 'newAdmin',
        type: 'address',
      },
    ],
    name: 'AdminSet',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'uint64',
        name: 'sequenceNumber',
        type: 'uint64',
      },
    ],
    name: 'AlreadyAttempted',
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
        components: [
          {
            internalType: 'address',
            name: 'commitStore',
            type: 'address',
          },
          {
            internalType: 'uint64',
            name: 'chainSelector',
            type: 'uint64',
          },
          {
            internalType: 'uint64',
            name: 'sourceChainSelector',
            type: 'uint64',
          },
          { internalType: 'address', name: 'onRamp', type: 'address' },
          {
            internalType: 'address',
            name: 'prevOffRamp',
            type: 'address',
          },
          {
            internalType: 'address',
            name: 'rmnProxy',
            type: 'address',
          },
          {
            internalType: 'address',
            name: 'tokenAdminRegistry',
            type: 'address',
          },
        ],
        indexed: false,
        internalType: 'structEVM2EVMOffRamp.StaticConfig',
        name: 'staticConfig',
        type: 'tuple',
      },
      {
        components: [
          {
            internalType: 'uint32',
            name: 'permissionLessExecutionThresholdSeconds',
            type: 'uint32',
          },
          {
            internalType: 'uint32',
            name: 'maxDataBytes',
            type: 'uint32',
          },
          {
            internalType: 'uint16',
            name: 'maxNumberOfTokensPerMsg',
            type: 'uint16',
          },
          { internalType: 'address', name: 'router', type: 'address' },
          {
            internalType: 'address',
            name: 'priceRegistry',
            type: 'address',
          },
        ],
        indexed: false,
        internalType: 'structEVM2EVMOffRamp.DynamicConfig',
        name: 'dynamicConfig',
        type: 'tuple',
      },
    ],
    name: 'ConfigSet',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'uint32',
        name: 'previousConfigBlockNumber',
        type: 'uint32',
      },
      {
        indexed: false,
        internalType: 'bytes32',
        name: 'configDigest',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'uint64',
        name: 'configCount',
        type: 'uint64',
      },
      {
        indexed: false,
        internalType: 'address[]',
        name: 'signers',
        type: 'address[]',
      },
      {
        indexed: false,
        internalType: 'address[]',
        name: 'transmitters',
        type: 'address[]',
      },
      {
        indexed: false,
        internalType: 'uint8',
        name: 'f',
        type: 'uint8',
      },
      {
        indexed: false,
        internalType: 'bytes',
        name: 'onchainConfig',
        type: 'bytes',
      },
      {
        indexed: false,
        internalType: 'uint64',
        name: 'offchainConfigVersion',
        type: 'uint64',
      },
      {
        indexed: false,
        internalType: 'bytes',
        name: 'offchainConfig',
        type: 'bytes',
      },
    ],
    name: 'ConfigSet',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'uint64',
        name: 'sequenceNumber',
        type: 'uint64',
      },
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'messageId',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'enumInternal.MessageExecutionState',
        name: 'state',
        type: 'uint8',
      },
      {
        indexed: false,
        internalType: 'bytes',
        name: 'returnData',
        type: 'bytes',
      },
    ],
    name: 'ExecutionStateChanged',
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
        internalType: 'uint64',
        name: 'sequenceNumber',
        type: 'uint64',
      },
    ],
    name: 'SkippedAlreadyExecutedMessage',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'uint64',
        name: 'nonce',
        type: 'uint64',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'sender',
        type: 'address',
      },
    ],
    name: 'SkippedIncorrectNonce',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'uint64',
        name: 'nonce',
        type: 'uint64',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'sender',
        type: 'address',
      },
    ],
    name: 'SkippedSenderWithPreviousRampMessageInflight',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'address',
        name: 'sourceToken',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'address',
        name: 'destToken',
        type: 'address',
      },
    ],
    name: 'TokenAggregateRateLimitAdded',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'address',
        name: 'sourceToken',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'address',
        name: 'destToken',
        type: 'address',
      },
    ],
    name: 'TokenAggregateRateLimitRemoved',
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
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'bytes32',
        name: 'configDigest',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'uint32',
        name: 'epoch',
        type: 'uint32',
      },
    ],
    name: 'Transmitted',
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
        components: [
          {
            internalType: 'bytes32',
            name: 'messageId',
            type: 'bytes32',
          },
          {
            internalType: 'uint64',
            name: 'sourceChainSelector',
            type: 'uint64',
          },
          { internalType: 'bytes', name: 'sender', type: 'bytes' },
          { internalType: 'bytes', name: 'data', type: 'bytes' },
          {
            components: [
              {
                internalType: 'address',
                name: 'token',
                type: 'address',
              },
              {
                internalType: 'uint256',
                name: 'amount',
                type: 'uint256',
              },
            ],
            internalType: 'structClient.EVMTokenAmount[]',
            name: 'destTokenAmounts',
            type: 'tuple[]',
          },
        ],
        internalType: 'structClient.Any2EVMMessage',
        name: '',
        type: 'tuple',
      },
    ],
    name: 'ccipReceive',
    outputs: [],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [],
    name: 'currentRateLimiterState',
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
        components: [
          {
            internalType: 'uint64',
            name: 'sourceChainSelector',
            type: 'uint64',
          },
          { internalType: 'address', name: 'sender', type: 'address' },
          {
            internalType: 'address',
            name: 'receiver',
            type: 'address',
          },
          {
            internalType: 'uint64',
            name: 'sequenceNumber',
            type: 'uint64',
          },
          {
            internalType: 'uint256',
            name: 'gasLimit',
            type: 'uint256',
          },
          { internalType: 'bool', name: 'strict', type: 'bool' },
          { internalType: 'uint64', name: 'nonce', type: 'uint64' },
          {
            internalType: 'address',
            name: 'feeToken',
            type: 'address',
          },
          {
            internalType: 'uint256',
            name: 'feeTokenAmount',
            type: 'uint256',
          },
          { internalType: 'bytes', name: 'data', type: 'bytes' },
          {
            components: [
              {
                internalType: 'address',
                name: 'token',
                type: 'address',
              },
              {
                internalType: 'uint256',
                name: 'amount',
                type: 'uint256',
              },
            ],
            internalType: 'structClient.EVMTokenAmount[]',
            name: 'tokenAmounts',
            type: 'tuple[]',
          },
          {
            internalType: 'bytes[]',
            name: 'sourceTokenData',
            type: 'bytes[]',
          },
          {
            internalType: 'bytes32',
            name: 'messageId',
            type: 'bytes32',
          },
        ],
        internalType: 'structInternal.EVM2EVMMessage',
        name: 'message',
        type: 'tuple',
      },
      {
        internalType: 'bytes[]',
        name: 'offchainTokenData',
        type: 'bytes[]',
      },
      {
        internalType: 'uint32[]',
        name: 'tokenGasOverrides',
        type: 'uint32[]',
      },
    ],
    name: 'executeSingleMessage',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getAllRateLimitTokens',
    outputs: [
      {
        internalType: 'address[]',
        name: 'sourceTokens',
        type: 'address[]',
      },
      {
        internalType: 'address[]',
        name: 'destTokens',
        type: 'address[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getDynamicConfig',
    outputs: [
      {
        components: [
          {
            internalType: 'uint32',
            name: 'permissionLessExecutionThresholdSeconds',
            type: 'uint32',
          },
          {
            internalType: 'uint32',
            name: 'maxDataBytes',
            type: 'uint32',
          },
          {
            internalType: 'uint16',
            name: 'maxNumberOfTokensPerMsg',
            type: 'uint16',
          },
          { internalType: 'address', name: 'router', type: 'address' },
          {
            internalType: 'address',
            name: 'priceRegistry',
            type: 'address',
          },
        ],
        internalType: 'structEVM2EVMOffRamp.DynamicConfig',
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
        name: 'sequenceNumber',
        type: 'uint64',
      },
    ],
    name: 'getExecutionState',
    outputs: [
      {
        internalType: 'enumInternal.MessageExecutionState',
        name: '',
        type: 'uint8',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'sender', type: 'address' }],
    name: 'getSenderNonce',
    outputs: [{ internalType: 'uint64', name: 'nonce', type: 'uint64' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getStaticConfig',
    outputs: [
      {
        components: [
          {
            internalType: 'address',
            name: 'commitStore',
            type: 'address',
          },
          {
            internalType: 'uint64',
            name: 'chainSelector',
            type: 'uint64',
          },
          {
            internalType: 'uint64',
            name: 'sourceChainSelector',
            type: 'uint64',
          },
          { internalType: 'address', name: 'onRamp', type: 'address' },
          {
            internalType: 'address',
            name: 'prevOffRamp',
            type: 'address',
          },
          {
            internalType: 'address',
            name: 'rmnProxy',
            type: 'address',
          },
          {
            internalType: 'address',
            name: 'tokenAdminRegistry',
            type: 'address',
          },
        ],
        internalType: 'structEVM2EVMOffRamp.StaticConfig',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getTokenLimitAdmin',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getTransmitters',
    outputs: [{ internalType: 'address[]', name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'latestConfigDetails',
    outputs: [
      { internalType: 'uint32', name: 'configCount', type: 'uint32' },
      { internalType: 'uint32', name: 'blockNumber', type: 'uint32' },
      {
        internalType: 'bytes32',
        name: 'configDigest',
        type: 'bytes32',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'latestConfigDigestAndEpoch',
    outputs: [
      { internalType: 'bool', name: 'scanLogs', type: 'bool' },
      {
        internalType: 'bytes32',
        name: 'configDigest',
        type: 'bytes32',
      },
      { internalType: 'uint32', name: 'epoch', type: 'uint32' },
    ],
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
                internalType: 'uint64',
                name: 'sourceChainSelector',
                type: 'uint64',
              },
              {
                internalType: 'address',
                name: 'sender',
                type: 'address',
              },
              {
                internalType: 'address',
                name: 'receiver',
                type: 'address',
              },
              {
                internalType: 'uint64',
                name: 'sequenceNumber',
                type: 'uint64',
              },
              {
                internalType: 'uint256',
                name: 'gasLimit',
                type: 'uint256',
              },
              { internalType: 'bool', name: 'strict', type: 'bool' },
              { internalType: 'uint64', name: 'nonce', type: 'uint64' },
              {
                internalType: 'address',
                name: 'feeToken',
                type: 'address',
              },
              {
                internalType: 'uint256',
                name: 'feeTokenAmount',
                type: 'uint256',
              },
              { internalType: 'bytes', name: 'data', type: 'bytes' },
              {
                components: [
                  {
                    internalType: 'address',
                    name: 'token',
                    type: 'address',
                  },
                  {
                    internalType: 'uint256',
                    name: 'amount',
                    type: 'uint256',
                  },
                ],
                internalType: 'structClient.EVMTokenAmount[]',
                name: 'tokenAmounts',
                type: 'tuple[]',
              },
              {
                internalType: 'bytes[]',
                name: 'sourceTokenData',
                type: 'bytes[]',
              },
              {
                internalType: 'bytes32',
                name: 'messageId',
                type: 'bytes32',
              },
            ],
            internalType: 'structInternal.EVM2EVMMessage[]',
            name: 'messages',
            type: 'tuple[]',
          },
          {
            internalType: 'bytes[][]',
            name: 'offchainTokenData',
            type: 'bytes[][]',
          },
          {
            internalType: 'bytes32[]',
            name: 'proofs',
            type: 'bytes32[]',
          },
          {
            internalType: 'uint256',
            name: 'proofFlagBits',
            type: 'uint256',
          },
        ],
        internalType: 'structInternal.ExecutionReport',
        name: 'report',
        type: 'tuple',
      },
      {
        components: [
          {
            internalType: 'uint256',
            name: 'receiverExecutionGasLimit',
            type: 'uint256',
          },
          {
            internalType: 'uint32[]',
            name: 'tokenGasOverrides',
            type: 'uint32[]',
          },
        ],
        internalType: 'structEVM2EVMOffRamp.GasLimitOverride[]',
        name: 'gasLimitOverrides',
        type: 'tuple[]',
      },
    ],
    name: 'manuallyExecute',
    outputs: [],
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
    inputs: [{ internalType: 'address', name: 'newAdmin', type: 'address' }],
    name: 'setAdmin',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address[]', name: 'signers', type: 'address[]' },
      {
        internalType: 'address[]',
        name: 'transmitters',
        type: 'address[]',
      },
      { internalType: 'uint8', name: 'f', type: 'uint8' },
      { internalType: 'bytes', name: 'onchainConfig', type: 'bytes' },
      {
        internalType: 'uint64',
        name: 'offchainConfigVersion',
        type: 'uint64',
      },
      { internalType: 'bytes', name: 'offchainConfig', type: 'bytes' },
    ],
    name: 'setOCR2Config',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
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
    name: 'setRateLimiterConfig',
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
    inputs: [
      {
        internalType: 'bytes32[3]',
        name: 'reportContext',
        type: 'bytes32[3]',
      },
      { internalType: 'bytes', name: 'report', type: 'bytes' },
      { internalType: 'bytes32[]', name: 'rs', type: 'bytes32[]' },
      { internalType: 'bytes32[]', name: 'ss', type: 'bytes32[]' },
      { internalType: 'bytes32', name: '', type: 'bytes32' },
    ],
    name: 'transmit',
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
            internalType: 'address',
            name: 'sourceToken',
            type: 'address',
          },
          {
            internalType: 'address',
            name: 'destToken',
            type: 'address',
          },
        ],
        internalType: 'structEVM2EVMOffRamp.RateLimitToken[]',
        name: 'removes',
        type: 'tuple[]',
      },
      {
        components: [
          {
            internalType: 'address',
            name: 'sourceToken',
            type: 'address',
          },
          {
            internalType: 'address',
            name: 'destToken',
            type: 'address',
          },
        ],
        internalType: 'structEVM2EVMOffRamp.RateLimitToken[]',
        name: 'adds',
        type: 'tuple[]',
      },
    ],
    name: 'updateRateLimitTokens',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // generate:end
] as const
