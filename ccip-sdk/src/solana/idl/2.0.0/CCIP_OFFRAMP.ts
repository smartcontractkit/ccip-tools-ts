/**
 * Minimal CCIP v2 (`ccip-offramp 2.0.0-dev`) IDL.
 *
 * Only the pieces the SDK needs beyond the 1.6.0 offramp IDL: the `SourceChain` account
 * (`source_chain_state` PDA seed) whose layout changed in v2, and the
 * `ExecutionStateChangedV2` event. The `ReferenceAddresses` account is byte-identical
 * to 1.6.0, so it keeps being read via the 1.6.0 IDL in "compatibility mode".
 *
 * v2 `SourceChain` dropped the `state` field (`minSeqNr`) and reshaped `SourceChainConfig`
 * (removed `isRmnVerificationDisabled`/`laneCodeVersion`, added the CCV vecs). Anchor 0.29
 * IDL format.
 */
export type CcipOfframpV2 = {
  version: '2.0.0'
  name: 'ccip_offramp'
  instructions: [
    {
      name: 'getCcvsForMsg'
      docs: [
        'Off-chain helper that predicts the CCV set an executor should supply to `execute_v2`.',
        'Non-authoritative: `execute_v2` recomputes and enforces the real set on-chain.',
      ]
      accounts: [
        { name: 'config'; isMut: false; isSigner: false },
        { name: 'referenceAddresses'; isMut: false; isSigner: false },
        { name: 'sourceChain'; isMut: false; isSigner: false },
      ]
      args: [{ name: 'params'; type: { defined: 'GetCcvsForMsgParams' } }]
      returns: { defined: 'GetCcvsForMsgResponse' }
    },
  ]
  accounts: [
    {
      name: 'sourceChain'
      type: {
        kind: 'struct'
        fields: [
          { name: 'version'; type: 'u8' },
          { name: 'chainSelector'; type: 'u64' },
          { name: 'config'; type: { defined: 'SourceChainConfig' } },
        ]
      }
    },
  ]
  events: [
    {
      name: 'ExecutionStateChangedV2'
      fields: [
        { name: 'sourceChainSelector'; type: 'u64'; index: false },
        { name: 'messageNumber'; type: 'u64'; index: false },
        { name: 'messageId'; type: { array: ['u8', 32] }; index: false },
        { name: 'state'; type: { defined: 'MessageExecutionState' }; index: false },
        { name: 'returnData'; type: 'bytes'; index: false },
      ]
    },
  ]
  types: [
    {
      name: 'ExecutionStateChangedV2'
      type: {
        kind: 'struct'
        fields: [
          { name: 'sourceChainSelector'; type: 'u64' },
          { name: 'messageNumber'; type: 'u64' },
          { name: 'messageId'; type: { array: ['u8', 32] } },
          { name: 'state'; type: { defined: 'MessageExecutionState' } },
          { name: 'returnData'; type: 'bytes' },
        ]
      }
    },
    {
      name: 'MessageExecutionState'
      type: {
        kind: 'enum'
        variants: [
          { name: 'Untouched' },
          { name: 'InProgress' },
          { name: 'Success' },
          { name: 'Failure' },
        ]
      }
    },
    {
      name: 'SourceChainConfig'
      type: {
        kind: 'struct'
        fields: [
          { name: 'isEnabled'; type: 'bool' },
          { name: 'onRamp'; type: { defined: 'OnRampAddress' } },
          { name: 'defaultCcvs'; type: { vec: 'publicKey' } },
          { name: 'laneMandatedCcvs'; type: { vec: 'publicKey' } },
        ]
      }
    },
    {
      name: 'OnRampAddress'
      type: {
        kind: 'struct'
        fields: [{ name: 'bytes'; type: { array: ['u8', 64] } }, { name: 'len'; type: 'u32' }]
      }
    },
    {
      name: 'GetCcvsForMsgParams'
      type: {
        kind: 'struct'
        fields: [
          { name: 'tokenTransfer'; type: { option: { defined: 'TokenTransferV1' } } },
          { name: 'messageReceiver'; type: 'publicKey' },
          { name: 'resolutionMetadata'; type: 'bytes' },
          { name: 'remoteChainSelector'; type: 'u64' },
          { name: 'requestedFinality'; type: { defined: 'FinalityConfig' } },
        ]
      }
    },
    {
      name: 'GetCcvsForMsgResponse'
      type: {
        kind: 'struct'
        fields: [
          { name: 'requiredCcvs'; type: { vec: 'publicKey' } },
          { name: 'optionalCcvs'; type: { vec: 'publicKey' } },
          { name: 'optionalThreshold'; type: 'u8' },
        ]
      }
    },
    {
      name: 'TokenTransferV1'
      type: {
        kind: 'struct'
        fields: [
          { name: 'version'; type: 'u8' },
          { name: 'amount'; type: { defined: 'ProtocolAmount' } },
          { name: 'sourcePoolAddress'; type: 'bytes' },
          { name: 'sourceTokenAddress'; type: 'bytes' },
          { name: 'destTokenAddress'; type: 'bytes' },
          { name: 'tokenReceiver'; type: 'bytes' },
          { name: 'extraData'; type: 'bytes' },
        ]
      }
    },
    {
      name: 'ProtocolAmount'
      type: {
        kind: 'struct'
        fields: [{ name: 'beBytes'; type: { array: ['u8', 32] } }]
      }
    },
    {
      name: 'FinalityConfig'
      type: {
        kind: 'struct'
        fields: [{ name: 'flags'; type: 'u16' }, { name: 'blockDepth'; type: 'u16' }]
      }
    },
  ]
}

