import type { Idl } from '@coral-xyz/anchor'

export const IDL = {
  version: '0.1.0',
  name: 'ccip_receiver',
  instructions: [
    {
      name: 'ccipReceive',
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
          { name: 'tokenAmounts', type: { vec: { defined: 'SVMTokenAmount' } } },
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
  ],
} as const satisfies Idl
