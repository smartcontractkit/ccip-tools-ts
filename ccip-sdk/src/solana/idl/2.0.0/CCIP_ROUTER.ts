/**
 * Minimal CCIP v2 (`ccip-router 2.0.0-dev`) IDL.
 *
 * We deliberately keep this tiny and only describe what the SDK needs beyond the
 * v1.6 IDL: the `DestChainCcipV2` account (stored under the `dest_chain_state_v2`
 * PDA seed), the `CCIPMessageSentV2` event, plus the types they reference.
 * Everything else about the v2 router is handled in "compatibility mode" via the
 * existing 1.6.0 IDL — the `Config` account, for instance, is byte-compatible
 * (v2 only appends a trailing field).
 *
 * Anchor 0.29 IDL format. `UsdCents`/`CrossChainGas` are `u32` newtypes in the
 * upstream v2 IDL, inlined here as `u32` (identical borsh layout).
 *
 * As of the latest devnet redeploy, `DestChainConfigCcipV2` carries the full upstream
 * layout: `addressBytesLength` and `tokenReceiverAllowed` (after `laneCodeVersion`),
 * then the trailing `baseExecutionGasCost` (CrossChainGas) + `maxFeePerMessage`
 * (UsdCents) fields. Borsh does NOT skip trailing bytes on a too-short layout (it
 * errors on offset overflow), so the IDL must match the on-chain account exactly.
 * (Missing fields shift every subsequent offset — e.g. a missing `tokenReceiverAllowed`
 * makes anchor's borsh decoder read a garbage vec length and fail with ERR_OUT_OF_RANGE.)
 */
export type CcipRouterV2 = {
  version: '2.0.0'
  name: 'ccip_router'
  instructions: []
  accounts: [
    {
      name: 'destChainCcipV2'
      type: {
        kind: 'struct'
        fields: [
          { name: 'bump'; type: 'u8' },
          { name: 'version'; type: 'u8' },
          { name: 'chainSelector'; type: 'u64' },
          { name: 'state'; type: { defined: 'DestChainState' } },
          { name: 'config'; type: { defined: 'DestChainConfigCcipV2' } },
        ]
      }
    },
    {
      // Marker account: existence declares an OffRamp allowed for a (sourceChainSelector, offRamp)
      // pair. No data beyond the discriminator — the pair lives in the PDA seeds
      // `[allowed_offramp, sourceChainSelector.to_le_bytes(), offRamp]`.
      name: 'allowedOfframp'
      type: { kind: 'struct'; fields: [] }
    },
  ]
  events: [
    {
      name: 'CCIPMessageSentV2'
      fields: [
        { name: 'destChainSelector'; type: 'u64'; index: false },
        { name: 'sender'; type: 'publicKey'; index: false },
        { name: 'messageId'; type: { array: ['u8', 32] }; index: false },
        { name: 'feeToken'; type: 'publicKey'; index: false },
        {
          name: 'tokenAmountBeforeTokenPoolFees'
          type: { defined: 'ProtocolAmount' }
          index: false
        },
        { name: 'encodedMessage'; type: 'bytes'; index: false },
        { name: 'receipts'; type: { vec: { defined: 'Receipt' } }; index: false },
        { name: 'verifierBlobs'; type: { vec: 'bytes' }; index: false },
      ]
    },
  ]
  types: [
    {
      name: 'CCIPMessageSentV2'
      docs: ['CCIP 2.0 CCIPMessageSent event with receipts and verifier blobs.']
      type: {
        kind: 'struct'
        fields: [
          { name: 'destChainSelector'; type: 'u64' },
          { name: 'sender'; type: 'publicKey' },
          { name: 'messageId'; type: { array: ['u8', 32] } },
          { name: 'feeToken'; type: 'publicKey' },
          { name: 'tokenAmountBeforeTokenPoolFees'; type: { defined: 'ProtocolAmount' } },
          { name: 'encodedMessage'; type: 'bytes' },
          { name: 'receipts'; type: { vec: { defined: 'Receipt' } } },
          { name: 'verifierBlobs'; type: { vec: 'bytes' } },
        ]
      }
    },
    {
      name: 'ProtocolAmount'
      docs: ['CCIP 2.0 compatible cross-chain amount representation (u256 in big-endian bytes).']
      type: {
        kind: 'struct'
        fields: [{ name: 'beBytes'; type: { array: ['u8', 32] } }]
      }
    },
    {
      name: 'Receipt'
      docs: [
        'CCIP 2.0 fee/gas receipt for a single entity (verifier, token pool, executor, network).',
      ]
      type: {
        kind: 'struct'
        fields: [
          { name: 'issuer'; type: 'publicKey' },
          { name: 'destGasLimit'; type: 'u32' },
          { name: 'destBytesOverhead'; type: 'u32' },
          { name: 'feeTokenAmount'; type: 'u64' },
          { name: 'extraArgs'; type: 'bytes' },
        ]
      }
    },
    {
      name: 'DestChainState'
      type: {
        kind: 'struct'
        fields: [
          { name: 'messageNumber'; type: 'u64' },
          { name: 'messageNumberToRestore'; type: 'u64' },
          { name: 'restoreOnAction'; type: { defined: 'RestoreOnAction' } },
        ]
      }
    },
    {
      name: 'DestChainConfigCcipV2'
      type: {
        kind: 'struct'
        fields: [
          { name: 'laneCodeVersion'; type: { defined: 'CodeVersion' } },
          { name: 'addressBytesLength'; type: 'u8' },
          { name: 'tokenReceiverAllowed'; type: 'bool' },
          { name: 'allowedSenders'; type: { vec: 'publicKey' } },
          { name: 'allowListEnabled'; type: 'bool' },
          { name: 'defaultCcvs'; type: { vec: 'publicKey' } },
          { name: 'laneMandatedCcvs'; type: { vec: 'publicKey' } },
          { name: 'defaultExecutor'; type: 'publicKey' },
          { name: 'offramp'; type: 'bytes' },
          { name: 'messageNetworkFee'; type: 'u32' },
          { name: 'tokenTransferNetworkFee'; type: 'u32' },
          { name: 'baseExecutionGasCost'; type: 'u32' },
          { name: 'maxFeePerMessage'; type: 'u32' },
        ]
      }
    },
    {
      name: 'CodeVersion'
      type: { kind: 'enum'; variants: [{ name: 'Default' }, { name: 'V1' }] }
    },
    {
      name: 'RestoreOnAction'
      type: {
        kind: 'enum'
        variants: [{ name: 'None' }, { name: 'Upgrade' }, { name: 'Rollback' }]
      }
    },
  ]
}

