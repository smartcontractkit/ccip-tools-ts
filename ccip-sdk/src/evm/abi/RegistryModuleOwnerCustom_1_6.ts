export default [
  // generate:
  // fetch('https://raw.githubusercontent.com/smartcontractkit/chainlink-ccip/release/contracts-ccip-1.6.2/chains/evm/gobindings/generated/v1_6_0/registry_module_owner_custom/registry_module_owner_custom.go')
  //   .then((res) => res.text())
  //   .then((body) => body.match(/^\s*ABI: "(.*?)",$/m)?.[1])
  //   .then((abi) => JSON.parse(abi.replace(/\\"/g, '"')))
  //   .then((obj) => require('util').inspect(obj, {depth:99}).split('\n').slice(1, -1))
  {
    type: 'constructor',
    inputs: [
      {
        name: 'tokenAdminRegistry',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'registerAccessControlDefaultAdmin',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'registerAdminViaGetCCIPAdmin',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'registerAdminViaOwner',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
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
    name: 'AdministratorRegistered',
    inputs: [
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'administrator',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  { type: 'error', name: 'AddressZero', inputs: [] },
  {
    type: 'error',
    name: 'CanOnlySelfRegister',
    inputs: [
      { name: 'admin', type: 'address', internalType: 'address' },
      { name: 'token', type: 'address', internalType: 'address' },
    ],
  },
  {
    type: 'error',
    name: 'RequiredRoleNotFound',
    inputs: [
      { name: 'msgSender', type: 'address', internalType: 'address' },
      { name: 'role', type: 'bytes32', internalType: 'bytes32' },
      { name: 'token', type: 'address', internalType: 'address' },
    ],
  },
  // generate:end
] as const
