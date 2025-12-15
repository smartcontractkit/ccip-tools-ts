import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

/**
 * CLI Documentation Sidebar
 * Organized by introduction, configuration, workflows, and commands
 */
const sidebars: SidebarsConfig = {
  cliSidebar: [
    {
      type: 'doc',
      id: 'cli-intro',
      label: 'Introduction',
    },
    {
      type: 'doc',
      id: 'configuration',
      label: 'Configuration',
    },
    {
      type: 'category',
      label: 'Workflows',
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'guides/token-transfer-workflow',
          label: 'Token Transfer',
        },
        {
          type: 'doc',
          id: 'guides/data-transfer-workflow',
          label: 'Transfer Data',
        },
        {
          type: 'doc',
          id: 'guides/tokens-and-data-workflow',
          label: 'Transfer Tokens and Data',
        },
        {
          type: 'doc',
          id: 'guides/debugging-workflow',
          label: 'Debugging Failed Messages',
        },
      ],
    },
    {
      type: 'category',
      label: 'Commands',
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'show',
          label: 'show',
        },
        {
          type: 'doc',
          id: 'send',
          label: 'send',
        },
        {
          type: 'doc',
          id: 'manual-exec',
          label: 'manualExec',
        },
        {
          type: 'doc',
          id: 'parse',
          label: 'parse',
        },
        {
          type: 'doc',
          id: 'supported-tokens',
          label: 'getSupportedTokens',
        },
        {
          type: 'doc',
          id: 'lane-latency',
          label: 'laneLatency',
        },
        {
          type: 'doc',
          id: 'token',
          label: 'token',
        },
      ],
    },
    {
      type: 'doc',
      id: 'troubleshooting',
      label: 'Troubleshooting',
    },
  ],
}

export default sidebars