export const IDL: CcipRouterV2 = {
  version: '2.0.0',
  name: 'ccip_router',
  instructions: [],
  accounts: [
    {
      name: 'destChainCcipV2',
      type: {
        kind: 'struct',
        fields: [
          { name: 'bump', type: 'u8' },
          { name: 'version', type: 'u8' },
          { name: 'chainSelector', type: 'u64' },
          { name: 'state', type: { defined: 'DestChainState' } },
          { name: 'config', type: { defined: 'DestChainConfigCcipV2' } },
        ],
      },
    },
    {
      name: 'allowedOfframp',
      type: { kind: 'struct', fields: [] },
    },
  ],
  events: [
    {
      name: 'CCIPMessageSentV2',
      fields: [
        { name: 'destChainSelector', type: 'u64', index: false },
        { name: 'sender', type: 'publicKey', index: false },
        { name: 'messageId', type: { array: ['u8', 32] }, index: false },
        { name: 'feeToken', type: 'publicKey', index: false },
        {
          name: 'tokenAmountBeforeTokenPoolFees',
          type: { defined: 'ProtocolAmount' },
          index: false,
        },
        { name: 'encodedMessage', type: 'bytes', index: false },
        { name: 'receipts', type: { vec: { defined: 'Receipt' } }, index: false },
        { name: 'verifierBlobs', type: { vec: 'bytes' }, index: false },
      ],
    },
  ],
  types: [
    {
      name: 'CCIPMessageSentV2',
      docs: ['CCIP 2.0 CCIPMessageSent event with receipts and verifier blobs.'],
      type: {
        kind: 'struct',
        fields: [
          { name: 'destChainSelector', type: 'u64' },
          { name: 'sender', type: 'publicKey' },
          { name: 'messageId', type: { array: ['u8', 32] } },
          { name: 'feeToken', type: 'publicKey' },
          { name: 'tokenAmountBeforeTokenPoolFees', type: { defined: 'ProtocolAmount' } },
          { name: 'encodedMessage', type: 'bytes' },
          { name: 'receipts', type: { vec: { defined: 'Receipt' } } },
          { name: 'verifierBlobs', type: { vec: 'bytes' } },
        ],
      },
    },
    {
      name: 'ProtocolAmount',
      docs: ['CCIP 2.0 compatible cross-chain amount representation (u256 in big-endian bytes).'],
      type: {
        kind: 'struct',
        fields: [{ name: 'beBytes', type: { array: ['u8', 32] } }],
      },
    },
    {
      name: 'Receipt',
      docs: [
        'CCIP 2.0 fee/gas receipt for a single entity (verifier, token pool, executor, network).',
      ],
      type: {
        kind: 'struct',
        fields: [
          { name: 'issuer', type: 'publicKey' },
          { name: 'destGasLimit', type: 'u32' },
          { name: 'destBytesOverhead', type: 'u32' },
          { name: 'feeTokenAmount', type: 'u64' },
          { name: 'extraArgs', type: 'bytes' },
        ],
      },
    },
    {
      name: 'DestChainState',
      type: {
        kind: 'struct',
        fields: [
          { name: 'messageNumber', type: 'u64' },
          { name: 'messageNumberToRestore', type: 'u64' },
          { name: 'restoreOnAction', type: { defined: 'RestoreOnAction' } },
        ],
      },
    },
    {
      name: 'DestChainConfigCcipV2',
      type: {
        kind: 'struct',
        fields: [
          { name: 'laneCodeVersion', type: { defined: 'CodeVersion' } },
          { name: 'addressBytesLength', type: 'u8' },
          { name: 'tokenReceiverAllowed', type: 'bool' },
          { name: 'allowedSenders', type: { vec: 'publicKey' } },
          { name: 'allowListEnabled', type: 'bool' },
          { name: 'defaultCcvs', type: { vec: 'publicKey' } },
          { name: 'laneMandatedCcvs', type: { vec: 'publicKey' } },
          { name: 'defaultExecutor', type: 'publicKey' },
          { name: 'offramp', type: 'bytes' },
          { name: 'messageNetworkFee', type: 'u32' },
          { name: 'tokenTransferNetworkFee', type: 'u32' },
          { name: 'baseExecutionGasCost', type: 'u32' },
          { name: 'maxFeePerMessage', type: 'u32' },
        ],
      },
    },
    {
      name: 'CodeVersion',
      type: { kind: 'enum', variants: [{ name: 'Default' }, { name: 'V1' }] },
    },
    {
      name: 'RestoreOnAction',
      type: {
        kind: 'enum',
        variants: [{ name: 'None' }, { name: 'Upgrade' }, { name: 'Rollback' }],
      },
    },
  ],
}
