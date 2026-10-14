/**
 * Minimal CCIP v2 (`ccip-offramp 2.0.0-dev`) IDL.
 *
 * Only the pieces the SDK needs beyond the 1.6.0 offramp IDL: the `SourceChain`,
 * `ReferenceAddresses` (whose layouts changed in v2) and execution inputs `Buffer` accounts, the
 * `ExecutionStateChangedV2` event, and the argument types of the `get_ccvs_for_msg`, `execute_v2`
 * and execution inputs buffering instructions. Those instructions are encoded by hand, as their
 * accounts come from account resolution (see `resolution.ts`) or are fixed PDAs (see `exec-v2.ts`).
 *
 * v2 `SourceChain` dropped the `state` field (`minSeqNr`) and reshaped `SourceChainConfig`
 * (replaced the single `on_ramp` with `on_ramps` Vec and added the CCV vecs). v2
 * `ReferenceAddresses` added a `bump` field between `version` and `router`. Anchor 0.29
 * IDL format.
 */
export type CcipOfframpV2 = {
  version: '2.0.0'
  name: 'ccip_offramp'
  instructions: []
  accounts: [
    {
      name: 'sourceChain'
      type: {
        kind: 'struct'
        fields: [
          { name: 'version'; type: 'u8' },
          { name: 'bump'; type: 'u8' },
          { name: 'chainSelector'; type: 'u64' },
          { name: 'config'; type: { defined: 'SourceChainConfig' } },
        ]
      }
    },
    {
      name: 'referenceAddresses'
      type: {
        kind: 'struct'
        fields: [
          { name: 'version'; type: 'u8' },
          { name: 'bump'; type: 'u8' },
          { name: 'router'; type: 'publicKey' },
          { name: 'feeQuoter'; type: 'publicKey' },
          { name: 'offrampLookupTable'; type: 'publicKey' },
          { name: 'rmnRemote'; type: 'publicKey' },
        ]
      }
    },
    {
      name: 'buffer'
      type: {
        kind: 'struct'
        fields: [
          { name: 'version'; type: 'u8' },
          { name: 'bump'; type: 'u8' },
          { name: 'bufferId'; type: { array: ['u8', 32] } },
          { name: 'authority'; type: 'publicKey' },
          { name: 'chunkBitmap'; type: 'u64' },
          { name: 'numChunks'; type: 'u8' },
          { name: 'chunkLength'; type: 'u32' },
          { name: 'data'; type: 'bytes' },
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
          { name: 'onRamps'; type: { vec: { defined: 'OnRampAddress' } } },
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
          // Length of the message's `data` field, and the callback gas it requests. Together with
          // `message_receiver` these decide whether the receiver is consulted at all.
          { name: 'dataLen'; type: 'u32' },
          { name: 'ccipReceiveGasLimit'; type: 'u32' },
          { name: 'sender'; type: 'bytes' },
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
      name: 'ExecutionInputsV2'
      type: {
        kind: 'struct'
        fields: [
          { name: 'encodedMessage'; type: 'bytes' },
          { name: 'ccvs'; type: { vec: 'publicKey' } },
          { name: 'verifierResults'; type: { vec: 'bytes' } },
        ]
      }
    },
    {
      name: 'ExecuteParams'
      type: {
        kind: 'struct'
        fields: [
          { name: 'execInputs'; type: { option: { defined: 'ExecutionInputsV2' } } },
          { name: 'resolutionMetadata'; type: 'bytes' },
        ]
      }
    },
    {
      name: 'BufferExecutionInputsParams'
      type: {
        kind: 'struct'
        fields: [
          { name: 'bufferId'; type: { array: ['u8', 32] } },
          { name: 'totalLength'; type: 'u32' },
          { name: 'chunk'; type: 'bytes' },
          { name: 'chunkIndex'; type: 'u8' },
          { name: 'numChunks'; type: 'u8' },
        ]
      }
    },
    {
      name: 'CloseExecutionInputsBufferParams'
      type: {
        kind: 'struct'
        fields: [{ name: 'bufferId'; type: { array: ['u8', 32] } }]
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
  instructions: [],
  accounts: [
    {
      name: 'sourceChain',
      type: {
        kind: 'struct',
        fields: [
          { name: 'version', type: 'u8' },
          { name: 'bump', type: 'u8' },
          { name: 'chainSelector', type: 'u64' },
          { name: 'config', type: { defined: 'SourceChainConfig' } },
        ],
      },
    },
    {
      name: 'referenceAddresses',
      type: {
        kind: 'struct',
        fields: [
          { name: 'version', type: 'u8' },
          { name: 'bump', type: 'u8' },
          { name: 'router', type: 'publicKey' },
          { name: 'feeQuoter', type: 'publicKey' },
          { name: 'offrampLookupTable', type: 'publicKey' },
          { name: 'rmnRemote', type: 'publicKey' },
        ],
      },
    },
    {
      name: 'buffer',
      type: {
        kind: 'struct',
        fields: [
          { name: 'version', type: 'u8' },
          { name: 'bump', type: 'u8' },
          { name: 'bufferId', type: { array: ['u8', 32] } },
          { name: 'authority', type: 'publicKey' },
          { name: 'chunkBitmap', type: 'u64' },
          { name: 'numChunks', type: 'u8' },
          { name: 'chunkLength', type: 'u32' },
          { name: 'data', type: 'bytes' },
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
          { name: 'onRamps', type: { vec: { defined: 'OnRampAddress' } } },
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
          // Length of the message's `data` field, and the callback gas it requests. Together with
          // `message_receiver` these decide whether the receiver is consulted at all.
          { name: 'dataLen', type: 'u32' },
          { name: 'ccipReceiveGasLimit', type: 'u32' },
          { name: 'sender', type: 'bytes' },
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
      name: 'ExecutionInputsV2',
      type: {
        kind: 'struct',
        fields: [
          { name: 'encodedMessage', type: 'bytes' },
          { name: 'ccvs', type: { vec: 'publicKey' } },
          { name: 'verifierResults', type: { vec: 'bytes' } },
        ],
      },
    },
    {
      name: 'ExecuteParams',
      type: {
        kind: 'struct',
        fields: [
          { name: 'execInputs', type: { option: { defined: 'ExecutionInputsV2' } } },
          { name: 'resolutionMetadata', type: 'bytes' },
        ],
      },
    },
    {
      name: 'BufferExecutionInputsParams',
      type: {
        kind: 'struct',
        fields: [
          { name: 'bufferId', type: { array: ['u8', 32] } },
          { name: 'totalLength', type: 'u32' },
          { name: 'chunk', type: 'bytes' },
          { name: 'chunkIndex', type: 'u8' },
          { name: 'numChunks', type: 'u8' },
        ],
      },
    },
    {
      name: 'CloseExecutionInputsBufferParams',
      type: {
        kind: 'struct',
        fields: [{ name: 'bufferId', type: { array: ['u8', 32] } }],
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
