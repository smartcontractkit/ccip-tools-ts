export default [
  // FeeQuoter 2.0.0 ABI
  {
    type: 'constructor',
    inputs: [
      {
        name: 'staticConfig',
        type: 'tuple',
        internalType: 'structFeeQuoter.StaticConfig',
        components: [
          {
            name: 'maxFeeJuelsPerMsg',
            type: 'uint96',
            internalType: 'uint96',
          },
          {
            name: 'linkToken',
            type: 'address',
            internalType: 'address',
          },
        ],
      },
      {
        name: 'priceUpdaters',
        type: 'address[]',
        internalType: 'address[]',
      },
      {
        name: 'tokenTransferFeeConfigArgs',
        type: 'tuple[]',
        internalType: 'structFeeQuoter.TokenTransferFeeConfigArgs[]',
        components: [
          {
            name: 'destChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'tokenTransferFeeConfigs',
            type: 'tuple[]',
            internalType: 'structFeeQuoter.TokenTransferFeeConfigSingleTokenArgs[]',
            components: [
              {
                name: 'token',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'tokenTransferFeeConfig',
                type: 'tuple',
                internalType: 'structFeeQuoter.TokenTransferFeeConfig',
                components: [
                  {
                    name: 'feeUSDCents',
                    type: 'uint32',
                    internalType: 'uint32',
                  },
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
                    name: 'isEnabled',
                    type: 'bool',
                    internalType: 'bool',
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        name: 'destChainConfigArgs',
        type: 'tuple[]',
        internalType: 'structFeeQuoter.DestChainConfigArgs[]',
        components: [
          {
            name: 'destChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'destChainConfig',
            type: 'tuple',
            internalType: 'structFeeQuoter.DestChainConfig',
            components: [
              { name: 'isEnabled', type: 'bool', internalType: 'bool' },
              {
                name: 'maxDataBytes',
                type: 'uint32',
                internalType: 'uint32',
              },
              {
                name: 'maxPerMsgGasLimit',
                type: 'uint32',
                internalType: 'uint32',
              },
              {
                name: 'destGasOverhead',
                type: 'uint32',
                internalType: 'uint32',
              },
              {
                name: 'destGasPerPayloadByteBase',
                type: 'uint8',
                internalType: 'uint8',
              },
              {
                name: 'chainFamilySelector',
                type: 'bytes4',
                internalType: 'bytes4',
              },
              {
                name: 'defaultTokenFeeUSDCents',
                type: 'uint16',
                internalType: 'uint16',
              },
              {
                name: 'defaultTokenDestGasOverhead',
                type: 'uint32',
                internalType: 'uint32',
              },
              {
                name: 'defaultTxGasLimit',
                type: 'uint32',
                internalType: 'uint32',
              },
              {
                name: 'networkFeeUSDCents',
                type: 'uint16',
                internalType: 'uint16',
              },
              {
                name: 'linkFeeMultiplierPercent',
                type: 'uint8',
                internalType: 'uint8',
              },
            ],
          },
        ],
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getFeeTokens',
    inputs: [],
    outputs: [{ name: '', type: 'address[]', internalType: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTokenPrice',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'structInternal.TimestampedPackedUint224',
        components: [
          { name: 'value', type: 'uint224', internalType: 'uint224' },
          { name: 'timestamp', type: 'uint32', internalType: 'uint32' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTokenPrices',
    inputs: [{ name: 'tokens', type: 'address[]', internalType: 'address[]' }],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        internalType: 'structInternal.TimestampedPackedUint224[]',
        components: [
          { name: 'value', type: 'uint224', internalType: 'uint224' },
          { name: 'timestamp', type: 'uint32', internalType: 'uint32' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getValidatedTokenPrice',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'uint224', internalType: 'uint224' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getDestinationChainGasPrice',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'structInternal.TimestampedPackedUint224',
        components: [
          { name: 'value', type: 'uint224', internalType: 'uint224' },
          { name: 'timestamp', type: 'uint32', internalType: 'uint32' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTokenTransferFee',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'token', type: 'address', internalType: 'address' },
    ],
    outputs: [
      { name: 'feeUSDCents', type: 'uint32', internalType: 'uint32' },
      { name: 'destGasOverhead', type: 'uint32', internalType: 'uint32' },
      { name: 'destBytesOverhead', type: 'uint32', internalType: 'uint32' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'quoteGasForExec',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'nonCalldataGas',
        type: 'uint32',
        internalType: 'uint32',
      },
      {
        name: 'calldataSize',
        type: 'uint32',
        internalType: 'uint32',
      },
      { name: 'feeToken', type: 'address', internalType: 'address' },
    ],
    outputs: [
      { name: 'totalGas', type: 'uint32', internalType: 'uint32' },
      { name: 'gasCostInUsdCents', type: 'uint256', internalType: 'uint256' },
      { name: 'feeTokenPrice', type: 'uint256', internalType: 'uint256' },
      {
        name: 'premiumPercentMultiplier',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getValidatedFee',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'message',
        type: 'tuple',
        internalType: 'structClient.EVM2AnyMessage',
        components: [
          { name: 'receiver', type: 'bytes', internalType: 'bytes' },
          { name: 'data', type: 'bytes', internalType: 'bytes' },
          {
            name: 'tokenAmounts',
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
          {
            name: 'feeToken',
            type: 'address',
            internalType: 'address',
          },
          { name: 'extraArgs', type: 'bytes', internalType: 'bytes' },
        ],
      },
    ],
    outputs: [
      {
        name: 'feeTokenAmount',
        type: 'uint256',
        internalType: 'uint256',
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
        internalType: 'structFeeQuoter.StaticConfig',
        components: [
          {
            name: 'maxFeeJuelsPerMsg',
            type: 'uint96',
            internalType: 'uint96',
          },
          {
            name: 'linkToken',
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
    name: 'typeAndVersion',
    inputs: [],
    outputs: [{ name: '', type: 'string', internalType: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'error',
    name: 'TokenNotSupported',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'FeeTokenNotSupported',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'NoGasPriceAvailable',
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
    name: 'InvalidDestBytesOverhead',
    inputs: [
      { name: 'token', type: 'address', internalType: 'address' },
      {
        name: 'destBytesOverhead',
        type: 'uint32',
        internalType: 'uint32',
      },
    ],
  },
  {
    type: 'error',
    name: 'MessageGasLimitTooHigh',
    inputs: [],
  },
  {
    type: 'error',
    name: 'MessageComputeUnitLimitTooHigh',
    inputs: [],
  },
  {
    type: 'error',
    name: 'DestinationChainNotEnabled',
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
    name: 'InvalidExtraArgsTag',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidExtraArgsData',
    inputs: [],
  },
  {
    type: 'error',
    name: 'SourceTokenDataTooLarge',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'InvalidDestChainConfig',
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
    name: 'MessageFeeTooHigh',
    inputs: [
      { name: 'msgFeeJuels', type: 'uint256', internalType: 'uint256' },
      {
        name: 'maxFeeJuelsPerMsg',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidStaticConfig',
    inputs: [],
  },
  {
    type: 'error',
    name: 'MessageTooLarge',
    inputs: [
      { name: 'maxSize', type: 'uint256', internalType: 'uint256' },
      { name: 'actualSize', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'UnsupportedNumberOfTokens',
    inputs: [
      {
        name: 'numberOfTokens',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'maxNumberOfTokensPerMsg',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidChainFamilySelector',
    inputs: [
      {
        name: 'chainFamilySelector',
        type: 'bytes4',
        internalType: 'bytes4',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidTokenReceiver',
    inputs: [],
  },
  {
    type: 'error',
    name: 'TooManySVMExtraArgsAccounts',
    inputs: [
      { name: 'numAccounts', type: 'uint256', internalType: 'uint256' },
      { name: 'maxAccounts', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidSVMExtraArgsWritableBitmap',
    inputs: [
      {
        name: 'accountIsWritableBitmap',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'numAccounts', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'TooManySuiExtraArgsReceiverObjectIds',
    inputs: [
      {
        name: 'numReceiverObjectIds',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'maxReceiverObjectIds',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'TokenTransferConfigMustBeEnabled',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'token', type: 'address', internalType: 'address' },
    ],
  },
] as const
