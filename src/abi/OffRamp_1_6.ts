export default [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink/raw/refs/heads/release/contracts-ccip-1.6.0/core/gethwrappers/ccip/generated/offramp/offramp.go')
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
        internalType: 'structOffRamp.StaticConfig',
        components: [
          {
            name: 'chainSelector',
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
            internalType: 'contractIRMNRemote',
          },
          {
            name: 'tokenAdminRegistry',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'nonceManager',
            type: 'address',
            internalType: 'address',
          },
        ],
      },
      {
        name: 'dynamicConfig',
        type: 'tuple',
        internalType: 'structOffRamp.DynamicConfig',
        components: [
          {
            name: 'feeQuoter',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'permissionLessExecutionThresholdSeconds',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'messageInterceptor',
            type: 'address',
            internalType: 'address',
          },
        ],
      },
      {
        name: 'sourceChainConfigs',
        type: 'tuple[]',
        internalType: 'structOffRamp.SourceChainConfigArgs[]',
        components: [
          {
            name: 'router',
            type: 'address',
            internalType: 'contractIRouter',
          },
          {
            name: 'sourceChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'isRMNVerificationDisabled',
            type: 'bool',
            internalType: 'bool',
          },
          { name: 'onRamp', type: 'bytes', internalType: 'bytes' },
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
        internalType: 'structOffRamp.SourceChainConfigArgs[]',
        components: [
          {
            name: 'router',
            type: 'address',
            internalType: 'contractIRouter',
          },
          {
            name: 'sourceChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'isRMNVerificationDisabled',
            type: 'bool',
            internalType: 'bool',
          },
          { name: 'onRamp', type: 'bytes', internalType: 'bytes' },
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
        name: '',
        type: 'tuple',
        internalType: 'structClient.Any2EVMMessage',
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
            internalType: 'structClient.EVMTokenAmount[]',
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
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'commit',
    inputs: [
      {
        name: 'reportContext',
        type: 'bytes32[2]',
        internalType: 'bytes32[2]',
      },
      { name: 'report', type: 'bytes', internalType: 'bytes' },
      { name: 'rs', type: 'bytes32[]', internalType: 'bytes32[]' },
      { name: 'ss', type: 'bytes32[]', internalType: 'bytes32[]' },
      { name: 'rawVs', type: 'bytes32', internalType: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'execute',
    inputs: [
      {
        name: 'reportContext',
        type: 'bytes32[2]',
        internalType: 'bytes32[2]',
      },
      { name: 'report', type: 'bytes', internalType: 'bytes' },
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
        internalType: 'structInternal.Any2EVMRampMessage',
        components: [
          {
            name: 'header',
            type: 'tuple',
            internalType: 'structInternal.RampMessageHeader',
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
              {
                name: 'destChainSelector',
                type: 'uint64',
                internalType: 'uint64',
              },
              {
                name: 'sequenceNumber',
                type: 'uint64',
                internalType: 'uint64',
              },
              { name: 'nonce', type: 'uint64', internalType: 'uint64' },
            ],
          },
          { name: 'sender', type: 'bytes', internalType: 'bytes' },
          { name: 'data', type: 'bytes', internalType: 'bytes' },
          {
            name: 'receiver',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'gasLimit',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'tokenAmounts',
            type: 'tuple[]',
            internalType: 'structInternal.Any2EVMTokenTransfer[]',
            components: [
              {
                name: 'sourcePoolAddress',
                type: 'bytes',
                internalType: 'bytes',
              },
              {
                name: 'destTokenAddress',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'destGasAmount',
                type: 'uint32',
                internalType: 'uint32',
              },
              {
                name: 'extraData',
                type: 'bytes',
                internalType: 'bytes',
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
      {
        name: 'offchainTokenData',
        type: 'bytes[]',
        internalType: 'bytes[]',
      },
      {
        name: 'tokenGasOverrides',
        type: 'uint32[]',
        internalType: 'uint32[]',
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
        internalType: 'structOffRamp.SourceChainConfig[]',
        components: [
          {
            name: 'router',
            type: 'address',
            internalType: 'contractIRouter',
          },
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          { name: 'minSeqNr', type: 'uint64', internalType: 'uint64' },
          {
            name: 'isRMNVerificationDisabled',
            type: 'bool',
            internalType: 'bool',
          },
          { name: 'onRamp', type: 'bytes', internalType: 'bytes' },
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
        name: '',
        type: 'tuple',
        internalType: 'structOffRamp.DynamicConfig',
        components: [
          {
            name: 'feeQuoter',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'permissionLessExecutionThresholdSeconds',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'messageInterceptor',
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
    name: 'getExecutionState',
    inputs: [
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'sequenceNumber',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'uint8',
        internalType: 'enumInternal.MessageExecutionState',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getLatestPriceSequenceNumber',
    inputs: [],
    outputs: [{ name: '', type: 'uint64', internalType: 'uint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getMerkleRoot',
    inputs: [
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'root', type: 'bytes32', internalType: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
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
        internalType: 'structOffRamp.SourceChainConfig',
        components: [
          {
            name: 'router',
            type: 'address',
            internalType: 'contractIRouter',
          },
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          { name: 'minSeqNr', type: 'uint64', internalType: 'uint64' },
          {
            name: 'isRMNVerificationDisabled',
            type: 'bool',
            internalType: 'bool',
          },
          { name: 'onRamp', type: 'bytes', internalType: 'bytes' },
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
        internalType: 'structOffRamp.StaticConfig',
        components: [
          {
            name: 'chainSelector',
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
            internalType: 'contractIRMNRemote',
          },
          {
            name: 'tokenAdminRegistry',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'nonceManager',
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
    name: 'latestConfigDetails',
    inputs: [{ name: 'ocrPluginType', type: 'uint8', internalType: 'uint8' }],
    outputs: [
      {
        name: 'ocrConfig',
        type: 'tuple',
        internalType: 'structMultiOCR3Base.OCRConfig',
        components: [
          {
            name: 'configInfo',
            type: 'tuple',
            internalType: 'structMultiOCR3Base.ConfigInfo',
            components: [
              {
                name: 'configDigest',
                type: 'bytes32',
                internalType: 'bytes32',
              },
              { name: 'F', type: 'uint8', internalType: 'uint8' },
              { name: 'n', type: 'uint8', internalType: 'uint8' },
              {
                name: 'isSignatureVerificationEnabled',
                type: 'bool',
                internalType: 'bool',
              },
            ],
          },
          {
            name: 'signers',
            type: 'address[]',
            internalType: 'address[]',
          },
          {
            name: 'transmitters',
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
    name: 'manuallyExecute',
    inputs: [
      {
        name: 'reports',
        type: 'tuple[]',
        internalType: 'structInternal.ExecutionReport[]',
        components: [
          {
            name: 'sourceChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'messages',
            type: 'tuple[]',
            internalType: 'structInternal.Any2EVMRampMessage[]',
            components: [
              {
                name: 'header',
                type: 'tuple',
                internalType: 'structInternal.RampMessageHeader',
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
                  {
                    name: 'destChainSelector',
                    type: 'uint64',
                    internalType: 'uint64',
                  },
                  {
                    name: 'sequenceNumber',
                    type: 'uint64',
                    internalType: 'uint64',
                  },
                  {
                    name: 'nonce',
                    type: 'uint64',
                    internalType: 'uint64',
                  },
                ],
              },
              { name: 'sender', type: 'bytes', internalType: 'bytes' },
              { name: 'data', type: 'bytes', internalType: 'bytes' },
              {
                name: 'receiver',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'gasLimit',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'tokenAmounts',
                type: 'tuple[]',
                internalType: 'structInternal.Any2EVMTokenTransfer[]',
                components: [
                  {
                    name: 'sourcePoolAddress',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                  {
                    name: 'destTokenAddress',
                    type: 'address',
                    internalType: 'address',
                  },
                  {
                    name: 'destGasAmount',
                    type: 'uint32',
                    internalType: 'uint32',
                  },
                  {
                    name: 'extraData',
                    type: 'bytes',
                    internalType: 'bytes',
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
          {
            name: 'offchainTokenData',
            type: 'bytes[][]',
            internalType: 'bytes[][]',
          },
          {
            name: 'proofs',
            type: 'bytes32[]',
            internalType: 'bytes32[]',
          },
          {
            name: 'proofFlagBits',
            type: 'uint256',
            internalType: 'uint256',
          },
        ],
      },
      {
        name: 'gasLimitOverrides',
        type: 'tuple[][]',
        internalType: 'structOffRamp.GasLimitOverride[][]',
        components: [
          {
            name: 'receiverExecutionGasLimit',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'tokenGasOverrides',
            type: 'uint32[]',
            internalType: 'uint32[]',
          },
        ],
      },
    ],
    outputs: [],
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
    name: 'setDynamicConfig',
    inputs: [
      {
        name: 'dynamicConfig',
        type: 'tuple',
        internalType: 'structOffRamp.DynamicConfig',
        components: [
          {
            name: 'feeQuoter',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'permissionLessExecutionThresholdSeconds',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'messageInterceptor',
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
    name: 'setOCR3Configs',
    inputs: [
      {
        name: 'ocrConfigArgs',
        type: 'tuple[]',
        internalType: 'structMultiOCR3Base.OCRConfigArgs[]',
        components: [
          {
            name: 'configDigest',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'ocrPluginType',
            type: 'uint8',
            internalType: 'uint8',
          },
          { name: 'F', type: 'uint8', internalType: 'uint8' },
          {
            name: 'isSignatureVerificationEnabled',
            type: 'bool',
            internalType: 'bool',
          },
          {
            name: 'signers',
            type: 'address[]',
            internalType: 'address[]',
          },
          {
            name: 'transmitters',
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
    name: 'AlreadyAttempted',
    inputs: [
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
      },
      {
        name: 'sequenceNumber',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'CommitReportAccepted',
    inputs: [
      {
        name: 'blessedMerkleRoots',
        type: 'tuple[]',
        indexed: false,
        internalType: 'structInternal.MerkleRoot[]',
        components: [
          {
            name: 'sourceChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'onRampAddress',
            type: 'bytes',
            internalType: 'bytes',
          },
          { name: 'minSeqNr', type: 'uint64', internalType: 'uint64' },
          { name: 'maxSeqNr', type: 'uint64', internalType: 'uint64' },
          {
            name: 'merkleRoot',
            type: 'bytes32',
            internalType: 'bytes32',
          },
        ],
      },
      {
        name: 'unblessedMerkleRoots',
        type: 'tuple[]',
        indexed: false,
        internalType: 'structInternal.MerkleRoot[]',
        components: [
          {
            name: 'sourceChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'onRampAddress',
            type: 'bytes',
            internalType: 'bytes',
          },
          { name: 'minSeqNr', type: 'uint64', internalType: 'uint64' },
          { name: 'maxSeqNr', type: 'uint64', internalType: 'uint64' },
          {
            name: 'merkleRoot',
            type: 'bytes32',
            internalType: 'bytes32',
          },
        ],
      },
      {
        name: 'priceUpdates',
        type: 'tuple',
        indexed: false,
        internalType: 'structInternal.PriceUpdates',
        components: [
          {
            name: 'tokenPriceUpdates',
            type: 'tuple[]',
            internalType: 'structInternal.TokenPriceUpdate[]',
            components: [
              {
                name: 'sourceToken',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'usdPerToken',
                type: 'uint224',
                internalType: 'uint224',
              },
            ],
          },
          {
            name: 'gasPriceUpdates',
            type: 'tuple[]',
            internalType: 'structInternal.GasPriceUpdate[]',
            components: [
              {
                name: 'destChainSelector',
                type: 'uint64',
                internalType: 'uint64',
              },
              {
                name: 'usdPerUnitGas',
                type: 'uint224',
                internalType: 'uint224',
              },
            ],
          },
        ],
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ConfigSet',
    inputs: [
      {
        name: 'ocrPluginType',
        type: 'uint8',
        indexed: false,
        internalType: 'uint8',
      },
      {
        name: 'configDigest',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'signers',
        type: 'address[]',
        indexed: false,
        internalType: 'address[]',
      },
      {
        name: 'transmitters',
        type: 'address[]',
        indexed: false,
        internalType: 'address[]',
      },
      {
        name: 'F',
        type: 'uint8',
        indexed: false,
        internalType: 'uint8',
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
        internalType: 'structOffRamp.DynamicConfig',
        components: [
          {
            name: 'feeQuoter',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'permissionLessExecutionThresholdSeconds',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'messageInterceptor',
            type: 'address',
            internalType: 'address',
          },
        ],
      },
    ],
    anonymous: false,
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
        name: 'sequenceNumber',
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
        name: 'messageHash',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'state',
        type: 'uint8',
        indexed: false,
        internalType: 'enumInternal.MessageExecutionState',
      },
      {
        name: 'returnData',
        type: 'bytes',
        indexed: false,
        internalType: 'bytes',
      },
      {
        name: 'gasUsed',
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
    name: 'RootRemoved',
    inputs: [
      {
        name: 'root',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SkippedAlreadyExecutedMessage',
    inputs: [
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
      },
      {
        name: 'sequenceNumber',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SkippedReportExecution',
    inputs: [
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
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
        internalType: 'structOffRamp.SourceChainConfig',
        components: [
          {
            name: 'router',
            type: 'address',
            internalType: 'contractIRouter',
          },
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          { name: 'minSeqNr', type: 'uint64', internalType: 'uint64' },
          {
            name: 'isRMNVerificationDisabled',
            type: 'bool',
            internalType: 'bool',
          },
          { name: 'onRamp', type: 'bytes', internalType: 'bytes' },
        ],
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SourceChainSelectorAdded',
    inputs: [
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
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
        internalType: 'structOffRamp.StaticConfig',
        components: [
          {
            name: 'chainSelector',
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
            internalType: 'contractIRMNRemote',
          },
          {
            name: 'tokenAdminRegistry',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'nonceManager',
            type: 'address',
            internalType: 'address',
          },
        ],
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Transmitted',
    inputs: [
      {
        name: 'ocrPluginType',
        type: 'uint8',
        indexed: true,
        internalType: 'uint8',
      },
      {
        name: 'configDigest',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'sequenceNumber',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
      },
    ],
    anonymous: false,
  },
  { type: 'error', name: 'CanOnlySelfCall', inputs: [] },
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  {
    type: 'error',
    name: 'CommitOnRampMismatch',
    inputs: [
      { name: 'reportOnRamp', type: 'bytes', internalType: 'bytes' },
      { name: 'configOnRamp', type: 'bytes', internalType: 'bytes' },
    ],
  },
  {
    type: 'error',
    name: 'ConfigDigestMismatch',
    inputs: [
      { name: 'expected', type: 'bytes32', internalType: 'bytes32' },
      { name: 'actual', type: 'bytes32', internalType: 'bytes32' },
    ],
  },
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
  { type: 'error', name: 'EmptyBatch', inputs: [] },
  {
    type: 'error',
    name: 'EmptyReport',
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
    name: 'ExecutionError',
    inputs: [
      { name: 'messageId', type: 'bytes32', internalType: 'bytes32' },
      { name: 'err', type: 'bytes', internalType: 'bytes' },
    ],
  },
  {
    type: 'error',
    name: 'ForkedChain',
    inputs: [
      { name: 'expected', type: 'uint256', internalType: 'uint256' },
      { name: 'actual', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'InsufficientGasToCompleteTx',
    inputs: [{ name: 'err', type: 'bytes4', internalType: 'bytes4' }],
  },
  {
    type: 'error',
    name: 'InvalidConfig',
    inputs: [
      {
        name: 'errorType',
        type: 'uint8',
        internalType: 'enumMultiOCR3Base.InvalidConfigErrorType',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidDataLength',
    inputs: [
      { name: 'expected', type: 'uint256', internalType: 'uint256' },
      { name: 'got', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidInterval',
    inputs: [
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'min', type: 'uint64', internalType: 'uint64' },
      { name: 'max', type: 'uint64', internalType: 'uint64' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidManualExecutionGasLimit',
    inputs: [
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'messageId', type: 'bytes32', internalType: 'bytes32' },
      { name: 'newLimit', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidManualExecutionTokenGasOverride',
    inputs: [
      { name: 'messageId', type: 'bytes32', internalType: 'bytes32' },
      { name: 'tokenIndex', type: 'uint256', internalType: 'uint256' },
      { name: 'oldLimit', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tokenGasOverride',
        type: 'uint256',
        internalType: 'uint256',
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
    name: 'InvalidNewState',
    inputs: [
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'sequenceNumber',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'newState',
        type: 'uint8',
        internalType: 'enumInternal.MessageExecutionState',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidOnRampUpdate',
    inputs: [
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'InvalidProof', inputs: [] },
  { type: 'error', name: 'InvalidRoot', inputs: [] },
  { type: 'error', name: 'LeavesCannotBeEmpty', inputs: [] },
  {
    type: 'error',
    name: 'ManualExecutionGasAmountCountMismatch',
    inputs: [
      { name: 'messageId', type: 'bytes32', internalType: 'bytes32' },
      {
        name: 'sequenceNumber',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'ManualExecutionGasLimitMismatch',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ManualExecutionNotYetEnabled',
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
    name: 'MessageValidationError',
    inputs: [{ name: 'errorReason', type: 'bytes', internalType: 'bytes' }],
  },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  { type: 'error', name: 'NonUniqueSignatures', inputs: [] },
  {
    type: 'error',
    name: 'NotACompatiblePool',
    inputs: [{ name: 'notPool', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  { type: 'error', name: 'OracleCannotBeZeroAddress', inputs: [] },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'ReceiverError',
    inputs: [{ name: 'err', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'ReleaseOrMintBalanceMismatch',
    inputs: [
      {
        name: 'amountReleased',
        type: 'uint256',
        internalType: 'uint256',
      },
      { name: 'balancePre', type: 'uint256', internalType: 'uint256' },
      { name: 'balancePost', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'RootAlreadyCommitted',
    inputs: [
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'merkleRoot', type: 'bytes32', internalType: 'bytes32' },
    ],
  },
  {
    type: 'error',
    name: 'RootBlessingMismatch',
    inputs: [
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'merkleRoot', type: 'bytes32', internalType: 'bytes32' },
      { name: 'isBlessed', type: 'bool', internalType: 'bool' },
    ],
  },
  {
    type: 'error',
    name: 'RootNotCommitted',
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
    name: 'SignatureVerificationNotAllowedInExecutionPlugin',
    inputs: [],
  },
  {
    type: 'error',
    name: 'SignatureVerificationRequiredInCommitPlugin',
    inputs: [],
  },
  { type: 'error', name: 'SignaturesOutOfRegistration', inputs: [] },
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
    name: 'SourceChainSelectorMismatch',
    inputs: [
      {
        name: 'reportSourceChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'messageSourceChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'StaleCommitReport', inputs: [] },
  {
    type: 'error',
    name: 'StaticConfigCannotBeChanged',
    inputs: [{ name: 'ocrPluginType', type: 'uint8', internalType: 'uint8' }],
  },
  {
    type: 'error',
    name: 'TokenDataMismatch',
    inputs: [
      {
        name: 'sourceChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'sequenceNumber',
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
  { type: 'error', name: 'UnauthorizedSigner', inputs: [] },
  { type: 'error', name: 'UnauthorizedTransmitter', inputs: [] },
  { type: 'error', name: 'UnexpectedTokenData', inputs: [] },
  {
    type: 'error',
    name: 'WrongMessageLength',
    inputs: [
      { name: 'expected', type: 'uint256', internalType: 'uint256' },
      { name: 'actual', type: 'uint256', internalType: 'uint256' },
    ],
  },
  { type: 'error', name: 'WrongNumberOfSignatures', inputs: [] },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  { type: 'error', name: 'ZeroChainSelectorNotAllowed', inputs: [] },
  // generate:end
] as const
