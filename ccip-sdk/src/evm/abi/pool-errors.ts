/**
 * Error-only fragments of the specialized pool/token contracts, used exclusively by
 * `parseWithFragment` to decode preflight-simulation reverts (no functions/events are ever
 * encoded against these contracts). Each set is generated from the contract's gobinding under
 * smartcontractkit/chainlink-ccip chains/evm/gobindings/generated (`npm run generate`), filtered to
 * `type === 'error'` to keep the broadly-imported const.ts bundle small: the full ABIs would be
 * ~17k lines for error decoding only.
 */

/** AdvancedPoolHooks 2.0.0 */
export const AdvancedPoolHooks_2_0_errors = [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/refs/tags/contracts-ccip-v2.0.0/chains/evm/gobindings/generated/v2_0_0/advanced_pool_hooks/advanced_pool_hooks.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((abi) => abi.filter((f) => f.type === 'error'))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  { type: 'error', name: 'AllowListNotEnabled', inputs: [] },
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  {
    type: 'error',
    name: 'DuplicateCCVNotAllowed',
    inputs: [{ name: 'ccvAddress', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  {
    type: 'error',
    name: 'MustSpecifyUnderThresholdCCVsForThresholdCCVs',
    inputs: [],
  },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'PolicyEngineDetachReverted',
    inputs: [
      {
        name: 'oldPolicyEngine',
        type: 'address',
        internalType: 'address',
      },
      { name: 'err', type: 'bytes', internalType: 'bytes' },
    ],
  },
  {
    type: 'error',
    name: 'SenderNotAllowed',
    inputs: [{ name: 'sender', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'UnauthorizedCaller',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  // generate:end
] as const

/** BurnWithFromMintRebasingTokenPool 1.5.0 */
export const BurnWithFromMintRebasingTokenPool_1_5_0_errors = [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/refs/tags/contracts-ccip-v2.0.0/chains/evm/gobindings/generated/v1_5_0/burn_with_from_mint_rebasing_token_pool/burn_with_from_mint_rebasing_token_pool.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((abi) => abi.filter((f) => f.type === 'error'))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
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
  { inputs: [], name: 'AllowListNotEnabled', type: 'error' },
  { inputs: [], name: 'BucketOverfilled', type: 'error' },
  {
    inputs: [{ internalType: 'address', name: 'caller', type: 'address' }],
    name: 'CallerIsNotARampOnRouter',
    type: 'error',
  },
  {
    inputs: [{ internalType: 'uint64', name: 'chainSelector', type: 'uint64' }],
    name: 'ChainAlreadyExists',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint64',
        name: 'remoteChainSelector',
        type: 'uint64',
      },
    ],
    name: 'ChainNotAllowed',
    type: 'error',
  },
  { inputs: [], name: 'CursedByRMN', type: 'error' },
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
    name: 'DisabledNonZeroRateLimit',
    type: 'error',
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
        name: 'rateLimiterConfig',
        type: 'tuple',
      },
    ],
    name: 'InvalidRateLimitRate',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'bytes',
        name: 'sourcePoolAddress',
        type: 'bytes',
      },
    ],
    name: 'InvalidSourcePoolAddress',
    type: 'error',
  },
  {
    inputs: [{ internalType: 'address', name: 'token', type: 'address' }],
    name: 'InvalidToken',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'amountBurned',
        type: 'uint256',
      },
    ],
    name: 'NegativeMintAmount',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint64',
        name: 'remoteChainSelector',
        type: 'uint64',
      },
    ],
    name: 'NonExistentChain',
    type: 'error',
  },
  { inputs: [], name: 'RateLimitMustBeDisabled', type: 'error' },
  {
    inputs: [{ internalType: 'address', name: 'sender', type: 'address' }],
    name: 'SenderNotAllowed',
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
  {
    inputs: [{ internalType: 'address', name: 'caller', type: 'address' }],
    name: 'Unauthorized',
    type: 'error',
  },
  { inputs: [], name: 'ZeroAddressNotAllowed', type: 'error' },
  // generate:end
] as const

