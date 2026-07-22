/**
 * Minimal CCIP v2 (`ccip-router 2.0.0-dev`) IDL.
 *
 * We deliberately keep this tiny and only describe what the SDK needs beyond the
 * v1.6 IDL: the `DestChainCcipV2` account (stored under the `dest_chain_state_v2`
 * PDA seed) plus the types it references. Everything else about the v2 router is
 * handled in "compatibility mode" via the existing 1.6.0 IDL — the `Config`
 * account, for instance, is byte-compatible (v2 only appends a trailing field).
 *
 * Anchor 0.29 IDL format. `UsdCents`/`CrossChainGas` are `u32` newtypes in the
 * upstream v2 IDL, inlined here as `u32` (identical borsh layout).
 *
 * NOTE: the upstream v2 IDL also has a trailing `baseExecutionGasCost` (CrossChainGas)
 * field on `DestChainConfigCcipV2`, but the currently-deployed devnet `-dev` accounts
 * don't carry it. We stop at `tokenTransferNetworkFee` so decoding matches on-chain
 * data — borsh ignores trailing bytes, so this stays forward-compatible if/when the
 * deployed accounts grow the extra field.
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
  types: [
    {
      name: 'DestChainState'
      type: {
        kind: 'struct'
        fields: [
          { name: 'sequenceNumber'; type: 'u64' },
          { name: 'sequenceNumberToRestore'; type: 'u64' },
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
          { name: 'allowedSenders'; type: { vec: 'publicKey' } },
          { name: 'allowListEnabled'; type: 'bool' },
          { name: 'defaultCcvs'; type: { vec: 'publicKey' } },
          { name: 'laneMandatedCcvs'; type: { vec: 'publicKey' } },
          { name: 'defaultExecutor'; type: 'publicKey' },
          { name: 'offramp'; type: 'bytes' },
          { name: 'messageNetworkFee'; type: 'u32' },
          { name: 'tokenTransferNetworkFee'; type: 'u32' },
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
  types: [
    {
      name: 'DestChainState',
      type: {
        kind: 'struct',
        fields: [
          { name: 'sequenceNumber', type: 'u64' },
          { name: 'sequenceNumberToRestore', type: 'u64' },
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
          { name: 'allowedSenders', type: { vec: 'publicKey' } },
          { name: 'allowListEnabled', type: 'bool' },
          { name: 'defaultCcvs', type: { vec: 'publicKey' } },
          { name: 'laneMandatedCcvs', type: { vec: 'publicKey' } },
          { name: 'defaultExecutor', type: 'publicKey' },
          { name: 'offramp', type: 'bytes' },
          { name: 'messageNetworkFee', type: 'u32' },
          { name: 'tokenTransferNetworkFee', type: 'u32' },
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
