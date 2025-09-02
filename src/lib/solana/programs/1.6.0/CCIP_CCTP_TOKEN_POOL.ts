import type { Idl } from '@coral-xyz/anchor'

export const CCIP_CCTP_TOKEN_POOL_IDL = {
  version: '0.1.1',
  name: 'cctp_token_pool',
  instructions: [
    // Add instructions as needed
  ],
  events: [
    {
      name: 'CcipCctpMessageSentEvent',
      fields: [
        {
          name: 'originalSender',
          type: 'publicKey',
          index: false,
        },
        {
          name: 'remoteChainSelector',
          type: 'u64',
          index: false,
        },
        {
          name: 'msgTotalNonce',
          type: 'u64',
          index: false,
        },
        {
          name: 'eventAddress',
          type: 'publicKey',
          index: false,
        },
        {
          name: 'sourceDomain',
          type: 'u32',
          index: false,
        },
        {
          name: 'cctpNonce',
          type: 'u64',
          index: false,
        },
        {
          name: 'messageSentBytes',
          type: 'bytes',
          index: false,
        },
      ],
    },
  ],
  types: [
    {
      name: 'CctpMessage',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'data',
            type: 'bytes',
          },
        ],
      },
    },
    {
      name: 'MessageAndAttestation',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'message',
            type: {
              defined: 'CctpMessage',
            },
          },
          {
            name: 'attestation',
            type: 'bytes',
          },
        ],
      },
    },
  ],
} as const satisfies Idl
