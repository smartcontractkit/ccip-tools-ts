/**
 * Minimal CCIP v2 (`ccip-common 2.0.0-dev`) IDL.
 *
 * Describes the shared account resolution interface (`ccip_common::resolution`) that the
 * v2 router and offramp both implement: the params every resolution stage receives, the
 * response every stage returns, and the `CommonCcipError` codes those stages may fail with.
 * Stage instructions are not listed: they are addressed by the raw `next_ix_discriminator`
 * returned by the previous stage. Anchor 0.29 IDL format.
 */
export type CcipCommonV2 = {
  version: '2.0.0'
  name: 'ccip_common'
  instructions: []
  types: [
    {
      name: 'CcipAccountMeta'
      type: {
        kind: 'struct'
        fields: [
          { name: 'pubkey'; type: 'publicKey' },
          { name: 'isSigner'; type: 'bool' },
          { name: 'isWritable'; type: 'bool' },
        ]
      }
    },
    {
      name: 'ResolveAccountsParams'
      type: {
        kind: 'struct'
        fields: [
          { name: 'caller'; type: 'publicKey' },
          { name: 'ixData'; type: 'bytes' },
          { name: 'metadata'; type: 'bytes' },
        ]
      }
    },
    {
      name: 'ResolveAccountsResponse'
      type: {
        kind: 'struct'
        fields: [
          { name: 'askAgainWith'; type: { vec: 'publicKey' } },
          { name: 'accountsToSave'; type: { vec: { defined: 'CcipAccountMeta' } } },
          { name: 'lookupTablesToSave'; type: { vec: 'publicKey' } },
          { name: 'nextIxDiscriminator'; type: { option: { array: ['u8', 8] } } },
          { name: 'metadata'; type: 'bytes' },
        ]
      }
    },
  ]
  errors: [
    { code: 10000; name: 'InvalidSequenceInterval'; msg: 'The given sequence interval is invalid' },
    { code: 10001; name: 'InvalidInputsPoolAccounts'; msg: 'Invalid pool accounts' },
    { code: 10002; name: 'InvalidInputsTokenAccounts'; msg: 'Invalid token accounts' },
    {
      code: 10003
      name: 'InvalidInputsTokenAdminRegistryAccounts'
      msg: 'Invalid Token Admin Registry account'
    },
    { code: 10004; name: 'InvalidInputsLookupTableAccounts'; msg: 'Invalid LookupTable account' },
    {
      code: 10005
      name: 'InvalidInputsLookupTableAccountWritable'
      msg: 'Invalid LookupTable account writable access'
    },
    { code: 10006; name: 'InvalidInputsPoolSignerAccounts'; msg: 'Invalid pool signer account' },
    { code: 10007; name: 'InvalidChainFamilySelector'; msg: 'Invalid chain family selector' },
    { code: 10008; name: 'InvalidEncoding'; msg: 'Invalid encoding' },
    { code: 10009; name: 'InvalidEVMAddress'; msg: 'Invalid EVM address' },
    { code: 10010; name: 'InvalidSVMAddress'; msg: 'Invalid SVM address' },
    { code: 10011; name: 'InvalidTVMAddress'; msg: 'Invalid TVM address' },
    { code: 10012; name: 'InvalidAptosAddress'; msg: 'Invalid Aptos address' },
    { code: 10013; name: 'InvalidSuiAddress'; msg: 'Invalid Sui address' },
    { code: 10014; name: 'MessageDecodingError'; msg: 'Message decoding error' },
    {
      code: 10015
      name: 'InvalidResolutionInstructionData'
      msg: 'Invalid instruction data for account resolution'
    },
    {
      code: 10016
      name: 'InvalidResolutionMetadata'
      msg: 'Invalid metadata for account resolution'
    },
    {
      code: 10017
      name: 'InvalidNestedResolutionSigner'
      msg: 'Unexpected signer in nested account resolution response'
    },
    { code: 10018; name: 'AccountListLengthOverflow'; msg: 'Account list length overflow' },
    { code: 10019; name: 'InvalidCodeVersion'; msg: 'Invalid code version' },
    { code: 10020; name: 'InvalidPoolInterfaceVersion'; msg: 'Invalid pool interface version' },
    { code: 10021; name: 'InvalidProtocolAmount'; msg: 'Invalid ProtocolAmount' },
    { code: 10022; name: 'MissingCpiReturnData'; msg: 'MissingCpiReturnData' },
    { code: 10023; name: 'InvalidCpiReturnProgram'; msg: 'InvalidCpiReturnProgram' },
    {
      code: 10024
      name: 'InvalidCpiTargetProgram'
      msg: 'CPI target program does not match the expected program'
    },
    { code: 10025; name: 'InvalidAccountListLengths'; msg: 'InvalidAccountListLengths' },
    { code: 10026; name: 'InvalidAccountVersion'; msg: 'Invalid Account version' },
    { code: 10027; name: 'InvalidAccountData'; msg: 'Invalid Account data' },
    { code: 10028; name: 'InvalidReceiverVersion'; msg: 'Invalid receiver version' },
    { code: 10029; name: 'InvalidReceiverRegistry'; msg: 'Invalid receiver registry account' },
    { code: 10030; name: 'InvalidUsdConversion'; msg: 'Invalid USD value conversion' },
    {
      code: 10031
      name: 'ResolutionPageCapacityExhausted'
      msg: 'Account resolution response is too full to paginate'
    },
    {
      code: 10032
      name: 'TooManyCcvs'
      msg: 'Message requires more CCVs than account resolution can describe'
    },
  ]
}

