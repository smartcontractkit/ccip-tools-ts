/**
 * Parse Command Schema
 *
 * Defines the schema for the `ccip-cli parse` command.
 */

import { outputOptions } from './common.ts'
import type { CommandSchema } from '../types/index.ts'

export const parseSchema: CommandSchema<'parse'> = {
  name: 'parse',
  description: 'Decode hex-encoded error bytes, revert reasons, or call data from CCIP contracts',
  synopsis: 'ccip-cli parse <data> [options]',

  arguments: [
    {
      name: 'data',
      label: 'Data to Parse',
      type: 'string',
      required: true,
      placeholder: '0xbf16aab6000000000000000000000000...',
      description: 'Data to parse (hex, base64, or chain-specific format)',
    },
  ],

  options: [...outputOptions],

  examples: [
    {
      title: 'Decode an error',
      command:
        'ccip-cli parse 0xbf16aab6000000000000000000000000779877a7b0d9e8603169ddbd7836e478b4624789',
    },
    {
      title: 'JSON output',
      command: 'ccip-cli parse 0xbf16aab6... --format json',
    },
  ],
}
