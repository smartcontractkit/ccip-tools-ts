import type { Idl } from '@coral-xyz/anchor'

export const EXECUTION_BUFFER_IDL = {
  version: '0.1.0-dev',
  name: 'execution_buffer',
  instructions: [
    {
      name: 'manuallyExecuteBuffered',
      accounts: [
        {
          name: 'bufferedReport',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'config',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'referenceAddresses',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'sourceChain',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'commitReport',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'offramp',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'allowedOfframp',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'rmnRemote',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'rmnRemoteCurses',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'rmnRemoteConfig',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'sysvarInstructions',
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
      args: [
        {
          name: 'bufferId',
          type: {
            defined: 'BufferId',
          },
        },
        {
          name: 'tokenIndexes',
          type: 'bytes',
        },
      ],
    },
    {
      name: 'appendExecutionReportData',
      accounts: [
        {
          name: 'bufferedReport',
          isMut: true,
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
      args: [
        {
          name: 'bufferId',
          type: {
            defined: 'BufferId',
          },
        },
        {
          name: 'data',
          type: 'bytes',
        },
      ],
    },
    {
      name: 'initializeExecutionReportBuffer',
      accounts: [
        {
          name: 'bufferedReport',
          isMut: true,
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
      args: [
        {
          name: 'bufferId',
          type: {
            defined: 'BufferId',
          },
        },
      ],
    },
    {
      name: 'closeBuffer',
      accounts: [
        {
          name: 'bufferedReport',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
      ],
      args: [
        {
          name: 'bufferId',
          type: {
            defined: 'BufferId',
          },
        },
      ],
    },
  ],
  accounts: [
    {
      name: 'BufferedReport',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'rawReportData',
            type: 'bytes',
          },
        ],
      },
    },
  ],
  types: [
    {
      name: 'BufferId',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'bytes',
            type: {
              array: ['u8', 32],
            },
          },
        ],
      },
    },
  ],
} as const satisfies Idl
