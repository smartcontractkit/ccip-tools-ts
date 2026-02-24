// TODO: track a v2 release tag and the v2.0.0 folder instead of a commit + latest/ folder, once 2.0.0 is released in `chainlink-ccip`
export default [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/refs/heads/develop/ccv/chains/evm/gobindings/generated/latest/offramp/offramp.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  {
    type: 'constructor',
    inputs: [
      {
        name: 'staticConfig',
        type: 'tuple',
        internalType: 'struct OffRamp.StaticConfig',
        components: [
          {
            name: 'localChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'gasForCallExactCheck',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'rmnRemote',
            type: 'address',
            internalType: 'contract IRMNRemote',
          },
          {
            name: 'tokenAdminRegistry',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'maxGasBufferToUpdateState',
            type: 'uint32',
            internalType: 'uint32',
          },
        ],
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
    name: 'applySourceChainConfigUpdates',
    inputs: [
      {
        name: 'sourceChainConfigUpdates',
        type: 'tuple[]',
        internalType: 'struct OffRamp.SourceChainConfigArgs[]',
        components: [
          {
            name: 'router',
            type: 'address',
            internalType: 'contract IRouter',
          },
          {
            name: 'sourceChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          { name: 'onRamps', type: 'bytes[]', internalType: 'bytes[]' },
          {
            name: 'defaultCCVs',
            type: 'address[]',
            internalType: 'address[]',
          },
          {
            name: 'laneMandatedCCVs',
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
    name: 'execute',
    inputs: [
      { name: 'encodedMessage', type: 'bytes', internalType: 'bytes' },
      { name: 'ccvs', type: 'address[]', internalType: 'address[]' },
      {
        name: 'verifierResults',
        type: 'bytes[]',
        internalType: 'bytes[]',
      },
      {
        name: 'gasLimitOverride',
        type: 'uint32',
        internalType: 'uint32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'executeSingleMessage',
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
      { name: 'ccvs', type: 'address[]', internalType: 'address[]' },
      {
        name: 'verifierResults',
        type: 'bytes[]',
        internalType: 'bytes[]',
      },
      {
        name: 'gasLimitOverride',
        type: 'uint32',
        internalType: 'uint32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getAllSourceChainConfigs',
    inputs: [],
    outputs: [
      { name: '', type: 'uint64[]', internalType: 'uint64[]' },
      {
        name: '',
        type: 'tuple[]',
        internalType: 'struct OffRamp.SourceChainConfig[]',
        components: [
          {
            name: 'router',
            type: 'address',
            internalType: 'contract IRouter',
          },
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          { name: 'onRamps', type: 'bytes[]', internalType: 'bytes[]' },
          {
            name: 'defaultCCVs',
            type: 'address[]',
            internalType: 'address[]',
          },
          {
            name: 'laneMandatedCCVs',
            type: 'address[]',
            internalType: 'address[]',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCCVsForMessage',
    inputs: [{ name: 'encodedMessage', type: 'bytes', internalType: 'bytes' }],
    outputs: [
      {
        name: 'requiredCCVs',
        type: 'address[]',
        internalType: 'address[]',
      },
      {
        name: 'optionalCCVs',
        type: 'address[]',
        internalType: 'address[]',
      },
      { name: 'threshold', type: 'uint8', internalType: 'uint8' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getExecutionState',
    inputs: [{ name: 'messageId', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'uint8',
        internalType: 'enum Internal.MessageExecutionState',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getSourceChainConfig',
    inputs: [
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct OffRamp.SourceChainConfig',
        components: [
          {
            name: 'router',
            type: 'address',
            internalType: 'contract IRouter',
          },
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          { name: 'onRamps', type: 'bytes[]', internalType: 'bytes[]' },
          {
            name: 'defaultCCVs',
            type: 'address[]',
            internalType: 'address[]',
          },
          {
            name: 'laneMandatedCCVs',
            type: 'address[]',
            internalType: 'address[]',
          },
        ],
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
        name: '',
        type: 'tuple',
        internalType: 'struct OffRamp.StaticConfig',
        components: [
          {
            name: 'localChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'gasForCallExactCheck',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'rmnRemote',
            type: 'address',
            internalType: 'contract IRMNRemote',
          },
          {
            name: 'tokenAdminRegistry',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'maxGasBufferToUpdateState',
            type: 'uint32',
            internalType: 'uint32',
          },
        ],
      },
    ],
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
    type: 'event',
    name: 'ExecutionStateChanged',
    inputs: [
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'messageNumber',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'messageId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'state',
        type: 'uint8',
        indexed: false,
        internalType: 'enum Internal.MessageExecutionState',
      },
      {
        name: 'returnData',
        type: 'bytes',
        indexed: false,
        internalType: 'bytes',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'MaxGasBufferToUpdateStateUpdated',
    inputs: [
      {
        name: 'oldMaxGasBufferToUpdateState',
        type: 'uint32',
        indexed: false,
        internalType: 'uint32',
      },
      {
        name: 'newMaxGasBufferToUpdateState',
        type: 'uint32',
        indexed: false,
        internalType: 'uint32',
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
    name: 'SourceChainConfigSet',
    inputs: [
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'sourceConfig',
        type: 'tuple',
        indexed: false,
        internalType: 'struct OffRamp.SourceChainConfigArgs',
        components: [
          {
            name: 'router',
            type: 'address',
            internalType: 'contract IRouter',
          },
          {
            name: 'sourceChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          { name: 'onRamps', type: 'bytes[]', internalType: 'bytes[]' },
          {
            name: 'defaultCCVs',
            type: 'address[]',
            internalType: 'address[]',
          },
          {
            name: 'laneMandatedCCVs',
            type: 'address[]',
            internalType: 'address[]',
          },
        ],
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'StaticConfigSet',
    inputs: [
      {
        name: 'staticConfig',
        type: 'tuple',
        indexed: false,
        internalType: 'struct OffRamp.StaticConfig',
        components: [
          {
            name: 'localChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'gasForCallExactCheck',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'rmnRemote',
            type: 'address',
            internalType: 'contract IRMNRemote',
          },
          {
            name: 'tokenAdminRegistry',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'maxGasBufferToUpdateState',
            type: 'uint32',
            internalType: 'uint32',
          },
        ],
      },
    ],
    anonymous: false,
  },
  { type: 'error', name: 'CanOnlySelfCall', inputs: [] },
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  {
    type: 'error',
    name: 'CursedByRMN',
    inputs: [
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'DuplicateCCVNotAllowed',
    inputs: [{ name: 'ccvAddress', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'ExecutionError',
    inputs: [
      { name: 'messageId', type: 'bytes32', internalType: 'bytes32' },
      { name: 'err', type: 'bytes', internalType: 'bytes' },
    ],
  },
  { type: 'error', name: 'GasCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'InboundImplementationNotFound',
    inputs: [
      { name: 'ccvAddress', type: 'address', internalType: 'address' },
      { name: 'verifierResults', type: 'bytes', internalType: 'bytes' },
    ],
  },
  {
    type: 'error',
    name: 'InsufficientGasToCompleteTx',
    inputs: [{ name: 'err', type: 'bytes4', internalType: 'bytes4' }],
  },
  {
    type: 'error',
    name: 'InvalidDataLength',
    inputs: [
      {
        name: 'location',
        type: 'uint8',
        internalType: 'enum MessageV1Codec.EncodingErrorLocation',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidEVMAddress',
    inputs: [{ name: 'encodedAddress', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'InvalidEncodingVersion',
    inputs: [{ name: 'version', type: 'uint8', internalType: 'uint8' }],
  },
  {
    type: 'error',
    name: 'InvalidGasLimitOverride',
    inputs: [
      {
        name: 'messageGasLimit',
        type: 'uint32',
        internalType: 'uint32',
      },
      {
        name: 'gasLimitOverride',
        type: 'uint32',
        internalType: 'uint32',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidMessageDestChainSelector',
    inputs: [
      {
        name: 'messageDestChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidNumberOfTokens',
    inputs: [{ name: 'numTokens', type: 'uint256', internalType: 'uint256' }],
  },
  {
    type: 'error',
    name: 'InvalidOffRamp',
    inputs: [
      { name: 'expected', type: 'address', internalType: 'address' },
      { name: 'got', type: 'bytes', internalType: 'bytes' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidOnRamp',
    inputs: [{ name: 'got', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'InvalidVerifierResultsLength',
    inputs: [
      { name: 'expected', type: 'uint256', internalType: 'uint256' },
      { name: 'got', type: 'uint256', internalType: 'uint256' },
    ],
  },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  {
    type: 'error',
    name: 'MustSpecifyDefaultOrRequiredCCVs',
    inputs: [],
  },
  {
    type: 'error',
    name: 'NotACompatiblePool',
    inputs: [{ name: 'notPool', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  {
    type: 'error',
    name: 'OptionalCCVQuorumNotReached',
    inputs: [
      { name: 'wanted', type: 'uint256', internalType: 'uint256' },
      { name: 'got', type: 'uint256', internalType: 'uint256' },
    ],
  },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'ReceiverError',
    inputs: [{ name: 'err', type: 'bytes', internalType: 'bytes' }],
  },
  { type: 'error', name: 'ReentrancyGuardReentrantCall', inputs: [] },
  {
    type: 'error',
    name: 'RequiredCCVMissing',
    inputs: [{ name: 'requiredCCV', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'SkippedAlreadyExecutedMessage',
    inputs: [
      { name: 'messageId', type: 'bytes32', internalType: 'bytes32' },
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'messageNumber', type: 'uint64', internalType: 'uint64' },
    ],
  },
  {
    type: 'error',
    name: 'SourceChainNotEnabled',
    inputs: [
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'TokenHandlingError',
    inputs: [
      { name: 'target', type: 'address', internalType: 'address' },
      { name: 'err', type: 'bytes', internalType: 'bytes' },
    ],
  },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  { type: 'error', name: 'ZeroChainSelectorNotAllowed', inputs: [] },
  // generate:end
] as const
