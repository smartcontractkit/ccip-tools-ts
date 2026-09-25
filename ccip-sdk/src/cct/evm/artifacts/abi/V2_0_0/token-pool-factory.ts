export default [
  // generate:
  // (() => {
  //   const abi = require('@chainlink/contracts-ccip/abi/v2_0_0/token_pool_factory.json')
  //   return require('util').inspect(Array.isArray(abi) ? abi : abi.abi, { depth: 99 }).split('\n').slice(1, -1)
  // })()
  {
    type: 'constructor',
    inputs: [
      {
        name: 'tokenAdminRegistry',
        type: 'address',
        internalType: 'contract ITokenAdminRegistry',
      },
      {
        name: 'tokenAdminModule',
        type: 'address',
        internalType: 'contract RegistryModuleOwnerCustom',
      },
      { name: 'rmnProxy', type: 'address', internalType: 'address' },
      { name: 'ccipRouter', type: 'address', internalType: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'deployTokenAndTokenPool',
    inputs: [
      {
        name: 'remoteTokenPools',
        type: 'tuple[]',
        internalType: 'struct TokenPoolFactory.RemoteTokenPoolInfo[]',
        components: [
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
          {
            name: 'remotePoolInitCode',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'remoteChainConfig',
            type: 'tuple',
            internalType: 'struct TokenPoolFactory.RemoteChainConfig',
            components: [
              {
                name: 'remotePoolFactory',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'remoteRouter',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'remoteRMNProxy',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'remoteLockBox',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'remoteTokenDecimals',
                type: 'uint8',
                internalType: 'uint8',
              },
            ],
          },
          {
            name: 'poolType',
            type: 'uint8',
            internalType: 'enum TokenPoolFactory.PoolType',
          },
          {
            name: 'remoteTokenAddress',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'remoteTokenInitCode',
            type: 'bytes',
            internalType: 'bytes',
          },
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
              {
                name: 'rate',
                type: 'uint128',
                internalType: 'uint128',
              },
            ],
          },
        ],
      },
      {
        name: 'localTokenDecimals',
        type: 'uint8',
        internalType: 'uint8',
      },
      {
        name: 'localPoolType',
        type: 'uint8',
        internalType: 'enum TokenPoolFactory.PoolType',
      },
      { name: 'tokenInitCode', type: 'bytes', internalType: 'bytes' },
      {
        name: 'tokenPoolInitCode',
        type: 'bytes',
        internalType: 'bytes',
      },
      { name: 'lockBox', type: 'address', internalType: 'address' },
      { name: 'salt', type: 'bytes32', internalType: 'bytes32' },
      { name: 'futureOwner', type: 'address', internalType: 'address' },
    ],
    outputs: [
      { name: '', type: 'address', internalType: 'address' },
      { name: '', type: 'address', internalType: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'deployTokenPoolWithExistingToken',
    inputs: [
      { name: 'token', type: 'address', internalType: 'address' },
      {
        name: 'localTokenDecimals',
        type: 'uint8',
        internalType: 'uint8',
      },
      {
        name: 'localPoolType',
        type: 'uint8',
        internalType: 'enum TokenPoolFactory.PoolType',
      },
      {
        name: 'remoteTokenPools',
        type: 'tuple[]',
        internalType: 'struct TokenPoolFactory.RemoteTokenPoolInfo[]',
        components: [
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
          {
            name: 'remotePoolInitCode',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'remoteChainConfig',
            type: 'tuple',
            internalType: 'struct TokenPoolFactory.RemoteChainConfig',
            components: [
              {
                name: 'remotePoolFactory',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'remoteRouter',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'remoteRMNProxy',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'remoteLockBox',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'remoteTokenDecimals',
                type: 'uint8',
                internalType: 'uint8',
              },
            ],
          },
          {
            name: 'poolType',
            type: 'uint8',
            internalType: 'enum TokenPoolFactory.PoolType',
          },
          {
            name: 'remoteTokenAddress',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'remoteTokenInitCode',
            type: 'bytes',
            internalType: 'bytes',
          },
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
              {
                name: 'rate',
                type: 'uint128',
                internalType: 'uint128',
              },
            ],
          },
        ],
      },
      {
        name: 'tokenPoolInitCode',
        type: 'bytes',
        internalType: 'bytes',
      },
      { name: 'lockBox', type: 'address', internalType: 'address' },
      { name: 'salt', type: 'bytes32', internalType: 'bytes32' },
      { name: 'futureOwner', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: 'poolAddress', type: 'address', internalType: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getStaticConfig',
    inputs: [],
    outputs: [
      { name: 'rmnProxy', type: 'address', internalType: 'address' },
      {
        name: 'tokenAdminRegistry',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'registryModuleOwnerCustom',
        type: 'address',
        internalType: 'address',
      },
      { name: 'ccipRouter', type: 'address', internalType: 'address' },
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
  { type: 'error', name: 'Create2EmptyBytecode', inputs: [] },
  { type: 'error', name: 'EmptyInitCode', inputs: [] },
  { type: 'error', name: 'FailedDeployment', inputs: [] },
  {
    type: 'error',
    name: 'InsufficientBalance',
    inputs: [
      { name: 'balance', type: 'uint256', internalType: 'uint256' },
      { name: 'needed', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidLockBoxToken',
    inputs: [{ name: 'poolToken', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'InvalidZeroAddress', inputs: [] },
  {
    type: 'error',
    name: 'SafeERC20FailedOperation',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  // generate:end
] as const
