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
          id: 'guides/debugging-workflow',
          label: 'Debugging Failed Messages',
        },
        {
          type: 'doc',
          id: 'guides/token-transfer-workflow',
          label: 'Token Transfer',
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
