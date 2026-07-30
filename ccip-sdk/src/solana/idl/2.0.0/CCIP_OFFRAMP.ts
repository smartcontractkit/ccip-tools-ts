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
  instructions: []
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
  ],
}
