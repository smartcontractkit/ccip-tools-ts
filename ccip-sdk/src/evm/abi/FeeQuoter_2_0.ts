export default [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/refs/heads/main/chains/evm/gobindings/generated/v2_0_0/fee_quoter/fee_quoter.go')
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
        internalType: 'struct FeeQuoter.StaticConfig',
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
        internalType: 'struct FeeQuoter.TokenTransferFeeConfigArgs[]',
        components: [
          {
            name: 'destChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'tokenTransferFeeConfigs',
            type: 'tuple[]',
            internalType: 'struct FeeQuoter.TokenTransferFeeConfigSingleTokenArgs[]',
            components: [
              {
                name: 'token',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'tokenTransferFeeConfig',
                type: 'tuple',
                internalType: 'struct FeeQuoter.TokenTransferFeeConfig',
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
        internalType: 'struct FeeQuoter.DestChainConfigArgs[]',
        components: [
          {
            name: 'destChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'destChainConfig',
            type: 'tuple',
            internalType: 'struct FeeQuoter.DestChainConfig',
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
    name: 'acceptOwnership',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'applyAuthorizedCallerUpdates',
    inputs: [
      {
        name: 'authorizedCallerArgs',
        type: 'tuple',
        internalType: 'struct AuthorizedCallers.AuthorizedCallerArgs',
        components: [
          {
            name: 'addedCallers',
            type: 'address[]',
            internalType: 'address[]',
          },
          {
            name: 'removedCallers',
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
    name: 'applyDestChainConfigUpdates',
    inputs: [
      {
        name: 'destChainConfigArgs',
        type: 'tuple[]',
        internalType: 'struct FeeQuoter.DestChainConfigArgs[]',
        components: [
          {
            name: 'destChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'destChainConfig',
            type: 'tuple',
            internalType: 'struct FeeQuoter.DestChainConfig',
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
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'applyTokenTransferFeeConfigUpdates',
    inputs: [
      {
        name: 'tokenTransferFeeConfigArgs',
        type: 'tuple[]',
        internalType: 'struct FeeQuoter.TokenTransferFeeConfigArgs[]',
        components: [
          {
            name: 'destChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'tokenTransferFeeConfigs',
            type: 'tuple[]',
            internalType: 'struct FeeQuoter.TokenTransferFeeConfigSingleTokenArgs[]',
            components: [
              {
                name: 'token',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'tokenTransferFeeConfig',
                type: 'tuple',
                internalType: 'struct FeeQuoter.TokenTransferFeeConfig',
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
        name: 'tokensToUseDefaultFeeConfigs',
        type: 'tuple[]',
        internalType: 'struct FeeQuoter.TokenTransferFeeConfigRemoveArgs[]',
        components: [
          {
            name: 'destChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          { name: 'token', type: 'address', internalType: 'address' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'convertTokenAmount',
    inputs: [
      { name: 'fromToken', type: 'address', internalType: 'address' },
      {
        name: 'fromTokenAmount',
        type: 'uint256',
        internalType: 'uint256',
      },
      { name: 'toToken', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAllAuthorizedCallers',
    inputs: [],
    outputs: [{ name: '', type: 'address[]', internalType: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAllDestChainConfigs',
    inputs: [],
    outputs: [
      { name: '', type: 'uint64[]', internalType: 'uint64[]' },
      {
        name: '',
        type: 'tuple[]',
        internalType: 'struct FeeQuoter.DestChainConfig[]',
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
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAllTokenTransferFeeConfigs',
    inputs: [],
    outputs: [
      {
        name: 'destChainSelectors',
        type: 'uint64[]',
        internalType: 'uint64[]',
      },
      {
        name: 'transferTokens',
        type: 'address[][]',
        internalType: 'address[][]',
      },
      {
        name: 'tokenTransferFeeConfigs',
        type: 'tuple[][]',
        internalType: 'struct FeeQuoter.TokenTransferFeeConfig[][]',
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
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
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
        name: 'destChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct FeeQuoter.DestChainConfig',
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
        internalType: 'struct Internal.TimestampedPackedUint224',
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
    name: 'getFeeTokens',
    inputs: [],
    outputs: [{ name: '', type: 'address[]', internalType: 'address[]' }],
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
        internalType: 'struct FeeQuoter.StaticConfig',
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
    name: 'getTokenAndGasPrices',
    inputs: [
      { name: 'token', type: 'address', internalType: 'address' },
      {
        name: 'destChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
    outputs: [
      { name: 'tokenPrice', type: 'uint224', internalType: 'uint224' },
      {
        name: 'gasPriceValue',
        type: 'uint224',
        internalType: 'uint224',
      },
    ],
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
        internalType: 'struct Internal.TimestampedPackedUint224',
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
        internalType: 'struct Internal.TimestampedPackedUint224[]',
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
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTokenTransferFeeConfig',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'token', type: 'address', internalType: 'address' },
    ],
    outputs: [
      {
        name: 'tokenTransferFeeConfig',
        type: 'tuple',
        internalType: 'struct FeeQuoter.TokenTransferFeeConfig',
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
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
        ],
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
    name: 'getValidatedTokenPrice',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'uint224', internalType: 'uint224' }],
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
    name: 'processMessageArgs',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'feeToken', type: 'address', internalType: 'address' },
      {
        name: 'feeTokenAmount',
        type: 'uint256',
        internalType: 'uint256',
      },
      { name: 'extraArgs', type: 'bytes', internalType: 'bytes' },
      { name: 'messageReceiver', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [
      { name: 'msgFeeJuels', type: 'uint256', internalType: 'uint256' },
      {
        name: 'isOutOfOrderExecution',
        type: 'bool',
        internalType: 'bool',
      },
      {
        name: 'convertedExtraArgs',
        type: 'bytes',
        internalType: 'bytes',
      },
      { name: 'tokenReceiver', type: 'bytes', internalType: 'bytes' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'processPoolReturnData',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'onRampTokenTransfers',
        type: 'tuple[]',
        internalType: 'struct Internal.EVM2AnyTokenTransfer[]',
        components: [
          {
            name: 'sourcePoolAddress',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'destTokenAddress',
            type: 'bytes',
            internalType: 'bytes',
          },
          { name: 'extraData', type: 'bytes', internalType: 'bytes' },
          { name: 'amount', type: 'uint256', internalType: 'uint256' },
          {
            name: 'destExecData',
            type: 'bytes',
            internalType: 'bytes',
          },
        ],
      },
      {
        name: 'sourceTokenAmounts',
        type: 'tuple[]',
        internalType: 'struct Client.EVMTokenAmount[]',
        components: [
          { name: 'token', type: 'address', internalType: 'address' },
          { name: 'amount', type: 'uint256', internalType: 'uint256' },
        ],
      },
    ],
    outputs: [
      {
        name: 'destExecDataPerToken',
        type: 'bytes[]',
        internalType: 'bytes[]',
      },
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
      { name: 'calldataSize', type: 'uint32', internalType: 'uint32' },
      { name: 'feeToken', type: 'address', internalType: 'address' },
    ],
    outputs: [
      { name: 'totalGas', type: 'uint32', internalType: 'uint32' },
      {
        name: 'gasCostInUsdCents',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'feeTokenPrice',
        type: 'uint256',
        internalType: 'uint256',
      },
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
    name: 'removeFeeTokens',
    inputs: [
      {
        name: 'feeTokensToRemove',
        type: 'address[]',
        internalType: 'address[]',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'resolveLegacyArgs',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'extraArgs', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [
      { name: 'tokenReceiver', type: 'bytes', internalType: 'bytes' },
      { name: 'gasLimit', type: 'uint32', internalType: 'uint32' },
      { name: 'executorArgs', type: 'bytes', internalType: 'bytes' },
    ],
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
    type: 'function',
    name: 'updatePrices',
    inputs: [
      {
        name: 'priceUpdates',
        type: 'tuple',
        internalType: 'struct Internal.PriceUpdates',
        components: [
          {
            name: 'tokenPriceUpdates',
            type: 'tuple[]',
            internalType: 'struct Internal.TokenPriceUpdate[]',
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
            internalType: 'struct Internal.GasPriceUpdate[]',
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
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'AuthorizedCallerAdded',
    inputs: [
      {
        name: 'caller',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AuthorizedCallerRemoved',
    inputs: [
      {
        name: 'caller',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'DestChainAdded',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'destChainConfig',
        type: 'tuple',
        indexed: false,
        internalType: 'struct FeeQuoter.DestChainConfig',
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
    anonymous: false,
  },
  {
    type: 'event',
    name: 'DestChainConfigUpdated',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'destChainConfig',
        type: 'tuple',
        indexed: false,
        internalType: 'struct FeeQuoter.DestChainConfig',
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
    anonymous: false,
  },
  {
    type: 'event',
    name: 'FeeTokenAdded',
    inputs: [
      {
        name: 'feeToken',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'FeeTokenRemoved',
    inputs: [
      {
        name: 'feeToken',
        type: 'address',
        indexed: true,
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
  {
    type: 'event',
    name: 'TokenTransferFeeConfigDeleted',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'TokenTransferFeeConfigUpdated',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'tokenTransferFeeConfig',
        type: 'tuple',
        indexed: false,
        internalType: 'struct FeeQuoter.TokenTransferFeeConfig',
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
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
        ],
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'UsdPerTokenUpdated',
    inputs: [
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'value',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'timestamp',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'UsdPerUnitGasUpdated',
    inputs: [
      {
        name: 'destChain',
        type: 'uint64',
        indexed: true,
        internalType: 'uint64',
      },
      {
        name: 'value',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'timestamp',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
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
    name: 'FeeTokenNotSupported',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'Invalid32ByteAddress',
    inputs: [{ name: 'encodedAddress', type: 'bytes', internalType: 'bytes' }],
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
    name: 'InvalidDataLength',
    inputs: [
      {
        name: 'location',
        type: 'uint8',
        internalType: 'enum ExtraArgsCodec.EncodingErrorLocation',
      },
      { name: 'offset', type: 'uint256', internalType: 'uint256' },
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
    name: 'InvalidEVMAddress',
    inputs: [{ name: 'encodedAddress', type: 'bytes', internalType: 'bytes' }],
  },
  { type: 'error', name: 'InvalidExtraArgsData', inputs: [] },
  { type: 'error', name: 'InvalidExtraArgsTag', inputs: [] },
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
  { type: 'error', name: 'InvalidStaticConfig', inputs: [] },
  {
    type: 'error',
    name: 'InvalidTVMAddress',
    inputs: [{ name: 'encodedAddress', type: 'bytes', internalType: 'bytes' }],
  },
  { type: 'error', name: 'InvalidTokenReceiver', inputs: [] },
  { type: 'error', name: 'MessageComputeUnitLimitTooHigh', inputs: [] },
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
  { type: 'error', name: 'MessageGasLimitTooHigh', inputs: [] },
  {
    type: 'error',
    name: 'MessageTooLarge',
    inputs: [
      { name: 'maxSize', type: 'uint256', internalType: 'uint256' },
      { name: 'actualSize', type: 'uint256', internalType: 'uint256' },
    ],
  },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
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
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'SourceTokenDataTooLarge',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'TokenNotSupported',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
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
    name: 'UnauthorizedCaller',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
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
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  // generate:end
] as const