export const IDL: CcipOfframpV2 = {
  version: '2.0.0',
  name: 'ccip_offramp',
  instructions: [
    {
      name: 'getCcvsForMsg',
      docs: [
        'Off-chain helper that predicts the CCV set an executor should supply to `execute_v2`.',
        'Non-authoritative: `execute_v2` recomputes and enforces the real set on-chain.',
      ],
      accounts: [
        { name: 'config', isMut: false, isSigner: false },
        { name: 'referenceAddresses', isMut: false, isSigner: false },
        { name: 'sourceChain', isMut: false, isSigner: false },
      ],
      args: [{ name: 'params', type: { defined: 'GetCcvsForMsgParams' } }],
      returns: { defined: 'GetCcvsForMsgResponse' },
    },
  ],
  accounts: [
    {
      name: 'sourceChain',
      type: {
        kind: 'struct',
        fields: [
          { name: 'version', type: 'u8' },
          { name: 'chainSelector', type: 'u64' },
          { name: 'config', type: { defined: 'SourceChainConfig' } },
        ],
      },
    },
  ],
  events: [
    {
      name: 'ExecutionStateChangedV2',
      fields: [
        { name: 'sourceChainSelector', type: 'u64', index: false },
        { name: 'messageNumber', type: 'u64', index: false },
        { name: 'messageId', type: { array: ['u8', 32] }, index: false },
        { name: 'state', type: { defined: 'MessageExecutionState' }, index: false },
        { name: 'returnData', type: 'bytes', index: false },
      ],
    },
  ],
  types: [
    {
      name: 'ExecutionStateChangedV2',
      type: {
        kind: 'struct',
        fields: [
          { name: 'sourceChainSelector', type: 'u64' },
          { name: 'messageNumber', type: 'u64' },
          { name: 'messageId', type: { array: ['u8', 32] } },
          { name: 'state', type: { defined: 'MessageExecutionState' } },
          { name: 'returnData', type: 'bytes' },
        ],
      },
    },
    {
      name: 'MessageExecutionState',
      type: {
        kind: 'enum',
        variants: [
          { name: 'Untouched' },
          { name: 'InProgress' },
          { name: 'Success' },
          { name: 'Failure' },
        ],
      },
    },
    {
      name: 'SourceChainConfig',
      type: {
        kind: 'struct',
        fields: [
          { name: 'isEnabled', type: 'bool' },
          { name: 'onRamp', type: { defined: 'OnRampAddress' } },
          { name: 'defaultCcvs', type: { vec: 'publicKey' } },
          { name: 'laneMandatedCcvs', type: { vec: 'publicKey' } },
        ],
      },
    },
    {
      name: 'OnRampAddress',
      type: {
        kind: 'struct',
        fields: [
          { name: 'bytes', type: { array: ['u8', 64] } },
          { name: 'len', type: 'u32' },
        ],
      },
    },
    {
      name: 'GetCcvsForMsgParams',
      type: {
        kind: 'struct',
        fields: [
          { name: 'tokenTransfer', type: { option: { defined: 'TokenTransferV1' } } },
          { name: 'messageReceiver', type: 'publicKey' },
          { name: 'resolutionMetadata', type: 'bytes' },
          { name: 'remoteChainSelector', type: 'u64' },
          { name: 'requestedFinality', type: { defined: 'FinalityConfig' } },
        ],
      },
    },
    {
      name: 'GetCcvsForMsgResponse',
      type: {
        kind: 'struct',
        fields: [
          { name: 'requiredCcvs', type: { vec: 'publicKey' } },
          { name: 'optionalCcvs', type: { vec: 'publicKey' } },
          { name: 'optionalThreshold', type: 'u8' },
        ],
      },
    },
    {
      name: 'TokenTransferV1',
      type: {
        kind: 'struct',
        fields: [
          { name: 'version', type: 'u8' },
          { name: 'amount', type: { defined: 'ProtocolAmount' } },
          { name: 'sourcePoolAddress', type: 'bytes' },
          { name: 'sourceTokenAddress', type: 'bytes' },
          { name: 'destTokenAddress', type: 'bytes' },
          { name: 'tokenReceiver', type: 'bytes' },
          { name: 'extraData', type: 'bytes' },
        ],
      },
    },
    {
      name: 'ProtocolAmount',
      type: {
        kind: 'struct',
        fields: [{ name: 'beBytes', type: { array: ['u8', 32] } }],
      },
    },
    {
      name: 'FinalityConfig',
      type: {
        kind: 'struct',
        fields: [
          { name: 'flags', type: 'u16' },
          { name: 'blockDepth', type: 'u16' },
        ],
      },
    },
  ],
}
