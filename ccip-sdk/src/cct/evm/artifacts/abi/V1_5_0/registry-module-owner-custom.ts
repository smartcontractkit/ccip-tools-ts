export default [
  // generate:
  // (() => {
  //   const abi = require('@chainlink/contracts-ccip/abi/v1_5_0/registry_module_owner_custom.json')
  //   return require('util').inspect(Array.isArray(abi) ? abi : abi.abi, { depth: 99 }).split('\n').slice(1, -1)
  // })()
  {
    inputs: [
      {
        internalType: 'address',
        name: 'tokenAdminRegistry',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },
  { inputs: [], name: 'AddressZero', type: 'error' },
  {
    inputs: [
      { internalType: 'address', name: 'admin', type: 'address' },
      { internalType: 'address', name: 'token', type: 'address' },
    ],
    name: 'CanOnlySelfRegister',
    type: 'error',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'token',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'administrator',
        type: 'address',
      },
    ],
    name: 'AdministratorRegistered',
    type: 'event',
  },
  {
    inputs: [{ internalType: 'address', name: 'token', type: 'address' }],
    name: 'registerAdminViaGetCCIPAdmin',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'token', type: 'address' }],
    name: 'registerAdminViaOwner',
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
  // generate:end
] as const
