import type { Idl } from '@coral-xyz/anchor'

/**
 * Minimal CCIP v2 receiver interface IDL (`example-ccip-receiver-v2 2.0.1`).
 *
 * Only the `ccip_receive_v2` entrypoint, which a 2.0 OffRamp calls on receivers registered as v2
 * in the router's `ReceiverRegistry` (v1 receivers keep getting `ccip_receive`, see the 1.6.0
 * `CCIP_RECEIVER` IDL). Its accounts start like v1's: the OffRamp's `external_execution_config`
 * signer PDA, the OffRamp program and the router's `allowed_offramp` PDA, then the receiver's own
 * accounts. Its `Any2SVMMessage` carries at most one token transfer as an `Option`, with where the
 * OffRamp delivered the tokens, so it isn't Borsh-compatible with v1's `tokenAmounts` `Vec`.
 * Anchor 0.29 IDL format.
 */
export const IDL = {
  version: '2.0.1',
  name: 'ccip_receiver_v2',
  instructions: [
    {
      name: 'ccipReceiveV2',
      accounts: [
        { name: 'authority', isMut: false, isSigner: true },
        { name: 'offrampProgram', isMut: false, isSigner: false },
        { name: 'allowedOfframp', isMut: false, isSigner: false },
      ],
      args: [{ name: 'message', type: { defined: 'Any2SVMMessage' } }],
    },
  ],
  types: [
    {
      name: 'Any2SVMMessage',
      type: {
        kind: 'struct',
        fields: [
          { name: 'messageId', type: { array: ['u8', 32] } },
          { name: 'sourceChainSelector', type: 'u64' },
          { name: 'sender', type: 'bytes' },
          { name: 'data', type: 'bytes' },
          { name: 'tokenTransfer', type: { option: { defined: 'TokenTransfer' } } },
        ],
      },
    },
    {
      name: 'TokenTransfer',
      type: {
        kind: 'struct',
        fields: [
          { name: 'tokenAmount', type: { defined: 'SVMTokenAmount' } },
          { name: 'tokenReceiver', type: 'publicKey' },
          { name: 'tokenReceiverUsage', type: { defined: 'SVMTokenReceiverUsage' } },
        ],
      },
    },
    {
      name: 'SVMTokenAmount',
      type: {
        kind: 'struct',
        fields: [
          { name: 'token', type: 'publicKey' },
          { name: 'amount', type: 'u64' },
        ],
      },
    },
    {
      name: 'SVMTokenReceiverUsage',
      type: {
        kind: 'enum',
        variants: [
          { name: 'DeriveAtaAndCreate' },
          { name: 'DeriveAtaDontCreate' },
          { name: 'UseAsIs' },
        ],
      },
    },
  ],
} as const satisfies Idl
