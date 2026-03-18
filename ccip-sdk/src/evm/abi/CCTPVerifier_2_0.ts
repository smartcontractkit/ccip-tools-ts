// TODO: track a v2 release tag and the v2.0.0 folder instead of a commit + latest/ folder, once 2.0.0 is released in `chainlink-ccip`
export default [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/refs/heads/develop/ccv/chains/evm/gobindings/generated/latest/cctp_verifier/cctp_verifier.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  {
    type: 'constructor',
    inputs: [
      {
        name: 'tokenMessenger',
        type: 'address',
        internalType: 'contract ITokenMessenger',
      },
      {
        name: 'messageTransmitterProxy',
        type: 'address',
        internalType: 'contract CCTPMessageTransmitterProxy',
      },
      {
        name: 'usdcToken',
        type: 'address',
        internalType: 'contract IERC20',
      },
      {
        name: 'storageLocations',
        type: 'string[]',
        internalType: 'string[]',
      },
      {
        name: 'dynamicConfig',
        type: 'tuple',
        internalType: 'struct CCTPVerifier.DynamicConfig',
        components: [
          {
            name: 'feeAggregator',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'allowlistAdmin',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'fastFinalityBps',
            type: 'uint16',
            internalType: 'uint16',
          },
        ],
      },
      { name: 'rmn', type: 'address', internalType: 'address' },
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
    name: 'applyAllowlistUpdates',
    inputs: [
      {
        name: 'allowlistConfigArgsItems',
        type: 'tuple[]',
        internalType: 'struct BaseVerifier.AllowlistConfigArgs[]',
        components: [
          {
            name: 'destChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'allowlistEnabled',
            type: 'bool',
            internalType: 'bool',
          },
          {
            name: 'addedAllowlistedSenders',
            type: 'address[]',
            internalType: 'address[]',
          },
          {
            name: 'removedAllowlistedSenders',
            type: 'address[]',
            internalType: 'address[]',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'applyRemoteChainConfigUpdates',
    inputs: [
      {
        name: 'remoteChainConfigArgs',
        type: 'tuple[]',
        internalType: 'struct BaseVerifier.RemoteChainConfigArgs[]',
        components: [
          {
            name: 'router',
            type: 'address',
            internalType: 'contract IRouter',
          },
          {
            name: 'remoteChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'allowlistEnabled',
            type: 'bool',
            internalType: 'bool',
          },
          {
            name: 'feeUSDCents',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'gasForVerification',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'payloadSizeBytes',
            type: 'uint32',
            internalType: 'uint32',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'forwardToVerifier',
    inputs: [
      {
        name: 'message',
        type: 'tuple',
        internalType: 'struct MessageV1Codec.MessageV1',
        components: [
          {
            name: 'sourceChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'destChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'messageNumber',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'executionGasLimit',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'ccipReceiveGasLimit',
            type: 'uint32',
            internalType: 'uint32',
          },
          { name: 'finality', type: 'uint16', internalType: 'uint16' },
          {
            name: 'ccvAndExecutorHash',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'onRampAddress',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'offRampAddress',
            type: 'bytes',
            internalType: 'bytes',
          },
          { name: 'sender', type: 'bytes', internalType: 'bytes' },
          { name: 'receiver', type: 'bytes', internalType: 'bytes' },
          { name: 'destBlob', type: 'bytes', internalType: 'bytes' },
          {
            name: 'tokenTransfer',
            type: 'tuple[]',
            internalType: 'struct MessageV1Codec.TokenTransferV1[]',
            components: [
              {
                name: 'amount',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'sourcePoolAddress',
                type: 'bytes',
                internalType: 'bytes',
              },
              {
                name: 'sourceTokenAddress',
                type: 'bytes',
                internalType: 'bytes',
              },
              {
                name: 'destTokenAddress',
                type: 'bytes',
                internalType: 'bytes',
              },
              {
                name: 'tokenReceiver',
                type: 'bytes',
                internalType: 'bytes',
              },
              {
                name: 'extraData',
                type: 'bytes',
                internalType: 'bytes',
              },
            ],
          },
          { name: 'data', type: 'bytes', internalType: 'bytes' },
        ],
      },
      { name: 'messageId', type: 'bytes32', internalType: 'bytes32' },
      { name: '', type: 'address', internalType: 'address' },
      { name: '', type: 'uint256', internalType: 'uint256' },
      { name: 'verifierArgs', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [
      {
        name: 'verifierReturnData',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getDomain',
    inputs: [{ name: 'chainSelector', type: 'uint64', internalType: 'uint64' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct CCTPVerifier.Domain',
        components: [
          {
            name: 'allowedCallerOnDest',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'allowedCallerOnSource',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'mintRecipientOnDest',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'domainIdentifier',
            type: 'uint32',
            internalType: 'uint32',
          },
          { name: 'enabled', type: 'bool', internalType: 'bool' },
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
      {
        name: 'dynamicConfig',
        type: 'tuple',
        internalType: 'struct CCTPVerifier.DynamicConfig',
        components: [
          {
            name: 'feeAggregator',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'allowlistAdmin',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'fastFinalityBps',
            type: 'uint16',
            internalType: 'uint16',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getFee',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: '',
        type: 'tuple',
        internalType: 'struct Client.EVM2AnyMessage',
        components: [
          { name: 'receiver', type: 'bytes', internalType: 'bytes' },
          { name: 'data', type: 'bytes', internalType: 'bytes' },
          {
            name: 'tokenAmounts',
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
          {
            name: 'feeToken',
            type: 'address',
            internalType: 'address',
          },
          { name: 'extraArgs', type: 'bytes', internalType: 'bytes' },
        ],
      },
      { name: '', type: 'bytes', internalType: 'bytes' },
      { name: '', type: 'uint16', internalType: 'uint16' },
    ],
    outputs: [
      { name: 'feeUSDCents', type: 'uint16', internalType: 'uint16' },
      {
        name: 'gasForVerification',
        type: 'uint32',
        internalType: 'uint32',
      },
      {
        name: 'payloadSizeBytes',
        type: 'uint32',
        internalType: 'uint32',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getRemoteChainConfig',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
    outputs: [
      { name: 'allowlistEnabled', type: 'bool', internalType: 'bool' },
      { name: 'router', type: 'address', internalType: 'address' },
      {
        name: 'allowedSendersList',
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
      {
        name: 'tokenMessenger',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'messageTransmitterProxy',
        type: 'address',
        internalType: 'address',
      },
      { name: 'usdcToken', type: 'address', internalType: 'address' },
      {
        name: 'localDomainIdentifier',
        type: 'uint32',
        internalType: 'uint32',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getStorageLocations',
    inputs: [],
    outputs: [{ name: '', type: 'string[]', internalType: 'string[]' }],
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
    name: 'setDomains',
    inputs: [
      {
        name: 'domains',
        type: 'tuple[]',
        internalType: 'struct CCTPVerifier.SetDomainArgs[]',
        components: [
          {
            name: 'allowedCallerOnDest',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'allowedCallerOnSource',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'mintRecipientOnDest',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'chainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'domainIdentifier',
            type: 'uint32',
            internalType: 'uint32',
          },
          { name: 'enabled', type: 'bool', internalType: 'bool' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setDynamicConfig',
    inputs: [
      {
        name: 'dynamicConfig',
        type: 'tuple',
        internalType: 'struct CCTPVerifier.DynamicConfig',
        components: [
          {
            name: 'feeAggregator',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'allowlistAdmin',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'fastFinalityBps',
            type: 'uint16',
            internalType: 'uint16',
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
    name: 'updateStorageLocations',
    inputs: [
      {
        name: 'newLocations',
        type: 'string[]',
        internalType: 'string[]',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'verifyMessage',
    inputs: [
      {
        name: 'message',
        type: 'tuple',
        internalType: 'struct MessageV1Codec.MessageV1',
        components: [
          {
            name: 'sourceChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'destChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'messageNumber',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'executionGasLimit',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'ccipReceiveGasLimit',
            type: 'uint32',
            internalType: 'uint32',
          },
          { name: 'finality', type: 'uint16', internalType: 'uint16' },
          {
            name: 'ccvAndExecutorHash',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'onRampAddress',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'offRampAddress',
            type: 'bytes',
            internalType: 'bytes',
          },
          { name: 'sender', type: 'bytes', internalType: 'bytes' },
          { name: 'receiver', type: 'bytes', internalType: 'bytes' },
          { name: 'destBlob', type: 'bytes', internalType: 'bytes' },
          {
            name: 'tokenTransfer',
            type: 'tuple[]',
            internalType: 'struct MessageV1Codec.TokenTransferV1[]',
            components: [
              {
                name: 'amount',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'sourcePoolAddress',
                type: 'bytes',
                internalType: 'bytes',
              },
              {
                name: 'sourceTokenAddress',
                type: 'bytes',
                internalType: 'bytes',
              },
              {
                name: 'destTokenAddress',
                type: 'bytes',
                internalType: 'bytes',
              },
              {
                name: 'tokenReceiver',
                type: 'bytes',
                internalType: 'bytes',
              },
              {
                name: 'extraData',
                type: 'bytes',
                internalType: 'bytes',
              },
            ],
          },
          { name: 'data', type: 'bytes', internalType: 'bytes' },
        ],
      },
      { name: 'messageHash', type: 'bytes32', internalType: 'bytes32' },
      { name: 'verifierResults', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'versionTag',
    inputs: [],
    outputs: [{ name: '', type: 'bytes4', internalType: 'bytes4' }],
    stateMutability: 'pure',
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
    name: 'AllowListSendersAdded',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'senders',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AllowListSendersRemoved',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'senders',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AllowListStateChanged',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'allowlistEnabled',
        type: 'bool',
        indexed: false,
        internalType: 'bool',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'DomainsSet',
    inputs: [
      {
        name: 'domains',
        type: 'tuple[]',
        indexed: false,
        internalType: 'struct CCTPVerifier.SetDomainArgs[]',
        components: [
          {
            name: 'allowedCallerOnDest',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'allowedCallerOnSource',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'mintRecipientOnDest',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'chainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'domainIdentifier',
            type: 'uint32',
            internalType: 'uint32',
          },
          { name: 'enabled', type: 'bool', internalType: 'bool' },
        ],
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'DynamicConfigSet',
    inputs: [
      {
        name: 'dynamicConfig',
        type: 'tuple',
        indexed: false,
        internalType: 'struct CCTPVerifier.DynamicConfig',
        components: [
          {
            name: 'feeAggregator',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'allowlistAdmin',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'fastFinalityBps',
            type: 'uint16',
            internalType: 'uint16',
          },
        ],
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
    name: 'RemoteChainConfigSet',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'router',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'allowlistEnabled',
        type: 'bool',
        indexed: false,
        internalType: 'bool',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'StaticConfigSet',
    inputs: [
      {
        name: 'tokenMessenger',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'messageTransmitterProxy',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'usdcToken',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'localDomainIdentifier',
        type: 'uint32',
        indexed: false,
        internalType: 'uint32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'StorageLocationsUpdated',
    inputs: [
      {
        name: 'oldLocations',
        type: 'string[]',
        indexed: false,
        internalType: 'string[]',
      },
      {
        name: 'newLocations',
        type: 'string[]',
        indexed: false,
        internalType: 'string[]',
      },
    ],
    anonymous: false,
  },
  {
    type: 'error',
    name: 'CallerIsNotARampOnRouter',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  {
    type: 'error',
    name: 'CursedByRMN',
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
    name: 'DestGasCannotBeZero',
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
    name: 'Invalid32ByteAddress',
    inputs: [{ name: 'encodedAddress', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'InvalidAllowListRequest',
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
    name: 'InvalidCCVVersion',
    inputs: [
      { name: 'expected', type: 'bytes4', internalType: 'bytes4' },
      { name: 'got', type: 'bytes4', internalType: 'bytes4' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidFastFinalityBps',
    inputs: [
      {
        name: 'fastFinalityBps',
        type: 'uint16',
        internalType: 'uint16',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidMessageId',
    inputs: [
      { name: 'expected', type: 'bytes32', internalType: 'bytes32' },
      { name: 'got', type: 'bytes32', internalType: 'bytes32' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidMessageSender',
    inputs: [
      { name: 'expected', type: 'bytes32', internalType: 'bytes32' },
      { name: 'got', type: 'bytes32', internalType: 'bytes32' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidMessageTransmitterOnProxy',
    inputs: [
      { name: 'expected', type: 'address', internalType: 'address' },
      { name: 'got', type: 'address', internalType: 'address' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidMessageTransmitterVersion',
    inputs: [
      { name: 'expected', type: 'uint32', internalType: 'uint32' },
      { name: 'got', type: 'uint32', internalType: 'uint32' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidReceiver',
    inputs: [{ name: 'receiver', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'InvalidRemoteChainConfig',
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
    name: 'InvalidSetDomainArgs',
    inputs: [
      {
        name: 'args',
        type: 'tuple',
        internalType: 'struct CCTPVerifier.SetDomainArgs',
        components: [
          {
            name: 'allowedCallerOnDest',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'allowedCallerOnSource',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'mintRecipientOnDest',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'chainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'domainIdentifier',
            type: 'uint32',
            internalType: 'uint32',
          },
          { name: 'enabled', type: 'bool', internalType: 'bool' },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidSourceDomain',
    inputs: [
      { name: 'expected', type: 'uint32', internalType: 'uint32' },
      { name: 'got', type: 'uint32', internalType: 'uint32' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidToken',
    inputs: [{ name: 'token', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'InvalidTokenMessengerVersion',
    inputs: [
      { name: 'expected', type: 'uint32', internalType: 'uint32' },
      { name: 'got', type: 'uint32', internalType: 'uint32' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidTokenTransferLength',
    inputs: [{ name: 'length', type: 'uint256', internalType: 'uint256' }],
  },
  {
    type: 'error',
    name: 'InvalidVerifierArgsLength',
    inputs: [{ name: 'length', type: 'uint256', internalType: 'uint256' }],
  },
  { type: 'error', name: 'InvalidVerifierResults', inputs: [] },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  {
    type: 'error',
    name: 'OnlyCallableByOwnerOrAllowlistAdmin',
    inputs: [],
  },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  { type: 'error', name: 'ReceiveMessageCallFailed', inputs: [] },
  {
    type: 'error',
    name: 'RemoteChainNotSupported',
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
    name: 'SafeERC20FailedOperation',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'SenderNotAllowed',
    inputs: [{ name: 'sender', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'UnknownDomain',
    inputs: [{ name: 'chainSelector', type: 'uint64', internalType: 'uint64' }],
  },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  // generate:end
] as const