export const IDL: CcipCommonV2 = {
  version: '2.0.0',
  name: 'ccip_common',
  instructions: [],
  types: [
    {
      name: 'CcipAccountMeta',
      type: {
        kind: 'struct',
        fields: [
          { name: 'pubkey', type: 'publicKey' },
          { name: 'isSigner', type: 'bool' },
          { name: 'isWritable', type: 'bool' },
        ],
      },
    },
    {
      name: 'ResolveAccountsParams',
      type: {
        kind: 'struct',
        fields: [
          { name: 'caller', type: 'publicKey' },
          { name: 'ixData', type: 'bytes' },
          { name: 'metadata', type: 'bytes' },
        ],
      },
    },
    {
      name: 'ResolveAccountsResponse',
      type: {
        kind: 'struct',
        fields: [
          { name: 'askAgainWith', type: { vec: 'publicKey' } },
          { name: 'accountsToSave', type: { vec: { defined: 'CcipAccountMeta' } } },
          { name: 'lookupTablesToSave', type: { vec: 'publicKey' } },
          { name: 'nextIxDiscriminator', type: { option: { array: ['u8', 8] } } },
          { name: 'metadata', type: 'bytes' },
        ],
      },
    },
  ],
  errors: [
    { code: 10000, name: 'InvalidSequenceInterval', msg: 'The given sequence interval is invalid' },
    { code: 10001, name: 'InvalidInputsPoolAccounts', msg: 'Invalid pool accounts' },
    { code: 10002, name: 'InvalidInputsTokenAccounts', msg: 'Invalid token accounts' },
    {
      code: 10003,
      name: 'InvalidInputsTokenAdminRegistryAccounts',
      msg: 'Invalid Token Admin Registry account',
    },
    { code: 10004, name: 'InvalidInputsLookupTableAccounts', msg: 'Invalid LookupTable account' },
    {
      code: 10005,
      name: 'InvalidInputsLookupTableAccountWritable',
      msg: 'Invalid LookupTable account writable access',
    },
    { code: 10006, name: 'InvalidInputsPoolSignerAccounts', msg: 'Invalid pool signer account' },
    { code: 10007, name: 'InvalidChainFamilySelector', msg: 'Invalid chain family selector' },
    { code: 10008, name: 'InvalidEncoding', msg: 'Invalid encoding' },
    { code: 10009, name: 'InvalidEVMAddress', msg: 'Invalid EVM address' },
    { code: 10010, name: 'InvalidSVMAddress', msg: 'Invalid SVM address' },
    { code: 10011, name: 'InvalidTVMAddress', msg: 'Invalid TVM address' },
    { code: 10012, name: 'InvalidAptosAddress', msg: 'Invalid Aptos address' },
    { code: 10013, name: 'InvalidSuiAddress', msg: 'Invalid Sui address' },
    { code: 10014, name: 'MessageDecodingError', msg: 'Message decoding error' },
    {
      code: 10015,
      name: 'InvalidResolutionInstructionData',
      msg: 'Invalid instruction data for account resolution',
    },
    {
      code: 10016,
      name: 'InvalidResolutionMetadata',
      msg: 'Invalid metadata for account resolution',
    },
    {
      code: 10017,
      name: 'InvalidNestedResolutionSigner',
      msg: 'Unexpected signer in nested account resolution response',
    },
    { code: 10018, name: 'AccountListLengthOverflow', msg: 'Account list length overflow' },
    { code: 10019, name: 'InvalidCodeVersion', msg: 'Invalid code version' },
    { code: 10020, name: 'InvalidPoolInterfaceVersion', msg: 'Invalid pool interface version' },
    { code: 10021, name: 'InvalidProtocolAmount', msg: 'Invalid ProtocolAmount' },
    { code: 10022, name: 'MissingCpiReturnData', msg: 'MissingCpiReturnData' },
    { code: 10023, name: 'InvalidCpiReturnProgram', msg: 'InvalidCpiReturnProgram' },
    {
      code: 10024,
      name: 'InvalidCpiTargetProgram',
      msg: 'CPI target program does not match the expected program',
    },
    { code: 10025, name: 'InvalidAccountListLengths', msg: 'InvalidAccountListLengths' },
    { code: 10026, name: 'InvalidAccountVersion', msg: 'Invalid Account version' },
    { code: 10027, name: 'InvalidAccountData', msg: 'Invalid Account data' },
    { code: 10028, name: 'InvalidReceiverVersion', msg: 'Invalid receiver version' },
    { code: 10029, name: 'InvalidReceiverRegistry', msg: 'Invalid receiver registry account' },
    { code: 10030, name: 'InvalidUsdConversion', msg: 'Invalid USD value conversion' },
    {
      code: 10031,
      name: 'ResolutionPageCapacityExhausted',
      msg: 'Account resolution response is too full to paginate',
    },
    {
      code: 10032,
      name: 'TooManyCcvs',
      msg: 'Message requires more CCVs than account resolution can describe',
    },
  ],
}