/** CCTPThroughCCVTokenPool 2.0.0 */
export const CCTPThroughCCVTokenPool_2_0_errors = [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/refs/tags/contracts-ccip-v2.0.0/chains/evm/gobindings/generated/v2_0_0/cctp_through_ccv_token_pool/cctp_through_ccv_token_pool.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((abi) => abi.filter((f) => f.type === 'error'))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  { type: 'error', name: 'BucketOverfilled', inputs: [] },
  {
    type: 'error',
    name: 'CCVNotSetOnResolver',
    inputs: [{ name: 'resolver', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'CallerIsNotARampOnRouter',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'CallerIsNotOwnerOrFeeAdmin',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  {
    type: 'error',
    name: 'ChainAlreadyExists',
    inputs: [{ name: 'chainSelector', type: 'uint64', internalType: 'uint64' }],
  },
  {
    type: 'error',
    name: 'ChainNotAllowed',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'CursedByRMN', inputs: [] },
  {
    type: 'error',
    name: 'DisabledNonZeroRateLimit',
    inputs: [
      {
        name: 'config',
        type: 'tuple',
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
  },
  { type: 'error', name: 'IPoolV1NotSupported', inputs: [] },
  {
    type: 'error',
    name: 'InvalidDecimalArgs',
    inputs: [
      { name: 'expected', type: 'uint8', internalType: 'uint8' },
      { name: 'actual', type: 'uint8', internalType: 'uint8' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRateLimitRate',
    inputs: [
      {
        name: 'rateLimiterConfig',
        type: 'tuple',
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRemoteChainDecimals',
    inputs: [{ name: 'sourcePoolData', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'InvalidRemotePoolForChain',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRequestedFinality',
    inputs: [
      {
        name: 'requestedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
      },
      {
        name: 'allowedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidSourcePoolAddress',
    inputs: [
      {
        name: 'sourcePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidToken',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'InvalidTokenTransferFeeConfig',
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
    name: 'InvalidTransferFeeBps',
    inputs: [{ name: 'bps', type: 'uint256', internalType: 'uint256' }],
  },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  {
    type: 'error',
    name: 'NonExistentChain',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  {
    type: 'error',
    name: 'OverflowDetected',
    inputs: [
      { name: 'remoteDecimals', type: 'uint8', internalType: 'uint8' },
      { name: 'localDecimals', type: 'uint8', internalType: 'uint8' },
      {
        name: 'remoteAmount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'PoolAlreadyAdded',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'RequestedFinalityCanOnlyHaveOneMode',
    inputs: [
      {
        name: 'encodedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
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
    name: 'TokenMaxCapacityExceeded',
    inputs: [
      { name: 'capacity', type: 'uint256', internalType: 'uint256' },
      { name: 'requested', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tokenAddress',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'TokenRateLimitReached',
    inputs: [
      {
        name: 'minWaitInSeconds',
        type: 'uint256',
        internalType: 'uint256',
      },
      { name: 'available', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tokenAddress',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'Unauthorized',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'UnauthorizedCaller',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'ZeroAddressInvalid', inputs: [] },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  // generate:end
] as const

/** CrossChainPoolToken 2.0.0 */
export const CrossChainPoolToken_2_0_errors = [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/refs/tags/contracts-ccip-v2.0.0/chains/evm/gobindings/generated/v2_0_0/cross_chain_pool_token/cross_chain_pool_token.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((abi) => abi.filter((f) => f.type === 'error'))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  { type: 'error', name: 'BucketOverfilled', inputs: [] },
  {
    type: 'error',
    name: 'CallerIsNotARampOnRouter',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'CallerIsNotOwnerOrFeeAdmin',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'CannotRenounceCCIPAdmin', inputs: [] },
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  {
    type: 'error',
    name: 'ChainAlreadyExists',
    inputs: [{ name: 'chainSelector', type: 'uint64', internalType: 'uint64' }],
  },
  {
    type: 'error',
    name: 'ChainNotAllowed',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'CursedByRMN', inputs: [] },
  {
    type: 'error',
    name: 'DisabledNonZeroRateLimit',
    inputs: [
      {
        name: 'config',
        type: 'tuple',
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'ERC20InsufficientAllowance',
    inputs: [
      { name: 'spender', type: 'address', internalType: 'address' },
      { name: 'allowance', type: 'uint256', internalType: 'uint256' },
      { name: 'needed', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ERC20InsufficientBalance',
    inputs: [
      { name: 'sender', type: 'address', internalType: 'address' },
      { name: 'balance', type: 'uint256', internalType: 'uint256' },
      { name: 'needed', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ERC20InvalidApprover',
    inputs: [{ name: 'approver', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'ERC20InvalidReceiver',
    inputs: [{ name: 'receiver', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'ERC20InvalidSender',
    inputs: [{ name: 'sender', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'ERC20InvalidSpender',
    inputs: [{ name: 'spender', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'InvalidDecimalArgs',
    inputs: [
      { name: 'expected', type: 'uint8', internalType: 'uint8' },
      { name: 'actual', type: 'uint8', internalType: 'uint8' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRateLimitRate',
    inputs: [
      {
        name: 'rateLimiterConfig',
        type: 'tuple',
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRemoteChainDecimals',
    inputs: [{ name: 'sourcePoolData', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'InvalidRemotePoolForChain',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRequestedFinality',
    inputs: [
      {
        name: 'requestedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
      },
      {
        name: 'allowedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidSourcePoolAddress',
    inputs: [
      {
        name: 'sourcePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidToken',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'InvalidTokenTransferFeeConfig',
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
    name: 'InvalidTransferFeeBps',
    inputs: [{ name: 'bps', type: 'uint256', internalType: 'uint256' }],
  },
  {
    type: 'error',
    name: 'MaxSupplyExceeded',
    inputs: [
      {
        name: 'supplyAfterMint',
        type: 'uint256',
        internalType: 'uint256',
      },
      { name: 'maxSupply', type: 'uint256', internalType: 'uint256' },
    ],
  },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  {
    type: 'error',
    name: 'NonExistentChain',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'OnlyCCIPAdmin', inputs: [] },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  {
    type: 'error',
    name: 'OverflowDetected',
    inputs: [
      { name: 'remoteDecimals', type: 'uint8', internalType: 'uint8' },
      { name: 'localDecimals', type: 'uint8', internalType: 'uint8' },
      {
        name: 'remoteAmount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'PoolAlreadyAdded',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  { type: 'error', name: 'PreMintAddressNotSet', inputs: [] },
  {
    type: 'error',
    name: 'PreMintRecipientSetWithZeroPreMint',
    inputs: [
      {
        name: 'preMintRecipient',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'RequestedFinalityCanOnlyHaveOneMode',
    inputs: [
      {
        name: 'encodedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
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
    name: 'TokenMaxCapacityExceeded',
    inputs: [
      { name: 'capacity', type: 'uint256', internalType: 'uint256' },
      { name: 'requested', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tokenAddress',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'TokenRateLimitReached',
    inputs: [
      {
        name: 'minWaitInSeconds',
        type: 'uint256',
        internalType: 'uint256',
      },
      { name: 'available', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tokenAddress',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'Unauthorized',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'ZeroAddressInvalid', inputs: [] },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  // generate:end
] as const

/** CrossChainToken 2.0.0 */
export const CrossChainToken_2_0_errors = [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/refs/tags/contracts-ccip-v2.0.0/chains/evm/gobindings/generated/v2_0_0/cross_chain_token/cross_chain_token.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((abi) => abi.filter((f) => f.type === 'error'))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  { type: 'error', name: 'AccessControlBadConfirmation', inputs: [] },
  {
    type: 'error',
    name: 'AccessControlEnforcedDefaultAdminDelay',
    inputs: [{ name: 'schedule', type: 'uint48', internalType: 'uint48' }],
  },
  {
    type: 'error',
    name: 'AccessControlEnforcedDefaultAdminRules',
    inputs: [],
  },
  {
    type: 'error',
    name: 'AccessControlInvalidDefaultAdmin',
    inputs: [
      {
        name: 'defaultAdmin',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'AccessControlUnauthorizedAccount',
    inputs: [
      { name: 'account', type: 'address', internalType: 'address' },
      { name: 'neededRole', type: 'bytes32', internalType: 'bytes32' },
    ],
  },
  { type: 'error', name: 'CannotRenounceCCIPAdmin', inputs: [] },
  {
    type: 'error',
    name: 'ERC20InsufficientAllowance',
    inputs: [
      { name: 'spender', type: 'address', internalType: 'address' },
      { name: 'allowance', type: 'uint256', internalType: 'uint256' },
      { name: 'needed', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ERC20InsufficientBalance',
    inputs: [
      { name: 'sender', type: 'address', internalType: 'address' },
      { name: 'balance', type: 'uint256', internalType: 'uint256' },
      { name: 'needed', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ERC20InvalidApprover',
    inputs: [{ name: 'approver', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'ERC20InvalidReceiver',
    inputs: [{ name: 'receiver', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'ERC20InvalidSender',
    inputs: [{ name: 'sender', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'ERC20InvalidSpender',
    inputs: [{ name: 'spender', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'MaxSupplyExceeded',
    inputs: [
      {
        name: 'supplyAfterMint',
        type: 'uint256',
        internalType: 'uint256',
      },
      { name: 'maxSupply', type: 'uint256', internalType: 'uint256' },
    ],
  },
  { type: 'error', name: 'OnlyCCIPAdmin', inputs: [] },
  { type: 'error', name: 'PreMintAddressNotSet', inputs: [] },
  {
    type: 'error',
    name: 'PreMintRecipientSetWithZeroPreMint',
    inputs: [
      {
        name: 'preMintRecipient',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'SafeCastOverflowedUintDowncast',
    inputs: [
      { name: 'bits', type: 'uint8', internalType: 'uint8' },
      { name: 'value', type: 'uint256', internalType: 'uint256' },
    ],
  },
  // generate:end
] as const

/** ERC20LockBox 2.0.0 */
export const ERC20LockBox_2_0_errors = [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/refs/tags/contracts-ccip-v2.0.0/chains/evm/gobindings/generated/v2_0_0/erc20_lock_box/erc20_lock_box.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((abi) => abi.filter((f) => f.type === 'error'))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  {
    type: 'error',
    name: 'InsufficientBalance',
    inputs: [
      { name: 'requested', type: 'uint256', internalType: 'uint256' },
      { name: 'available', type: 'uint256', internalType: 'uint256' },
    ],
  },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  { type: 'error', name: 'RecipientCannotBeZeroAddress', inputs: [] },
  {
    type: 'error',
    name: 'SafeERC20FailedOperation',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'TokenAmountCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'UnauthorizedCaller',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'UnsupportedToken',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  // generate:end
] as const

/** FactoryBurnMintERC20 1.5.1 */
export const FactoryBurnMintERC20_1_5_1_errors = [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/refs/tags/contracts-ccip-v2.0.0/chains/evm/gobindings/generated/v1_5_1/factory_burn_mint_erc20/factory_burn_mint_erc20.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((abi) => abi.filter((f) => f.type === 'error'))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  {
    type: 'error',
    name: 'MaxSupplyExceeded',
    inputs: [
      {
        name: 'supplyAfterMint',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'SenderNotBurner',
    inputs: [{ name: 'sender', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'SenderNotMinter',
    inputs: [{ name: 'sender', type: 'address', internalType: 'address' }],
  },
  // generate:end
] as const

/** BurnMintFastTransferTokenPool 1.6.0 */
export const FastTransferTokenPool_1_6_0_errors = [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/refs/tags/contracts-ccip-v2.0.0/chains/evm/gobindings/generated/v1_6_0/fast_transfer_token_pool/fast_transfer_token_pool.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((abi) => abi.filter((f) => f.type === 'error'))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  { type: 'error', name: 'AllowListNotEnabled', inputs: [] },
  {
    type: 'error',
    name: 'AlreadyFilledOrSettled',
    inputs: [{ name: 'fillId', type: 'bytes32', internalType: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'AlreadySettled',
    inputs: [{ name: 'fillId', type: 'bytes32', internalType: 'bytes32' }],
  },
  { type: 'error', name: 'BucketOverfilled', inputs: [] },
  {
    type: 'error',
    name: 'CallerIsNotARampOnRouter',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  {
    type: 'error',
    name: 'ChainAlreadyExists',
    inputs: [{ name: 'chainSelector', type: 'uint64', internalType: 'uint64' }],
  },
  {
    type: 'error',
    name: 'ChainNotAllowed',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'CursedByRMN', inputs: [] },
  {
    type: 'error',
    name: 'DisabledNonZeroRateLimit',
    inputs: [
      {
        name: 'config',
        type: 'tuple',
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'FillerNotAllowlisted',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'filler', type: 'address', internalType: 'address' },
    ],
  },
  {
    type: 'error',
    name: 'InsufficientPoolFees',
    inputs: [
      { name: 'requested', type: 'uint256', internalType: 'uint256' },
      { name: 'available', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidDecimalArgs',
    inputs: [
      { name: 'expected', type: 'uint8', internalType: 'uint8' },
      { name: 'actual', type: 'uint8', internalType: 'uint8' },
    ],
  },
  { type: 'error', name: 'InvalidDestChainConfig', inputs: [] },
  {
    type: 'error',
    name: 'InvalidEncodedAddress',
    inputs: [{ name: 'encodedAddress', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'InvalidFillId',
    inputs: [{ name: 'fillId', type: 'bytes32', internalType: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'InvalidRateLimitRate',
    inputs: [
      {
        name: 'rateLimiterConfig',
        type: 'tuple',
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRemoteChainDecimals',
    inputs: [{ name: 'sourcePoolData', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'InvalidRemotePoolForChain',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRouter',
    inputs: [{ name: 'router', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'InvalidSourcePoolAddress',
    inputs: [
      {
        name: 'sourcePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidToken',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'MismatchedArrayLengths', inputs: [] },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  {
    type: 'error',
    name: 'NonExistentChain',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  {
    type: 'error',
    name: 'OverflowDetected',
    inputs: [
      { name: 'remoteDecimals', type: 'uint8', internalType: 'uint8' },
      { name: 'localDecimals', type: 'uint8', internalType: 'uint8' },
      {
        name: 'remoteAmount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'PoolAlreadyAdded',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'QuoteFeeExceedsUserMaxLimit',
    inputs: [
      { name: 'quoteFee', type: 'uint256', internalType: 'uint256' },
      {
        name: 'maxFastTransferFee',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'SenderNotAllowed',
    inputs: [{ name: 'sender', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'TokenMaxCapacityExceeded',
    inputs: [
      { name: 'capacity', type: 'uint256', internalType: 'uint256' },
      { name: 'requested', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tokenAddress',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'TokenRateLimitReached',
    inputs: [
      {
        name: 'minWaitInSeconds',
        type: 'uint256',
        internalType: 'uint256',
      },
      { name: 'available', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tokenAddress',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'TransferAmountExceedsMaxFillAmount',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'amount', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'Unauthorized',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'ZeroAddressInvalid', inputs: [] },
  // generate:end
] as const

/** LombardTokenPool 2.0.0 */
export const LombardTokenPool_2_0_errors = [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/refs/tags/contracts-ccip-v2.0.0/chains/evm/gobindings/generated/v2_0_0/lombard_token_pool/lombard_token_pool.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((abi) => abi.filter((f) => f.type === 'error'))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  { type: 'error', name: 'BucketOverfilled', inputs: [] },
  {
    type: 'error',
    name: 'CallerIsNotARampOnRouter',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'CallerIsNotOwnerOrFeeAdmin',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  {
    type: 'error',
    name: 'ChainAlreadyExists',
    inputs: [{ name: 'chainSelector', type: 'uint64', internalType: 'uint64' }],
  },
  {
    type: 'error',
    name: 'ChainNotAllowed',
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
    name: 'ChainNotSupported',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'CursedByRMN', inputs: [] },
  {
    type: 'error',
    name: 'DisabledNonZeroRateLimit',
    inputs: [
      {
        name: 'config',
        type: 'tuple',
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
  },
  { type: 'error', name: 'ExecutionError', inputs: [] },
  { type: 'error', name: 'HashMismatch', inputs: [] },
  {
    type: 'error',
    name: 'Invalid32ByteAddress',
    inputs: [{ name: 'encodedAddress', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'InvalidDecimalArgs',
    inputs: [
      { name: 'expected', type: 'uint8', internalType: 'uint8' },
      { name: 'actual', type: 'uint8', internalType: 'uint8' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidMessageVersion',
    inputs: [
      { name: 'expected', type: 'uint8', internalType: 'uint8' },
      { name: 'received', type: 'uint8', internalType: 'uint8' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRateLimitRate',
    inputs: [
      {
        name: 'rateLimiterConfig',
        type: 'tuple',
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidReceiver',
    inputs: [{ name: 'receiver', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'InvalidRemoteChainDecimals',
    inputs: [{ name: 'sourcePoolData', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'InvalidRemotePoolForChain',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRequestedFinality',
    inputs: [
      {
        name: 'requestedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
      },
      {
        name: 'allowedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidSourcePoolAddress',
    inputs: [
      {
        name: 'sourcePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidToken',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'InvalidTokenTransferFeeConfig',
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
    name: 'InvalidTransferFeeBps',
    inputs: [{ name: 'bps', type: 'uint256', internalType: 'uint256' }],
  },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  {
    type: 'error',
    name: 'NonExistentChain',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  {
    type: 'error',
    name: 'OutboundImplementationNotFoundForVerifier',
    inputs: [],
  },
  {
    type: 'error',
    name: 'OverflowDetected',
    inputs: [
      { name: 'remoteDecimals', type: 'uint8', internalType: 'uint8' },
      { name: 'localDecimals', type: 'uint8', internalType: 'uint8' },
      {
        name: 'remoteAmount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'PathNotExist',
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
    name: 'PoolAlreadyAdded',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'RemoteTokenOrAdapterMismatch',
    inputs: [
      { name: 'bridgeToken', type: 'bytes32', internalType: 'bytes32' },
      { name: 'remoteToken', type: 'bytes32', internalType: 'bytes32' },
      {
        name: 'remoteAdapter',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
  },
  {
    type: 'error',
    name: 'RequestedFinalityCanOnlyHaveOneMode',
    inputs: [
      {
        name: 'encodedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
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
    name: 'TokenMaxCapacityExceeded',
    inputs: [
      { name: 'capacity', type: 'uint256', internalType: 'uint256' },
      { name: 'requested', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tokenAddress',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'TokenRateLimitReached',
    inputs: [
      {
        name: 'minWaitInSeconds',
        type: 'uint256',
        internalType: 'uint256',
      },
      { name: 'available', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tokenAddress',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'Unauthorized',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'ZeroAddressInvalid', inputs: [] },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  { type: 'error', name: 'ZeroBridge', inputs: [] },
  { type: 'error', name: 'ZeroLombardChainId', inputs: [] },
  { type: 'error', name: 'ZeroVerifierNotAllowed', inputs: [] },
  // generate:end
] as const

/** SiloedLockReleaseTokenPool 1.6.0 */
export const SiloedLockReleaseTokenPool_1_6_0_errors = [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/refs/tags/contracts-ccip-v2.0.0/chains/evm/gobindings/generated/v1_6_0/siloed_lock_release_token_pool/siloed_lock_release_token_pool.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((abi) => abi.filter((f) => f.type === 'error'))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  {
    type: 'error',
    name: 'AggregateValueMaxCapacityExceeded',
    inputs: [
      { name: 'capacity', type: 'uint256', internalType: 'uint256' },
      { name: 'requested', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'AggregateValueRateLimitReached',
    inputs: [
      {
        name: 'minWaitInSeconds',
        type: 'uint256',
        internalType: 'uint256',
      },
      { name: 'available', type: 'uint256', internalType: 'uint256' },
    ],
  },
  { type: 'error', name: 'AllowListNotEnabled', inputs: [] },
  { type: 'error', name: 'BucketOverfilled', inputs: [] },
  {
    type: 'error',
    name: 'CallerIsNotARampOnRouter',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  {
    type: 'error',
    name: 'ChainAlreadyExists',
    inputs: [{ name: 'chainSelector', type: 'uint64', internalType: 'uint64' }],
  },
  {
    type: 'error',
    name: 'ChainNotAllowed',
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
    name: 'ChainNotSiloed',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'CursedByRMN', inputs: [] },
  {
    type: 'error',
    name: 'DisabledNonZeroRateLimit',
    inputs: [
      {
        name: 'config',
        type: 'tuple',
        internalType: 'structRateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'InsufficientLiquidity',
    inputs: [
      {
        name: 'availableLiquidity',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'requestedAmount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidChainSelector',
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
    name: 'InvalidDecimalArgs',
    inputs: [
      { name: 'expected', type: 'uint8', internalType: 'uint8' },
      { name: 'actual', type: 'uint8', internalType: 'uint8' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRateLimitRate',
    inputs: [
      {
        name: 'rateLimiterConfig',
        type: 'tuple',
        internalType: 'structRateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRemoteChainDecimals',
    inputs: [{ name: 'sourcePoolData', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'InvalidRemotePoolForChain',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidSourcePoolAddress',
    inputs: [
      {
        name: 'sourcePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidToken',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'LiquidityAmountCannotBeZero', inputs: [] },
  { type: 'error', name: 'MismatchedArrayLengths', inputs: [] },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  {
    type: 'error',
    name: 'NonExistentChain',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  {
    type: 'error',
    name: 'OverflowDetected',
    inputs: [
      { name: 'remoteDecimals', type: 'uint8', internalType: 'uint8' },
      { name: 'localDecimals', type: 'uint8', internalType: 'uint8' },
      {
        name: 'remoteAmount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'PoolAlreadyAdded',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  { type: 'error', name: 'RateLimitMustBeDisabled', inputs: [] },
  {
    type: 'error',
    name: 'SenderNotAllowed',
    inputs: [{ name: 'sender', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'TokenMaxCapacityExceeded',
    inputs: [
      { name: 'capacity', type: 'uint256', internalType: 'uint256' },
      { name: 'requested', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tokenAddress',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'TokenRateLimitReached',
    inputs: [
      {
        name: 'minWaitInSeconds',
        type: 'uint256',
        internalType: 'uint256',
      },
      { name: 'available', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tokenAddress',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'Unauthorized',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  // generate:end
] as const

/** SiloedLockReleaseTokenPool 2.0.0 */
export const SiloedLockReleaseTokenPool_2_0_errors = [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/refs/tags/contracts-ccip-v2.0.0/chains/evm/gobindings/generated/v2_0_0/siloed_lock_release_token_pool/siloed_lock_release_token_pool.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((abi) => abi.filter((f) => f.type === 'error'))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  { type: 'error', name: 'BucketOverfilled', inputs: [] },
  {
    type: 'error',
    name: 'CallerIsNotARampOnRouter',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'CallerIsNotOwnerOrFeeAdmin',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  {
    type: 'error',
    name: 'ChainAlreadyExists',
    inputs: [{ name: 'chainSelector', type: 'uint64', internalType: 'uint64' }],
  },
  {
    type: 'error',
    name: 'ChainNotAllowed',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'CursedByRMN', inputs: [] },
  {
    type: 'error',
    name: 'DisabledNonZeroRateLimit',
    inputs: [
      {
        name: 'config',
        type: 'tuple',
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidDecimalArgs',
    inputs: [
      { name: 'expected', type: 'uint8', internalType: 'uint8' },
      { name: 'actual', type: 'uint8', internalType: 'uint8' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRateLimitRate',
    inputs: [
      {
        name: 'rateLimiterConfig',
        type: 'tuple',
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRemoteChainDecimals',
    inputs: [{ name: 'sourcePoolData', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'InvalidRemotePoolForChain',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRequestedFinality',
    inputs: [
      {
        name: 'requestedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
      },
      {
        name: 'allowedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidSourcePoolAddress',
    inputs: [
      {
        name: 'sourcePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidToken',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'InvalidTokenTransferFeeConfig',
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
    name: 'InvalidTransferFeeBps',
    inputs: [{ name: 'bps', type: 'uint256', internalType: 'uint256' }],
  },
  {
    type: 'error',
    name: 'LockBoxNotConfigured',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  {
    type: 'error',
    name: 'NonExistentChain',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  {
    type: 'error',
    name: 'OverflowDetected',
    inputs: [
      { name: 'remoteDecimals', type: 'uint8', internalType: 'uint8' },
      { name: 'localDecimals', type: 'uint8', internalType: 'uint8' },
      {
        name: 'remoteAmount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'PoolAlreadyAdded',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'RequestedFinalityCanOnlyHaveOneMode',
    inputs: [
      {
        name: 'encodedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
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
    name: 'TokenMaxCapacityExceeded',
    inputs: [
      { name: 'capacity', type: 'uint256', internalType: 'uint256' },
      { name: 'requested', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tokenAddress',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'TokenRateLimitReached',
    inputs: [
      {
        name: 'minWaitInSeconds',
        type: 'uint256',
        internalType: 'uint256',
      },
      { name: 'available', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tokenAddress',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'Unauthorized',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'ZeroAddressInvalid', inputs: [] },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  // generate:end
] as const

/** SiloedUSDCTokenPool 2.0.0 */
export const SiloedUSDCTokenPool_2_0_errors = [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/refs/tags/contracts-ccip-v2.0.0/chains/evm/gobindings/generated/v2_0_0/siloed_usdc_token_pool/siloed_usdc_token_pool.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((abi) => abi.filter((f) => f.type === 'error'))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  { type: 'error', name: 'BucketOverfilled', inputs: [] },
  {
    type: 'error',
    name: 'CallerIsNotARampOnRouter',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'CallerIsNotOwnerOrFeeAdmin',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  {
    type: 'error',
    name: 'ChainAlreadyExists',
    inputs: [{ name: 'chainSelector', type: 'uint64', internalType: 'uint64' }],
  },
  {
    type: 'error',
    name: 'ChainAlreadyMigrated',
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
    name: 'ChainNotAllowed',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'CursedByRMN', inputs: [] },
  {
    type: 'error',
    name: 'DisabledNonZeroRateLimit',
    inputs: [
      {
        name: 'config',
        type: 'tuple',
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
  },
  { type: 'error', name: 'ExistingMigrationProposal', inputs: [] },
  {
    type: 'error',
    name: 'InsufficientLiquidity',
    inputs: [
      {
        name: 'availableLiquidity',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'requestedAmount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  { type: 'error', name: 'InvalidChainSelector', inputs: [] },
  {
    type: 'error',
    name: 'InvalidDecimalArgs',
    inputs: [
      { name: 'expected', type: 'uint8', internalType: 'uint8' },
      { name: 'actual', type: 'uint8', internalType: 'uint8' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRateLimitRate',
    inputs: [
      {
        name: 'rateLimiterConfig',
        type: 'tuple',
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRemoteChainDecimals',
    inputs: [{ name: 'sourcePoolData', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'InvalidRemotePoolForChain',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRequestedFinality',
    inputs: [
      {
        name: 'requestedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
      },
      {
        name: 'allowedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidSourcePoolAddress',
    inputs: [
      {
        name: 'sourcePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidToken',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'InvalidTokenTransferFeeConfig',
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
    name: 'InvalidTransferFeeBps',
    inputs: [{ name: 'bps', type: 'uint256', internalType: 'uint256' }],
  },
  {
    type: 'error',
    name: 'LockBoxCannotBeShared',
    inputs: [
      {
        name: 'chainSelectorA',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'chainSelectorB',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'lockBox', type: 'address', internalType: 'address' },
    ],
  },
  {
    type: 'error',
    name: 'LockBoxNotConfigured',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  { type: 'error', name: 'NoMigrationProposalPending', inputs: [] },
  {
    type: 'error',
    name: 'NonExistentChain',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  { type: 'error', name: 'OnlyCircle', inputs: [] },
  {
    type: 'error',
    name: 'OverflowDetected',
    inputs: [
      { name: 'remoteDecimals', type: 'uint8', internalType: 'uint8' },
      { name: 'localDecimals', type: 'uint8', internalType: 'uint8' },
      {
        name: 'remoteAmount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'PoolAlreadyAdded',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'RequestedFinalityCanOnlyHaveOneMode',
    inputs: [
      {
        name: 'encodedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
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
    name: 'TokenMaxCapacityExceeded',
    inputs: [
      { name: 'capacity', type: 'uint256', internalType: 'uint256' },
      { name: 'requested', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tokenAddress',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'TokenRateLimitReached',
    inputs: [
      {
        name: 'minWaitInSeconds',
        type: 'uint256',
        internalType: 'uint256',
      },
      { name: 'available', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tokenAddress',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'Unauthorized',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'UnauthorizedCaller',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'ZeroAddressInvalid', inputs: [] },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  // generate:end
] as const

/** USDCTokenPool 1.5.1 */
export const USDCTokenPool_1_5_1_errors = [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/refs/tags/contracts-ccip-v2.0.0/chains/evm/gobindings/generated/v1_5_1/usdc_token_pool/usdc_token_pool.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((abi) => abi.filter((f) => f.type === 'error'))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  {
    type: 'error',
    name: 'AggregateValueMaxCapacityExceeded',
    inputs: [
      { name: 'capacity', type: 'uint256', internalType: 'uint256' },
      { name: 'requested', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'AggregateValueRateLimitReached',
    inputs: [
      {
        name: 'minWaitInSeconds',
        type: 'uint256',
        internalType: 'uint256',
      },
      { name: 'available', type: 'uint256', internalType: 'uint256' },
    ],
  },
  { type: 'error', name: 'AllowListNotEnabled', inputs: [] },
  { type: 'error', name: 'BucketOverfilled', inputs: [] },
  {
    type: 'error',
    name: 'CallerIsNotARampOnRouter',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  {
    type: 'error',
    name: 'ChainAlreadyExists',
    inputs: [{ name: 'chainSelector', type: 'uint64', internalType: 'uint64' }],
  },
  {
    type: 'error',
    name: 'ChainNotAllowed',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'CursedByRMN', inputs: [] },
  {
    type: 'error',
    name: 'DisabledNonZeroRateLimit',
    inputs: [
      {
        name: 'config',
        type: 'tuple',
        internalType: 'structRateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
  },
  { type: 'error', name: 'InvalidConfig', inputs: [] },
  {
    type: 'error',
    name: 'InvalidDecimalArgs',
    inputs: [
      { name: 'expected', type: 'uint8', internalType: 'uint8' },
      { name: 'actual', type: 'uint8', internalType: 'uint8' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidDestinationDomain',
    inputs: [
      { name: 'expected', type: 'uint32', internalType: 'uint32' },
      { name: 'got', type: 'uint32', internalType: 'uint32' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidDomain',
    inputs: [
      {
        name: 'domain',
        type: 'tuple',
        internalType: 'structUSDCTokenPool.DomainUpdate',
        components: [
          {
            name: 'allowedCaller',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'domainIdentifier',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'destChainSelector',
            type: 'uint64',
            internalType: 'uint64',
          },
          { name: 'enabled', type: 'bool', internalType: 'bool' },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidMessageVersion',
    inputs: [{ name: 'version', type: 'uint32', internalType: 'uint32' }],
  },
  {
    type: 'error',
    name: 'InvalidNonce',
    inputs: [
      { name: 'expected', type: 'uint64', internalType: 'uint64' },
      { name: 'got', type: 'uint64', internalType: 'uint64' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRateLimitRate',
    inputs: [
      {
        name: 'rateLimiterConfig',
        type: 'tuple',
        internalType: 'structRateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidReceiver',
    inputs: [{ name: 'receiver', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'InvalidRemoteChainDecimals',
    inputs: [{ name: 'sourcePoolData', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'InvalidRemotePoolForChain',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
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
    name: 'InvalidSourcePoolAddress',
    inputs: [
      {
        name: 'sourcePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidToken',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'InvalidTokenMessengerVersion',
    inputs: [{ name: 'version', type: 'uint32', internalType: 'uint32' }],
  },
  { type: 'error', name: 'MismatchedArrayLengths', inputs: [] },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  {
    type: 'error',
    name: 'NonExistentChain',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  {
    type: 'error',
    name: 'OverflowDetected',
    inputs: [
      { name: 'remoteDecimals', type: 'uint8', internalType: 'uint8' },
      { name: 'localDecimals', type: 'uint8', internalType: 'uint8' },
      {
        name: 'remoteAmount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'PoolAlreadyAdded',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  { type: 'error', name: 'RateLimitMustBeDisabled', inputs: [] },
  {
    type: 'error',
    name: 'SenderNotAllowed',
    inputs: [{ name: 'sender', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'TokenMaxCapacityExceeded',
    inputs: [
      { name: 'capacity', type: 'uint256', internalType: 'uint256' },
      { name: 'requested', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tokenAddress',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'TokenRateLimitReached',
    inputs: [
      {
        name: 'minWaitInSeconds',
        type: 'uint256',
        internalType: 'uint256',
      },
      { name: 'available', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tokenAddress',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'Unauthorized',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'UnknownDomain',
    inputs: [{ name: 'domain', type: 'uint64', internalType: 'uint64' }],
  },
  { type: 'error', name: 'UnlockingUSDCFailed', inputs: [] },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  // generate:end
] as const

/** ConnectionPolicyStore 2.1.0-dev: reverts through the PoolConfigManager and the multi-token pool */
export const ConnectionPolicyStore_2_1_errors = [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/3b1b61e07b69f3a888b8023e0aea15912f645c04/chains/evm/gobindings/generated/latest/connection_policy_store/connection_policy_store.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((abi) => abi.filter((f) => f.type === 'error'))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  {
    type: 'error',
    name: 'ChainIsPaused',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'direction',
        type: 'uint8',
        internalType: 'enum ConnectionPolicyStore.PauseDirection',
      },
    ],
  },
  {
    type: 'error',
    name: 'ConnectionRecordNotFound',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  { type: 'error', name: 'GloballyPaused', inputs: [] },
  {
    type: 'error',
    name: 'InlineRecordNotFound',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidAdditionalPoolData',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'additionalPoolData',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidDecimalArgs',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      { name: 'expected', type: 'uint8', internalType: 'uint8' },
      { name: 'actual', type: 'uint8', internalType: 'uint8' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidLockOrBurnAddress',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'lockOrBurnFlavor',
        type: 'uint8',
        internalType: 'enum IPoolConfigManager.LockOrBurnFlavor',
      },
      {
        name: 'lockOrBurnAddress',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRemoteToken',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRequestedFinality',
    inputs: [
      {
        name: 'requestedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
      },
      {
        name: 'allowedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidSourcePoolAddress',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'sourcePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidSourcePoolData',
    inputs: [{ name: 'sourcePoolData', type: 'bytes', internalType: 'bytes' }],
  },
  {
    type: 'error',
    name: 'LegacyPoolDataNotAllowed',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'LegacyRemotePoolRecord',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'LocalTokenNotRegistered',
    inputs: [{ name: 'localToken', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  {
    type: 'error',
    name: 'OverflowDetected',
    inputs: [
      { name: 'remoteDecimals', type: 'uint8', internalType: 'uint8' },
      { name: 'localDecimals', type: 'uint8', internalType: 'uint8' },
      {
        name: 'remoteAmount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'PolicyHasNoTokens',
    inputs: [{ name: 'policyName', type: 'bytes32', internalType: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'PolicyHasRecords',
    inputs: [{ name: 'policyName', type: 'bytes32', internalType: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'PolicyInUse',
    inputs: [{ name: 'policyName', type: 'bytes32', internalType: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'PolicyNotFound',
    inputs: [{ name: 'policyName', type: 'bytes32', internalType: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'PolicyRecordHasNoPools',
    inputs: [
      { name: 'policyName', type: 'bytes32', internalType: 'bytes32' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'PolicyRecordNotFound',
    inputs: [
      { name: 'policyName', type: 'bytes32', internalType: 'bytes32' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'PolicyRemoteTokenMismatch',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'ProviderHasNoCode',
    inputs: [{ name: 'provider', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'RemotePoolAlreadyAdded',
    inputs: [
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'remotePoolAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'RemotePoolRecordNotFound',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'RequestedFinalityCanOnlyHaveOneMode',
    inputs: [
      {
        name: 'encodedFinality',
        type: 'bytes4',
        internalType: 'bytes4',
      },
    ],
  },
  {
    type: 'error',
    name: 'SourceTokenMismatch',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'expectedSourceToken',
        type: 'bytes',
        internalType: 'bytes',
      },
      {
        name: 'actualSourceToken',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
  },
  {
    type: 'error',
    name: 'SubsetTokenAlreadyAdded',
    inputs: [
      { name: 'policyName', type: 'bytes32', internalType: 'bytes32' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'localToken', type: 'address', internalType: 'address' },
    ],
  },
  {
    type: 'error',
    name: 'SubsetTokenNotFound',
    inputs: [
      { name: 'policyName', type: 'bytes32', internalType: 'bytes32' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      { name: 'localToken', type: 'address', internalType: 'address' },
    ],
  },
  {
    type: 'error',
    name: 'TokenHasConfig',
    inputs: [{ name: 'localToken', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'TokenIsPaused',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'direction',
        type: 'uint8',
        internalType: 'enum ConnectionPolicyStore.PauseDirection',
      },
    ],
  },
  {
    type: 'error',
    name: 'TokenNotInPolicy',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      { name: 'policyName', type: 'bytes32', internalType: 'bytes32' },
    ],
  },
  {
    type: 'error',
    name: 'UnauthorizedCaller',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'ZeroAddressInvalid', inputs: [] },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  { type: 'error', name: 'ZeroChainSelectorNotAllowed', inputs: [] },
  { type: 'error', name: 'ZeroPolicyNameNotAllowed', inputs: [] },
  // generate:end
] as const

/** FeePolicyStore 2.1.0-dev: reverts through the PoolConfigManager and the multi-token pool */
export const FeePolicyStore_2_1_errors = [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/3b1b61e07b69f3a888b8023e0aea15912f645c04/chains/evm/gobindings/generated/latest/fee_policy_store/fee_policy_store.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((abi) => abi.filter((f) => f.type === 'error'))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  {
    type: 'error',
    name: 'DestOverheadRecordNotFound',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'FeeRecordNotFound',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'InlineRecordNotFound',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidDestOverheadPolicyConfig',
    inputs: [
      { name: 'policyName', type: 'bytes32', internalType: 'bytes32' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'destOverheadConfig',
        type: 'tuple',
        internalType: 'struct FeePolicyStore.DestOverheadConfig',
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
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidFeePolicyConfig',
    inputs: [
      { name: 'policyName', type: 'bytes32', internalType: 'bytes32' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'feeConfig',
        type: 'tuple',
        internalType: 'struct FeePolicyStore.FeeConfig',
        components: [
          {
            name: 'finalityFeeUSDCents',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'fastFinalityFeeUSDCents',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'finalityTransferFeeBps',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'fastFinalityTransferFeeBps',
            type: 'uint16',
            internalType: 'uint16',
          },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidInlineDestOverheadConfig',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'destOverheadConfig',
        type: 'tuple',
        internalType: 'struct FeePolicyStore.DestOverheadConfig',
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
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidInlineFeeConfig',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'feeConfig',
        type: 'tuple',
        internalType: 'struct FeePolicyStore.FeeConfig',
        components: [
          {
            name: 'finalityFeeUSDCents',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'fastFinalityFeeUSDCents',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'finalityTransferFeeBps',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'fastFinalityTransferFeeBps',
            type: 'uint16',
            internalType: 'uint16',
          },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'LocalTokenNotRegistered',
    inputs: [{ name: 'localToken', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'PolicyHasNoTokens',
    inputs: [{ name: 'policyName', type: 'bytes32', internalType: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'PolicyHasRecords',
    inputs: [{ name: 'policyName', type: 'bytes32', internalType: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'PolicyInUse',
    inputs: [{ name: 'policyName', type: 'bytes32', internalType: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'PolicyNotFound',
    inputs: [{ name: 'policyName', type: 'bytes32', internalType: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'PolicyRecordNotFound',
    inputs: [
      { name: 'policyName', type: 'bytes32', internalType: 'bytes32' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'PoolDataTooLarge',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'destPoolDataLength',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'destBytesOverhead',
        type: 'uint32',
        internalType: 'uint32',
      },
    ],
  },
  {
    type: 'error',
    name: 'TokenHasConfig',
    inputs: [{ name: 'localToken', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'UnauthorizedCaller',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'ZeroAddressInvalid', inputs: [] },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  { type: 'error', name: 'ZeroChainSelectorNotAllowed', inputs: [] },
  { type: 'error', name: 'ZeroPolicyNameNotAllowed', inputs: [] },
  // generate:end
] as const

/** SecurityPolicyStore 2.1.0-dev: reverts through the PoolConfigManager and the multi-token pool */
export const SecurityPolicyStore_2_1_errors = [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/3b1b61e07b69f3a888b8023e0aea15912f645c04/chains/evm/gobindings/generated/latest/security_policy_store/security_policy_store.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((abi) => abi.filter((f) => f.type === 'error'))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  { type: 'error', name: 'BucketOverfilled', inputs: [] },
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  {
    type: 'error',
    name: 'DisabledNonZeroRateLimit',
    inputs: [
      {
        name: 'config',
        type: 'tuple',
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
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
    name: 'InlineRecordNotFound',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidDecimalArgs',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      { name: 'expected', type: 'uint8', internalType: 'uint8' },
      { name: 'actual', type: 'uint8', internalType: 'uint8' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidInlineRateLimitBucketConfig',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'direction',
        type: 'uint8',
        internalType: 'enum IPoolV2.MessageDirection',
      },
      { name: 'fastFinality', type: 'bool', internalType: 'bool' },
      {
        name: 'config',
        type: 'tuple',
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidInlineRateLimitConfig',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'rateLimitConfig',
        type: 'tuple',
        internalType: 'struct SecurityPolicyStore.RateLimitConfig',
        components: [
          {
            name: 'outbound',
            type: 'tuple',
            internalType: 'struct RateLimiter.Config',
            components: [
              { name: 'isEnabled', type: 'bool', internalType: 'bool' },
              {
                name: 'capacity',
                type: 'uint128',
                internalType: 'uint128',
              },
              {
                name: 'rate',
                type: 'uint128',
                internalType: 'uint128',
              },
            ],
          },
          {
            name: 'inbound',
            type: 'tuple',
            internalType: 'struct RateLimiter.Config',
            components: [
              { name: 'isEnabled', type: 'bool', internalType: 'bool' },
              {
                name: 'capacity',
                type: 'uint128',
                internalType: 'uint128',
              },
              {
                name: 'rate',
                type: 'uint128',
                internalType: 'uint128',
              },
            ],
          },
          {
            name: 'fastFinalityOutbound',
            type: 'tuple',
            internalType: 'struct RateLimiter.Config',
            components: [
              { name: 'isEnabled', type: 'bool', internalType: 'bool' },
              {
                name: 'capacity',
                type: 'uint128',
                internalType: 'uint128',
              },
              {
                name: 'rate',
                type: 'uint128',
                internalType: 'uint128',
              },
            ],
          },
          {
            name: 'fastFinalityInbound',
            type: 'tuple',
            internalType: 'struct RateLimiter.Config',
            components: [
              { name: 'isEnabled', type: 'bool', internalType: 'bool' },
              {
                name: 'capacity',
                type: 'uint128',
                internalType: 'uint128',
              },
              {
                name: 'rate',
                type: 'uint128',
                internalType: 'uint128',
              },
            ],
          },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRateLimitPolicyBucketConfig',
    inputs: [
      { name: 'policyName', type: 'bytes32', internalType: 'bytes32' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'direction',
        type: 'uint8',
        internalType: 'enum IPoolV2.MessageDirection',
      },
      { name: 'fastFinality', type: 'bool', internalType: 'bool' },
      {
        name: 'config',
        type: 'tuple',
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRateLimitPolicyConfig',
    inputs: [
      { name: 'policyName', type: 'bytes32', internalType: 'bytes32' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'rateLimitConfig',
        type: 'tuple',
        internalType: 'struct SecurityPolicyStore.RateLimitConfig',
        components: [
          {
            name: 'outbound',
            type: 'tuple',
            internalType: 'struct RateLimiter.Config',
            components: [
              { name: 'isEnabled', type: 'bool', internalType: 'bool' },
              {
                name: 'capacity',
                type: 'uint128',
                internalType: 'uint128',
              },
              {
                name: 'rate',
                type: 'uint128',
                internalType: 'uint128',
              },
            ],
          },
          {
            name: 'inbound',
            type: 'tuple',
            internalType: 'struct RateLimiter.Config',
            components: [
              { name: 'isEnabled', type: 'bool', internalType: 'bool' },
              {
                name: 'capacity',
                type: 'uint128',
                internalType: 'uint128',
              },
              {
                name: 'rate',
                type: 'uint128',
                internalType: 'uint128',
              },
            ],
          },
          {
            name: 'fastFinalityOutbound',
            type: 'tuple',
            internalType: 'struct RateLimiter.Config',
            components: [
              { name: 'isEnabled', type: 'bool', internalType: 'bool' },
              {
                name: 'capacity',
                type: 'uint128',
                internalType: 'uint128',
              },
              {
                name: 'rate',
                type: 'uint128',
                internalType: 'uint128',
              },
            ],
          },
          {
            name: 'fastFinalityInbound',
            type: 'tuple',
            internalType: 'struct RateLimiter.Config',
            components: [
              { name: 'isEnabled', type: 'bool', internalType: 'bool' },
              {
                name: 'capacity',
                type: 'uint128',
                internalType: 'uint128',
              },
              {
                name: 'rate',
                type: 'uint128',
                internalType: 'uint128',
              },
            ],
          },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRateLimitPolicyDecimals',
    inputs: [
      { name: 'policyName', type: 'bytes32', internalType: 'bytes32' },
      { name: 'expected', type: 'uint8', internalType: 'uint8' },
      { name: 'actual', type: 'uint8', internalType: 'uint8' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRateLimitRate',
    inputs: [
      {
        name: 'rateLimiterConfig',
        type: 'tuple',
        internalType: 'struct RateLimiter.Config',
        components: [
          { name: 'isEnabled', type: 'bool', internalType: 'bool' },
          {
            name: 'capacity',
            type: 'uint128',
            internalType: 'uint128',
          },
          { name: 'rate', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
  },
  {
    type: 'error',
    name: 'LocalTokenNotRegistered',
    inputs: [{ name: 'localToken', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'PolicyHasNoTokens',
    inputs: [{ name: 'policyName', type: 'bytes32', internalType: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'PolicyHasRecords',
    inputs: [{ name: 'policyName', type: 'bytes32', internalType: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'PolicyInUse',
    inputs: [{ name: 'policyName', type: 'bytes32', internalType: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'PolicyNotFound',
    inputs: [{ name: 'policyName', type: 'bytes32', internalType: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'PolicyRecordNotFound',
    inputs: [
      { name: 'policyName', type: 'bytes32', internalType: 'bytes32' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'RateLimitRecordNotFound',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'SecurityRecordNotFound',
    inputs: [
      { name: 'localToken', type: 'address', internalType: 'address' },
      {
        name: 'remoteChainSelector',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'TokenHasConfig',
    inputs: [{ name: 'localToken', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'TokenMaxCapacityExceeded',
    inputs: [
      { name: 'capacity', type: 'uint256', internalType: 'uint256' },
      { name: 'requested', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tokenAddress',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'TokenRateLimitReached',
    inputs: [
      {
        name: 'minWaitInSeconds',
        type: 'uint256',
        internalType: 'uint256',
      },
      { name: 'available', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tokenAddress',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'UnauthorizedCaller',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'ZeroAddressInvalid', inputs: [] },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  { type: 'error', name: 'ZeroChainSelectorNotAllowed', inputs: [] },
  { type: 'error', name: 'ZeroPolicyNameNotAllowed', inputs: [] },
  // generate:end
] as const

/** MultiTokenPoolHooks 2.1.0-dev: reverts through the PoolConfigManager and the multi-token pool */
export const MultiTokenPoolHooks_2_1_errors = [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/3b1b61e07b69f3a888b8023e0aea15912f645c04/chains/evm/gobindings/generated/latest/multi_token_pool_hooks/multi_token_pool_hooks.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((abi) => abi.filter((f) => f.type === 'error'))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  { type: 'error', name: 'AllowListNotEnabled', inputs: [] },
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'PolicyEngineDetachReverted',
    inputs: [
      {
        name: 'oldPolicyEngine',
        type: 'address',
        internalType: 'contract IPolicyEngine',
      },
    ],
  },
  {
    type: 'error',
    name: 'SenderNotAllowed',
    inputs: [{ name: 'sender', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'UnauthorizedCaller',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  // generate:end
] as const

/** MultiTokenPoolHooksExternalBlocklist 2.1.0-dev: reverts through the PoolConfigManager and the multi-token pool */
export const MultiTokenPoolHooksExternalBlocklist_2_1_errors = [
  // generate:
  // fetch('https://github.com/smartcontractkit/chainlink-ccip/raw/3b1b61e07b69f3a888b8023e0aea15912f645c04/chains/evm/gobindings/generated/latest/multi_token_pool_hooks_external_blocklist/multi_token_pool_hooks_external_blocklist.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((abi) => abi.filter((f) => f.type === 'error'))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  { type: 'error', name: 'AllowListNotEnabled', inputs: [] },
  { type: 'error', name: 'CannotTransferToSelf', inputs: [] },
  {
    type: 'error',
    name: 'InvalidBlocklist',
    inputs: [
      {
        name: 'blocklist',
        type: 'address',
        internalType: 'contract IAddressBlocklist',
      },
    ],
  },
  {
    type: 'error',
    name: 'LocalAddressBlocked',
    inputs: [
      {
        name: 'blocklist',
        type: 'address',
        internalType: 'contract IAddressBlocklist',
      },
      { name: 'account', type: 'address', internalType: 'address' },
    ],
  },
  { type: 'error', name: 'MustBeProposedOwner', inputs: [] },
  { type: 'error', name: 'OnlyCallableByOwner', inputs: [] },
  { type: 'error', name: 'OwnerCannotBeZero', inputs: [] },
  {
    type: 'error',
    name: 'PolicyEngineDetachReverted',
    inputs: [
      {
        name: 'oldPolicyEngine',
        type: 'address',
        internalType: 'contract IPolicyEngine',
      },
    ],
  },
  {
    type: 'error',
    name: 'RemoteAddressBlocked',
    inputs: [
      {
        name: 'blocklist',
        type: 'address',
        internalType: 'contract IAddressBlocklist',
      },
      { name: 'account', type: 'bytes', internalType: 'bytes' },
    ],
  },
  {
    type: 'error',
    name: 'SenderNotAllowed',
    inputs: [{ name: 'sender', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'UnauthorizedCaller',
    inputs: [{ name: 'caller', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
  // generate:end
] as const
