/**
 * Anchor 0.29 IDL of `ccip_router 2.0.1`, limited to set_pool_interface_implementation, upgrade_token_admin_registry, multisig_owner_propose_administrator, multisig_owner_override_pending_administrator.
 *
 * From smartcontractkit/chainlink-ccip-solana@903f3bf, contracts/target/idl/ccip_router.json.
 *
 * Converted from the `anchor build` IDL (Anchor spec 0.1.0) to the Anchor 0.29 format, with every
 * instruction and account discriminator checked against the IDL's; regenerate rather than edit.
 * Newtypes are inlined as their single field (identical Borsh layout).
 * `upgrade_token_admin_registry` is named `upgrade_token_admin_registry_from_v1`, the name its custom discriminator hashes from.
 */
export type CcipRouterTokenAdminRegistryV2 = {
  version: '2.0.1'
  name: 'ccip_router'
  instructions: [
    {
      name: 'setPoolInterfaceImplementation'
      docs: [
        'Sets the pool interface implementation for a given token pool in the Token Admin Registry.',
        'Used to configure non-default values on new fields of the Token Admin Registry that refer to',
        "the pool's implemented interface, particularly which version of the pool interface is implemented",
        'and whether it implements account resolution or not.',
      ]
      accounts: [
        { name: 'config'; isMut: false; isSigner: false },
        { name: 'tokenAdminRegistry'; isMut: true; isSigner: false },
        { name: 'authority'; isMut: true; isSigner: true },
        { name: 'eventAuthority'; isMut: false; isSigner: false },
        { name: 'program'; isMut: false; isSigner: false },
      ]
      args: [{ name: 'params'; type: { defined: 'SetPoolInterfaceImplementationParams' } }]
    },
    {
      name: 'upgradeTokenAdminRegistryFromV1'
      docs: [
        'Upgrades the Token Admin Registry from version 1 or 2 to the current version.',
        '',
        'Anyone may invoke this method, as the upgrade has safe defaults for any new value,',
        'and those can then be changed by the Token Admin Registry Admin via separate instructions.',
        '',
        '# Arguments',
        '',
        '* `ctx` - The context containing the accounts required for the upgrade.',
      ]
      accounts: [
        { name: 'config'; isMut: false; isSigner: false },
        {
          name: 'tokenAdminRegistry'
          isMut: true
          isSigner: false
          docs: [
            "types Anchor would attempt to deserialize the data _before_ realloc'ing it, which would fail.",
            'The code will load it and realloc it to the new size manually, and migrate its data.',
          ]
        },
        { name: 'mint'; isMut: false; isSigner: false },
        { name: 'authority'; isMut: true; isSigner: true },
        { name: 'systemProgram'; isMut: false; isSigner: false },
      ]
      args: []
    },
    {
      name: 'multisigOwnerProposeAdministrator'
      docs: [
        'Registers the Token Admin Registry by a signer of the mint authority multisig.',
        '',
        '# Arguments',
        '',
        '* `ctx` - The context containing the accounts required for registration.',
        '* `token_admin_registry_admin` - The public key of the token admin registry admin to propose.',
      ]
      accounts: [
        { name: 'config'; isMut: false; isSigner: false },
        { name: 'tokenAdminRegistry'; isMut: true; isSigner: false },
        { name: 'mint'; isMut: false; isSigner: false },
        { name: 'authority'; isMut: true; isSigner: true },
        {
          name: 'mintAuthorityMultisig'
          isMut: false
          isSigner: false
          docs: ['Only 1-of-N multisigs (threshold `m == 1`) are supported in this flow.']
        },
        { name: 'systemProgram'; isMut: false; isSigner: false },
      ]
      args: [{ name: 'tokenAdminRegistryAdmin'; type: 'publicKey' }]
    },
    {
      name: 'multisigOwnerOverridePendingAdministrator'
      docs: [
        'Overrides the pending admin of the Token Admin Registry by a signer of the mint authority multisig',
        '',
        '# Arguments',
        '',
        '* `ctx` - The context containing the accounts required for registration.',
        '* `token_admin_registry_admin` - The public key of the token admin registry admin to propose.',
      ]
      accounts: [
        { name: 'config'; isMut: false; isSigner: false },
        { name: 'tokenAdminRegistry'; isMut: true; isSigner: false },
        { name: 'mint'; isMut: false; isSigner: false },
        { name: 'authority'; isMut: true; isSigner: true },
        {
          name: 'mintAuthorityMultisig'
          isMut: false
          isSigner: false
          docs: ['Only 1-of-N multisig mint authorities are supported in this flow.']
        },
        { name: 'systemProgram'; isMut: false; isSigner: false },
      ]
      args: [{ name: 'tokenAdminRegistryAdmin'; type: 'publicKey' }]
    },
  ]
  accounts: []
  errors: [
    { code: 7000; name: 'Unauthorized'; msg: 'The signer is unauthorized' },
    { code: 7001; name: 'InvalidRMNRemoteAddress'; msg: 'Invalid RMN Remote Address' },
    { code: 7002; name: 'InvalidInputsMint'; msg: 'Mint account input is invalid' },
    { code: 7003; name: 'InvalidVersion'; msg: 'Invalid version of the onchain state' },
    { code: 7004; name: 'FeeTokenMismatch'; msg: "Fee token doesn't match transfer token" },
    { code: 7005; name: 'RedundantOwnerProposal'; msg: 'Proposed owner is the current owner' },
    { code: 7006; name: 'ReachedMaxMessageNumber'; msg: 'Reached max message number' },
    { code: 7007; name: 'InvalidInputsTokenIndices'; msg: 'Invalid pool account account indices' },
    { code: 7008; name: 'InvalidInputsPoolAccounts'; msg: 'Invalid pool accounts' },
    { code: 7009; name: 'InvalidInputsTokenAccounts'; msg: 'Invalid token accounts' },
    {
      code: 7010
      name: 'InvalidInputsTokenAdminRegistryAccounts'
      msg: 'Invalid Token Admin Registry account'
    },
    { code: 7011; name: 'InvalidInputsLookupTableAccounts'; msg: 'Invalid LookupTable account' },
    {
      code: 7012
      name: 'InvalidInputsLookupTableAccountWritable'
      msg: 'Invalid LookupTable account writable access'
    },
    { code: 7013; name: 'InvalidInputsTokenAmount'; msg: 'Cannot send zero tokens' },
    {
      code: 7014
      name: 'InvalidInputsTransferAllAmount'
      msg: 'Must specify zero amount to send alongside transfer_all'
    },
    {
      code: 7015
      name: 'InvalidInputsAtaAddress'
      msg: 'Invalid Associated Token Account address'
    },
    {
      code: 7016
      name: 'InvalidInputsAtaWritable'
      msg: 'Invalid Associated Token Account writable flag'
    },
    { code: 7017; name: 'InvalidInputsChainSelector'; msg: 'Chain selector is invalid' },
    { code: 7018; name: 'InsufficientLamports'; msg: 'Insufficient lamports' },
    { code: 7019; name: 'InsufficientFunds'; msg: 'Insufficient funds' },
    { code: 7020; name: 'SourceTokenDataTooLarge'; msg: 'Source token data is too large' },
    {
      code: 7021
      name: 'InvalidTokenAdminRegistryInputsZeroAddress'
      msg: 'New Admin can not be zero address'
    },
    {
      code: 7022
      name: 'InvalidTokenAdminRegistryProposedAdmin'
      msg: 'An already owned registry can not be proposed'
    },
    { code: 7023; name: 'SenderNotAllowed'; msg: 'Sender not allowed for that destination chain' },
    { code: 7024; name: 'InvalidCodeVersion'; msg: 'Invalid code version' },
    {
      code: 7025
      name: 'InvalidCcipVersionRollback'
      msg: 'Invalid rollback attempt on the CCIP version of the onramp to the destination chain'
    },
    {
      code: 7026
      name: 'InvalidAccountListForPdaDerivation'
      msg: 'Invalid account list for PDA derivation'
    },
    { code: 7027; name: 'InvalidDerivationStage'; msg: 'Unexpected account derivation stage' },
    { code: 7028; name: 'InvalidNonceVersion'; msg: 'Invalid version of the Nonce account' },
    {
      code: 7029
      name: 'InvalidTokenPoolAccountDerivationResponse'
      msg: 'Token pool returned an unexpected derivation response'
    },
    {
      code: 7030
      name: 'AccountDerivationResponseTooLarge'
      msg: "Can't fit account derivation response."
    },
    { code: 7031; name: 'DefaultOwnerProposal'; msg: 'Proposed owner is the default pubkey' },
    { code: 7032; name: 'InvalidAccountListLengths'; msg: 'Invalid account list lengths' },
    { code: 7033; name: 'InvalidInstructionData'; msg: 'Invalid instruction data' },
    { code: 7034; name: 'InvalidFeeQuoterAddress'; msg: 'Invalid FeeQuoter address' },
    { code: 7035; name: 'InvalidCCVReturnData'; msg: 'Invalid CCV return data' },
    {
      code: 7036
      name: 'InvalidCCVAccountResolutionResponse'
      msg: 'Invalid CCV account resolution response'
    },
    { code: 7037; name: 'MissingCpiReturnData'; msg: 'CPI target did not return data' },
    {
      code: 7038
      name: 'InvalidCpiReturnProgram'
      msg: 'CPI return data came from an unexpected program'
    },
    {
      code: 7039
      name: 'InvalidInputsMultipleTokenTransfers'
      msg: 'Invalid amount of token transfers'
    },
    { code: 7040; name: 'InvalidInputPubkeyBytes'; msg: 'Invalid address bytes in input' },
    {
      code: 7041
      name: 'UnsupportedPoolV1ResolutionOnLaneV2'
      msg: 'V1 pools with account resolution (CCTP/Lombard) are not supported on the v2 lane'
    },
    {
      code: 7042
      name: 'AccountResolutionRequiresV2'
      msg: 'Account resolution requires pool interface version >= 2'
    },
    {
      code: 7043
      name: 'DuplicateCCVInExtraArgs'
      msg: 'Duplicate CCV in user-provided extra args'
    },
    { code: 7044; name: 'InvalidInputsCcvAccounts'; msg: 'Invalid CCV accounts' },
    { code: 7045; name: 'InvalidReceiptData'; msg: 'Invalid receipt data' },
    { code: 7046; name: 'InvalidFinality'; msg: 'Invalid finality value' },
    {
      code: 7047
      name: 'InvalidAccountForMigration'
      msg: 'Account to migrate contains invalid data'
    },
    {
      code: 7048
      name: 'MustSpecifyDefaultOrMandatedCcvs'
      msg: 'Must specify at least one default or lane-mandated CCV'
    },
    {
      code: 7049
      name: 'CcvZeroAddressNotAllowed'
      msg: 'CCV address cannot be the zero/default pubkey'
    },
    {
      code: 7050
      name: 'DuplicateCcvNotAllowed'
      msg: 'Duplicate CCV not allowed in default/lane-mandated lists'
    },
    { code: 7051; name: 'InvalidTokenPrice'; msg: 'Invalid token price' },
    {
      code: 7052
      name: 'MissingOfframpAddress'
      msg: 'Destination chain config contains an empty offramp address'
    },
    {
      code: 7053
      name: 'InvalidInputsAddressBytesLength'
      msg: 'Invalid destination address length'
    },
    { code: 7054; name: 'InvalidReceiverAddress'; msg: 'Invalid destination receiver address' },
    { code: 7055; name: 'InvalidDestTokenAddress'; msg: 'Invalid destination token address' },
    {
      code: 7056
      name: 'InvalidDestTokenReceiverAddress'
      msg: 'Invalid destination token receiver address'
    },
    {
      code: 7057
      name: 'NoExecMode'
      msg: 'Message is configured to opt out of automated execution'
    },
    {
      code: 7058
      name: 'MissingAtaForReceiptIssuer'
      msg: 'Missing associated token account for receipt issuer'
    },
    { code: 7059; name: 'UnsupportedFeeToken'; msg: 'Fee token is unsupported' },
    {
      code: 7060
      name: 'InvalidTokenArithmetic'
      msg: 'Token arithmetic resulted in an invalid value'
    },
    {
      code: 7061
      name: 'FeeExceedsMaxAllowed'
      msg: 'Fee for this message exceeds the maximum allowed'
    },
    {
      code: 7062
      name: 'DuplicateReceiptIssuer'
      msg: 'The same issuer appears in more than one receipt'
    },
    {
      code: 7063
      name: 'FinalityNotSupportedOnPoolV1'
      msg: 'Faster-than-finality is not supported on a v1 token pool'
    },
    {
      code: 7064
      name: 'TokenArgsNotSupportedOnPoolV1'
      msg: 'Token args are not supported on a v1 token pool'
    },
    { code: 7065; name: 'InvalidExecutor'; msg: 'Default executor is invalid' },
    {
      code: 7066
      name: 'TokenReceiverNotAllowed'
      msg: 'Token Receiver not allowed for current destination chain'
    },
    {
      code: 7067
      name: 'TokenOwnedByMultisig'
      msg: 'Token uses a multisig as mint authority - use the multisig-specific method instead'
    },
    {
      code: 7068
      name: 'PoolV2RequiresWithoutExtendedLookupTable'
      msg: 'Pool interface version 2 requires the WithoutExtendedLookupTable account resolution'
    },
  ]
  types: [
    {
      name: 'SetPoolInterfaceImplementationParams'
      type: {
        kind: 'struct'
        fields: [
          { name: 'mint'; type: 'publicKey' },
          { name: 'interfaceVersion'; type: 'u8' },
          { name: 'accountResolution'; type: { defined: 'ResolutionType' } },
        ]
      }
    },
    {
      name: 'ResolutionType'
      type: {
        kind: 'enum'
        variants: [
          { name: 'NoResolution' },
          { name: 'Standard' },
          { name: 'WithoutExtendedLookupTable' },
        ]
      }
    },
  ]
}

