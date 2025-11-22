export default [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink/raw/refs/heads/release/contracts-ccip-1.6.0/core/gethwrappers/ccip/generated/fee_quoter/fee_quoter.go')
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
          {
            name: 'tokenPriceStalenessThreshold',
            type: 'uint32',
            internalType: 'uint32',
          },
        ],
      },
      {
        name: 'priceUpdaters',
        type: 'address[]',
        internalType: 'address[]',
      },
      {
        name: 'feeTokens',
        type: 'address[]',
        internalType: 'address[]',
      },
      {
        name: 'tokenPriceFeeds',
        type: 'tuple[]',
        internalType: 'structFeeQuoter.TokenPriceFeedUpdate[]',
        components: [
          {
            name: 'sourceToken',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'feedConfig',
            type: 'tuple',
            internalType: 'structFeeQuoter.TokenPriceFeedConfig',
            components: [
              {
                name: 'dataFeedAddress',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'tokenDecimals',
                type: 'uint8',
                internalType: 'uint8',
              },
              { name: 'isEnabled', type: 'bool', internalType: 'bool' },
            ],
          },
        ],
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
                    name: 'minFeeUSDCents',
                    type: 'uint32',
                    internalType: 'uint32',
                  },
                  {
                    name: 'maxFeeUSDCents',
                    type: 'uint32',
                    internalType: 'uint32',
                  },
                  {
                    name: 'deciBps',
                    type: 'uint16',
                    internalType: 'uint16',
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
        name: 'premiumMultiplierWeiPerEthArgs',
        type: 'tuple[]',
        internalType: 'structFeeQuoter.PremiumMultiplierWeiPerEthArgs[]',
        components: [
          { name: 'token', type: 'address', internalType: 'address' },
          {
            name: 'premiumMultiplierWeiPerEth',
            type: 'uint64',
            internalType: 'uint64',
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
                name: 'maxNumberOfTokensPerMsg',
                type: 'uint16',
                internalType: 'uint16',
              },
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
                name: 'destGasPerPayloadByteHigh',
                type: 'uint8',
                internalType: 'uint8',
              },
              {
                name: 'destGasPerPayloadByteThreshold',
                type: 'uint16',
                internalType: 'uint16',
              },
              {
                name: 'destDataAvailabilityOverheadGas',
                type: 'uint32',
                internalType: 'uint32',
              },
              {
                name: 'destGasPerDataAvailabilityByte',
                type: 'uint16',
                internalType: 'uint16',
              },
              {
                name: 'destDataAvailabilityMultiplierBps',
                type: 'uint16',
                internalType: 'uint16',
              },
              {
                name: 'chainFamilySelector',
                type: 'bytes4',
                internalType: 'bytes4',
              },
              {
                name: 'enforceOutOfOrder',
                type: 'bool',
                internalType: 'bool',
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
                name: 'gasMultiplierWeiPerEth',
                type: 'uint64',
                internalType: 'uint64',
              },
              {
                name: 'gasPriceStalenessThreshold',
                type: 'uint32',
                internalType: 'uint32',
              },
              {
                name: 'networkFeeUSDCents',
                type: 'uint32',
                internalType: 'uint32',
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
    name: 'FEE_BASE_DECIMALS',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'KEYSTONE_PRICE_DECIMALS',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
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
        internalType: 'structAuthorizedCallers.AuthorizedCallerArgs',
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
                name: 'maxNumberOfTokensPerMsg',
                type: 'uint16',
                internalType: 'uint16',
              },
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
                name: 'destGasPerPayloadByteHigh',
                type: 'uint8',
                internalType: 'uint8',
              },
              {
                name: 'destGasPerPayloadByteThreshold',
                type: 'uint16',
                internalType: 'uint16',
              },
              {
                name: 'destDataAvailabilityOverheadGas',
                type: 'uint32',
                internalType: 'uint32',
              },
              {
                name: 'destGasPerDataAvailabilityByte',
                type: 'uint16',
                internalType: 'uint16',
              },
              {
                name: 'destDataAvailabilityMultiplierBps',
                type: 'uint16',
                internalType: 'uint16',
              },
              {
                name: 'chainFamilySelector',
                type: 'bytes4',
                internalType: 'bytes4',
              },
              {
                name: 'enforceOutOfOrder',
                type: 'bool',
                internalType: 'bool',
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
                name: 'gasMultiplierWeiPerEth',
                type: 'uint64',
                internalType: 'uint64',
              },
              {
                name: 'gasPriceStalenessThreshold',
                type: 'uint32',
                internalType: 'uint32',
              },
              {
                name: 'networkFeeUSDCents',
                type: 'uint32',
                internalType: 'uint32',
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
    name: 'applyFeeTokensUpdates',
    inputs: [
      {
        name: 'feeTokensToRemove',
        type: 'address[]',
        internalType: 'address[]',
      },
      {
        name: 'feeTokensToAdd',
        type: 'address[]',
        internalType: 'address[]',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'applyPremiumMultiplierWeiPerEthUpdates',
    inputs: [
      {
        name: 'premiumMultiplierWeiPerEthArgs',
        type: 'tuple[]',
        internalType: 'structFeeQuoter.PremiumMultiplierWeiPerEthArgs[]',
        components: [
          { name: 'token', type: 'address', internalType: 'address' },
          {
            name: 'premiumMultiplierWeiPerEth',
            type: 'uint64',
            internalType: 'uint64',
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
                    name: 'minFeeUSDCents',
                    type: 'uint32',
                    internalType: 'uint32',
                  },
                  {
                    name: 'maxFeeUSDCents',
                    type: 'uint32',
                    internalType: 'uint32',
                  },
                  {
                    name: 'deciBps',
                    type: 'uint16',
                    internalType: 'uint16',
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
        internalType: 'structFeeQuoter.TokenTransferFeeConfigRemoveArgs[]',
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
        internalType: 'structFeeQuoter.DestChainConfig',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'maxNumberOfTokensPerMsg',
            type: 'uint16',
            internalType: 'uint16',
          },
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
            name: 'destGasPerPayloadByteHigh',
            type: 'uint8',
            internalType: 'uint8',
          },
          {
            name: 'destGasPerPayloadByteThreshold',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'destDataAvailabilityOverheadGas',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'destGasPerDataAvailabilityByte',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'destDataAvailabilityMultiplierBps',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'chainFamilySelector',
            type: 'bytes4',
            internalType: 'bytes4',
          },
          {
            name: 'enforceOutOfOrder',
            type: 'bool',
            internalType: 'bool',
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
            name: 'gasMultiplierWeiPerEth',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'gasPriceStalenessThreshold',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'networkFeeUSDCents',
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
    name: 'getFeeTokens',
    inputs: [],
    outputs: [{ name: '', type: 'address[]', internalType: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPremiumMultiplierWeiPerEth',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
    outputs: [
      {
        name: 'premiumMultiplierWeiPerEth',
        type: 'uint64',
        internalType: 'uint64',
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
          {
            name: 'tokenPriceStalenessThreshold',
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
    name: 'getTokenPriceFeedConfig',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'structFeeQuoter.TokenPriceFeedConfig',
        components: [
          {
            name: 'dataFeedAddress',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'tokenDecimals',
            type: 'uint8',
            internalType: 'uint8',
          },
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
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
        internalType: 'structFeeQuoter.TokenTransferFeeConfig',
        components: [
          {
            name: 'minFeeUSDCents',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'maxFeeUSDCents',
            type: 'uint32',
            internalType: 'uint32',
          },
          { name: 'deciBps', type: 'uint16', internalType: 'uint16' },
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
    name: 'getValidatedTokenPrice',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'uint224', internalType: 'uint224' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'onReport',
    inputs: [
      { name: 'metadata', type: 'bytes', internalType: 'bytes' },
      { name: 'report', type: 'bytes', internalType: 'bytes' },
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
        internalType: 'structInternal.EVM2AnyTokenTransfer[]',
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
        internalType: 'structClient.EVMTokenAmount[]',
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
    name: 'setReportPermissions',
    inputs: [
      {
        name: 'permissions',
        type: 'tuple[]',
        internalType: 'structKeystoneFeedsPermissionHandler.Permission[]',
        components: [
          {
            name: 'forwarder',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'workflowName',
            type: 'bytes10',
            internalType: 'bytes10',
          },
          {
            name: 'reportName',
            type: 'bytes2',
            internalType: 'bytes2',
          },
          {
            name: 'workflowOwner',
            type: 'address',
            internalType: 'address',
          },
          { name: 'isAllowed', type: 'bool', internalType: 'bool' },
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
    name: 'updatePrices',
    inputs: [
      {
        name: 'priceUpdates',
        type: 'tuple',
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
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'updateTokenPriceFeeds',
    inputs: [
      {
        name: 'tokenPriceFeedUpdates',
        type: 'tuple[]',
        internalType: 'structFeeQuoter.TokenPriceFeedUpdate[]',
        components: [
          {
            name: 'sourceToken',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'feedConfig',
            type: 'tuple',
            internalType: 'structFeeQuoter.TokenPriceFeedConfig',
            components: [
              {
                name: 'dataFeedAddress',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'tokenDecimals',
                type: 'uint8',
                internalType: 'uint8',
              },
              { name: 'isEnabled', type: 'bool', internalType: 'bool' },
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
        internalType: 'structFeeQuoter.DestChainConfig',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'maxNumberOfTokensPerMsg',
            type: 'uint16',
            internalType: 'uint16',
          },
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
            name: 'destGasPerPayloadByteHigh',
            type: 'uint8',
            internalType: 'uint8',
          },
          {
            name: 'destGasPerPayloadByteThreshold',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'destDataAvailabilityOverheadGas',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'destGasPerDataAvailabilityByte',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'destDataAvailabilityMultiplierBps',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'chainFamilySelector',
            type: 'bytes4',
            internalType: 'bytes4',
          },
          {
            name: 'enforceOutOfOrder',
            type: 'bool',
            internalType: 'bool',
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
            name: 'gasMultiplierWeiPerEth',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'gasPriceStalenessThreshold',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'networkFeeUSDCents',
            type: 'uint32',
            internalType: 'uint32',
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
        internalType: 'structFeeQuoter.DestChainConfig',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'maxNumberOfTokensPerMsg',
            type: 'uint16',
            internalType: 'uint16',
          },
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
            name: 'destGasPerPayloadByteHigh',
            type: 'uint8',
            internalType: 'uint8',
          },
          {
            name: 'destGasPerPayloadByteThreshold',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'destDataAvailabilityOverheadGas',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'destGasPerDataAvailabilityByte',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'destDataAvailabilityMultiplierBps',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'chainFamilySelector',
            type: 'bytes4',
            internalType: 'bytes4',
          },
          {
            name: 'enforceOutOfOrder',
            type: 'bool',
            internalType: 'bool',
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
            name: 'gasMultiplierWeiPerEth',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'gasPriceStalenessThreshold',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'networkFeeUSDCents',
            type: 'uint32',
            internalType: 'uint32',
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
    name: 'PremiumMultiplierWeiPerEthUpdated',
    inputs: [
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'premiumMultiplierWeiPerEth',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'PriceFeedPerTokenUpdated',
    inputs: [
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'priceFeedConfig',
        type: 'tuple',
        indexed: false,
        internalType: 'structFeeQuoter.TokenPriceFeedConfig',
        components: [
          {
            name: 'dataFeedAddress',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'tokenDecimals',
            type: 'uint8',
            internalType: 'uint8',
          },
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
        ],
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ReportPermissionSet',
    inputs: [
      {
        name: 'reportId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'permission',
        type: 'tuple',
        indexed: false,
        internalType: 'structKeystoneFeedsPermissionHandler.Permission',
        components: [
          {
            name: 'forwarder',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'workflowName',
            type: 'bytes10',
            internalType: 'bytes10',
          },
          {
            name: 'reportName',
            type: 'bytes2',
            internalType: 'bytes2',
          },
          {
            name: 'workflowOwner',
            type: 'address',
            internalType: 'address',
          },
          { name: 'isAllowed', type: 'bool', internalType: 'bool' },
        ],
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
        internalType: 'structFeeQuoter.TokenTransferFeeConfig',
        components: [
          {
            name: 'minFeeUSDCents',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'maxFeeUSDCents',
            type: 'uint32',
            internalType: 'uint32',
          },
          { name: 'deciBps', type: 'uint16', internalType: 'uint16' },
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
  { type: 'error', name: 'DataFeedValueOutOfUint224Range', inputs: [] },
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
    name: 'ExtraArgOutOfOrderExecutionMustBeTrue',
    inputs: [],
  },
  {
    type: 'error',
    name: 'FeeTokenNotSupported',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
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
    name: 'InvalidFeeRange',
    inputs: [
      {
        name: 'minFeeUSDCents',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'maxFeeUSDCents',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidSVMAddress',
    inputs: [{ name: 'SVMAddress', type: 'bytes', internalType: 'bytes' }],
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
  { type: 'error', name: 'InvalidStaticConfig', inputs: [] },
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
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'ReportForwarderUnauthorized',
    inputs: [
      { name: 'forwarder', type: 'address', internalType: 'address' },
      {
        name: 'workflowOwner',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'workflowName',
        type: 'bytes10',
        internalType: 'bytes10',
      },
      { name: 'reportName', type: 'bytes2', internalType: 'bytes2' },
    ],
  },
  {
    type: 'error',
    name: 'SourceTokenDataTooLarge',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'StaleGasPrice',
    inputs: [
      {
        name: 'destChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'threshold', type: 'uint256', internalType: 'uint256' },
      { name: 'timePassed', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'TokenNotSupported',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
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