export const IDL: CcipRouterTokenAdminRegistryV2 = {
  version: '2.0.1',
  name: 'ccip_router',
  instructions: [
    {
      name: 'setPoolInterfaceImplementation',
      docs: [
        'Sets the pool interface implementation for a given token pool in the Token Admin Registry.',
        'Used to configure non-default values on new fields of the Token Admin Registry that refer to',
        "the pool's implemented interface, particularly which version of the pool interface is implemented",
        'and whether it implements account resolution or not.',
      ],
      accounts: [
        {
          name: 'config',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'tokenAdminRegistry',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'eventAuthority',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'program',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'params',
          type: {
            defined: 'SetPoolInterfaceImplementationParams',
          },
        },
      ],
    },
    {
      name: 'upgradeTokenAdminRegistryFromV1',
      docs: [
        'Upgrades the Token Admin Registry from version 1 or 2 to the current version.',
        '',
        'Anyone may invoke this method, as the upgrade has safe defaults for any new value,',
        'and those can then be changed by the Token Admin Registry Admin via separate instructions.',
        '',
        '# Arguments',
        '',
        '* `ctx` - The context containing the accounts required for the upgrade.',
      ],
      accounts: [
        {
          name: 'config',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'tokenAdminRegistry',
          isMut: true,
          isSigner: false,
          docs: [
            "types Anchor would attempt to deserialize the data _before_ realloc'ing it, which would fail.",
            'The code will load it and realloc it to the new size manually, and migrate its data.',
          ],
        },
        {
          name: 'mint',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'systemProgram',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [],
    },
    {
      name: 'multisigOwnerProposeAdministrator',
      docs: [
        'Registers the Token Admin Registry by a signer of the mint authority multisig.',
        '',
        '# Arguments',
        '',
        '* `ctx` - The context containing the accounts required for registration.',
        '* `token_admin_registry_admin` - The public key of the token admin registry admin to propose.',
      ],
      accounts: [
        {
          name: 'config',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'tokenAdminRegistry',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'mint',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'mintAuthorityMultisig',
          isMut: false,
          isSigner: false,
          docs: ['Only 1-of-N multisigs (threshold `m == 1`) are supported in this flow.'],
        },
        {
          name: 'systemProgram',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'tokenAdminRegistryAdmin',
          type: 'publicKey',
        },
      ],
    },
    {
      name: 'multisigOwnerOverridePendingAdministrator',
      docs: [
        'Overrides the pending admin of the Token Admin Registry by a signer of the mint authority multisig',
        '',
        '# Arguments',
        '',
        '* `ctx` - The context containing the accounts required for registration.',
        '* `token_admin_registry_admin` - The public key of the token admin registry admin to propose.',
      ],
      accounts: [
        {
          name: 'config',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'tokenAdminRegistry',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'mint',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'mintAuthorityMultisig',
          isMut: false,
          isSigner: false,
          docs: ['Only 1-of-N multisig mint authorities are supported in this flow.'],
        },
        {
          name: 'systemProgram',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'tokenAdminRegistryAdmin',
          type: 'publicKey',
        },
      ],
    },
  ],
  accounts: [],
  errors: [
    {
      code: 7000,
      name: 'Unauthorized',
      msg: 'The signer is unauthorized',
    },
    {
      code: 7001,
      name: 'InvalidRMNRemoteAddress',
      msg: 'Invalid RMN Remote Address',
    },
    {
      code: 7002,
      name: 'InvalidInputsMint',
      msg: 'Mint account input is invalid',
    },
    {
      code: 7003,
      name: 'InvalidVersion',
      msg: 'Invalid version of the onchain state',
    },
    {
      code: 7004,
      name: 'FeeTokenMismatch',
      msg: "Fee token doesn't match transfer token",
    },
    {
      code: 7005,
      name: 'RedundantOwnerProposal',
      msg: 'Proposed owner is the current owner',
    },
    {
      code: 7006,
      name: 'ReachedMaxMessageNumber',
      msg: 'Reached max message number',
    },
    {
      code: 7007,
      name: 'InvalidInputsTokenIndices',
      msg: 'Invalid pool account account indices',
    },
    {
      code: 7008,
      name: 'InvalidInputsPoolAccounts',
      msg: 'Invalid pool accounts',
    },
    {
      code: 7009,
      name: 'InvalidInputsTokenAccounts',
      msg: 'Invalid token accounts',
    },
    {
      code: 7010,
      name: 'InvalidInputsTokenAdminRegistryAccounts',
      msg: 'Invalid Token Admin Registry account',
    },
    {
      code: 7011,
      name: 'InvalidInputsLookupTableAccounts',
      msg: 'Invalid LookupTable account',
    },
    {
      code: 7012,
      name: 'InvalidInputsLookupTableAccountWritable',
      msg: 'Invalid LookupTable account writable access',
    },
    {
      code: 7013,
      name: 'InvalidInputsTokenAmount',
      msg: 'Cannot send zero tokens',
    },
    {
      code: 7014,
      name: 'InvalidInputsTransferAllAmount',
      msg: 'Must specify zero amount to send alongside transfer_all',
    },
    {
      code: 7015,
      name: 'InvalidInputsAtaAddress',
      msg: 'Invalid Associated Token Account address',
    },
    {
      code: 7016,
      name: 'InvalidInputsAtaWritable',
      msg: 'Invalid Associated Token Account writable flag',
    },
    {
      code: 7017,
      name: 'InvalidInputsChainSelector',
      msg: 'Chain selector is invalid',
    },
    {
      code: 7018,
      name: 'InsufficientLamports',
      msg: 'Insufficient lamports',
    },
    {
      code: 7019,
      name: 'InsufficientFunds',
      msg: 'Insufficient funds',
    },
    {
      code: 7020,
      name: 'SourceTokenDataTooLarge',
      msg: 'Source token data is too large',
    },
    {
      code: 7021,
      name: 'InvalidTokenAdminRegistryInputsZeroAddress',
      msg: 'New Admin can not be zero address',
    },
    {
      code: 7022,
      name: 'InvalidTokenAdminRegistryProposedAdmin',
      msg: 'An already owned registry can not be proposed',
    },
    {
      code: 7023,
      name: 'SenderNotAllowed',
      msg: 'Sender not allowed for that destination chain',
    },
    {
      code: 7024,
      name: 'InvalidCodeVersion',
      msg: 'Invalid code version',
    },
    {
      code: 7025,
      name: 'InvalidCcipVersionRollback',
      msg: 'Invalid rollback attempt on the CCIP version of the onramp to the destination chain',
    },
    {
      code: 7026,
      name: 'InvalidAccountListForPdaDerivation',
      msg: 'Invalid account list for PDA derivation',
    },
    {
      code: 7027,
      name: 'InvalidDerivationStage',
      msg: 'Unexpected account derivation stage',
    },
    {
      code: 7028,
      name: 'InvalidNonceVersion',
      msg: 'Invalid version of the Nonce account',
    },
    {
      code: 7029,
      name: 'InvalidTokenPoolAccountDerivationResponse',
      msg: 'Token pool returned an unexpected derivation response',
    },
    {
      code: 7030,
      name: 'AccountDerivationResponseTooLarge',
      msg: "Can't fit account derivation response.",
    },
    {
      code: 7031,
      name: 'DefaultOwnerProposal',
      msg: 'Proposed owner is the default pubkey',
    },
    {
      code: 7032,
      name: 'InvalidAccountListLengths',
      msg: 'Invalid account list lengths',
    },
    {
      code: 7033,
      name: 'InvalidInstructionData',
      msg: 'Invalid instruction data',
    },
    {
      code: 7034,
      name: 'InvalidFeeQuoterAddress',
      msg: 'Invalid FeeQuoter address',
    },
    {
      code: 7035,
      name: 'InvalidCCVReturnData',
      msg: 'Invalid CCV return data',
    },
    {
      code: 7036,
      name: 'InvalidCCVAccountResolutionResponse',
      msg: 'Invalid CCV account resolution response',
    },
    {
      code: 7037,
      name: 'MissingCpiReturnData',
      msg: 'CPI target did not return data',
    },
    {
      code: 7038,
      name: 'InvalidCpiReturnProgram',
      msg: 'CPI return data came from an unexpected program',
    },
    {
      code: 7039,
      name: 'InvalidInputsMultipleTokenTransfers',
      msg: 'Invalid amount of token transfers',
    },
    {
      code: 7040,
      name: 'InvalidInputPubkeyBytes',
      msg: 'Invalid address bytes in input',
    },
    {
      code: 7041,
      name: 'UnsupportedPoolV1ResolutionOnLaneV2',
      msg: 'V1 pools with account resolution (CCTP/Lombard) are not supported on the v2 lane',
    },
    {
      code: 7042,
      name: 'AccountResolutionRequiresV2',
      msg: 'Account resolution requires pool interface version >= 2',
    },
    {
      code: 7043,
      name: 'DuplicateCCVInExtraArgs',
      msg: 'Duplicate CCV in user-provided extra args',
    },
    {
      code: 7044,
      name: 'InvalidInputsCcvAccounts',
      msg: 'Invalid CCV accounts',
    },
    {
      code: 7045,
      name: 'InvalidReceiptData',
      msg: 'Invalid receipt data',
    },
    {
      code: 7046,
      name: 'InvalidFinality',
      msg: 'Invalid finality value',
    },
    {
      code: 7047,
      name: 'InvalidAccountForMigration',
      msg: 'Account to migrate contains invalid data',
    },
    {
      code: 7048,
      name: 'MustSpecifyDefaultOrMandatedCcvs',
      msg: 'Must specify at least one default or lane-mandated CCV',
    },
    {
      code: 7049,
      name: 'CcvZeroAddressNotAllowed',
      msg: 'CCV address cannot be the zero/default pubkey',
    },
    {
      code: 7050,
      name: 'DuplicateCcvNotAllowed',
      msg: 'Duplicate CCV not allowed in default/lane-mandated lists',
    },
    {
      code: 7051,
      name: 'InvalidTokenPrice',
      msg: 'Invalid token price',
    },
    {
      code: 7052,
      name: 'MissingOfframpAddress',
      msg: 'Destination chain config contains an empty offramp address',
    },
    {
      code: 7053,
      name: 'InvalidInputsAddressBytesLength',
      msg: 'Invalid destination address length',
    },
    {
      code: 7054,
      name: 'InvalidReceiverAddress',
      msg: 'Invalid destination receiver address',
    },
    {
      code: 7055,
      name: 'InvalidDestTokenAddress',
      msg: 'Invalid destination token address',
    },
    {
      code: 7056,
      name: 'InvalidDestTokenReceiverAddress',
      msg: 'Invalid destination token receiver address',
    },
    {
      code: 7057,
      name: 'NoExecMode',
      msg: 'Message is configured to opt out of automated execution',
    },
    {
      code: 7058,
      name: 'MissingAtaForReceiptIssuer',
      msg: 'Missing associated token account for receipt issuer',
    },
    {
      code: 7059,
      name: 'UnsupportedFeeToken',
      msg: 'Fee token is unsupported',
    },
    {
      code: 7060,
      name: 'InvalidTokenArithmetic',
      msg: 'Token arithmetic resulted in an invalid value',
    },
    {
      code: 7061,
      name: 'FeeExceedsMaxAllowed',
      msg: 'Fee for this message exceeds the maximum allowed',
    },
    {
      code: 7062,
      name: 'DuplicateReceiptIssuer',
      msg: 'The same issuer appears in more than one receipt',
    },
    {
      code: 7063,
      name: 'FinalityNotSupportedOnPoolV1',
      msg: 'Faster-than-finality is not supported on a v1 token pool',
    },
    {
      code: 7064,
      name: 'TokenArgsNotSupportedOnPoolV1',
      msg: 'Token args are not supported on a v1 token pool',
    },
    {
      code: 7065,
      name: 'InvalidExecutor',
      msg: 'Default executor is invalid',
    },
    {
      code: 7066,
      name: 'TokenReceiverNotAllowed',
      msg: 'Token Receiver not allowed for current destination chain',
    },
    {
      code: 7067,
      name: 'TokenOwnedByMultisig',
      msg: 'Token uses a multisig as mint authority - use the multisig-specific method instead',
    },
    {
      code: 7068,
      name: 'PoolV2RequiresWithoutExtendedLookupTable',
      msg: 'Pool interface version 2 requires the WithoutExtendedLookupTable account resolution',
    },
  ],
  types: [
    {
      name: 'SetPoolInterfaceImplementationParams',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'mint',
            type: 'publicKey',
          },
          {
            name: 'interfaceVersion',
            type: 'u8',
          },
          {
            name: 'accountResolution',
            type: {
              defined: 'ResolutionType',
            },
          },
        ],
      },
    },
    {
      name: 'ResolutionType',
      type: {
        kind: 'enum',
        variants: [
          {
            name: 'NoResolution',
          },
          {
            name: 'Standard',
          },
          {
            name: 'WithoutExtendedLookupTable',
          },
        ],
      },
    },
  ],
}
