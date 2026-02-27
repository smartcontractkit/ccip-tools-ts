import type * as Preset from '@docusaurus/preset-classic'
import type { Config } from '@docusaurus/types'
import type * as OpenApiPlugin from 'docusaurus-plugin-openapi-docs'
import { themes as prismThemes } from 'prism-react-renderer'

import cliPackageJson from '../ccip-cli/package.json'
import sdkPackageJson from '../ccip-sdk/package.json'

// Type-safe package.json imports
interface PackageJson {
  version: string
  name: string
}

const cliPackage: PackageJson = cliPackageJson as PackageJson
const sdkPackage: PackageJson = sdkPackageJson as PackageJson

const config: Config = {
  title: 'CCIP Tools Reference',
  tagline: 'API, SDK, CLI for Chainlink Cross-Chain Interoperability Protocol',

  url: 'https://docs.chain.link',
  baseUrl: '/ccip/tools/',

  organizationName: 'smartcontractkit',
  projectName: 'ccip-tools-ts',

  onBrokenLinks: 'warn',

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  // Expose package versions for use in MDX components
  customFields: {
    sdkVersion: sdkPackage.version,
    cliVersion: cliPackage.version,
  },

  plugins: [
    // Google Tag Manager - uses official Docusaurus plugin (auto-disables in dev mode)
    ['@docusaurus/plugin-google-tag-manager', { containerId: 'GTM-N6DQ47T' }],
    // JSON-LD Structured Data Plugin
    [
      './plugins/docusaurus-plugin-jsonld',
      {
        organization: {
          name: 'Chainlink',
          url: 'https://chain.link',
          logo: 'https://docs.chain.link/assets/icons/chainlink-logo.svg',
        },
        defaults: {
          applicationCategory: 'DeveloperApplication',
          operatingSystem: 'Cross-platform (Node.js 20+)',
          programmingLanguage: 'TypeScript',
        },
        routeSchemas: {
          '/cli': 'cli',
          '/api': 'api',
          '/sdk': 'sdk',
        },
      },
    ],
    // CLI docs - independent versioning
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'cli',
        path: 'docs-cli',
        routeBasePath: 'cli',
        sidebarPath: './sidebars-cli.ts',
        editUrl: 'https://github.com/smartcontractkit/ccip-tools-ts/tree/main/ccip-api-ref/',
        versions: {
          current: {
            label: cliPackage.version,
            badge: true,
          },
        },
      },
    ],
    // SDK docs - independent versioning (TypeDoc generates content)
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'sdk',
        path: 'docs-sdk',
        routeBasePath: 'sdk',
        sidebarPath: './sidebars-sdk.ts',
        editUrl: 'https://github.com/smartcontractkit/ccip-tools-ts/tree/main/ccip-api-ref/',
        versions: {
          current: {
            label: sdkPackage.version,
            badge: true,
          },
        },
      },
    ],
    // API docs - independent versioning (OpenAPI generates content)
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'api',
        path: 'docs-api',
        routeBasePath: 'api',
        sidebarPath: './sidebars-api.ts',
        docItemComponent: '@theme/ApiItem',
        versions: {
          current: {
            label: 'v2',
            badge: true,
          },
        },
      },
    ],
    // TypeDoc plugin - generates SDK API docs
    [
      'docusaurus-plugin-typedoc',
      {
        id: 'typedoc-sdk',
        entryPoints: ['../ccip-sdk/src/index.ts'],
        tsconfig: '../ccip-sdk/tsconfig.json',
        out: 'docs-sdk',
        // Use api-reference.md instead of index.md so introduction.mdx can be the root route
        entryFileName: 'api-reference.md',
        sidebar: {
          autoConfiguration: false,
        },
        excludePrivate: true,
        excludeInternal: true,
        excludeExternals: true,
        readme: 'none',
        // Preserve manual files like introduction.mdx when regenerating
        cleanOutputDir: false,

        // Visual improvements
        expandObjects: true,
        expandParameters: true,

        // Table formatting (better than markdown lists)
        parametersFormat: 'table',

        // Consistency and cleanup
        sanitizeComments: true,
      },
    ],
    // OpenAPI plugin - generates CCIP API docs from OpenAPI spec
    [
      'docusaurus-plugin-openapi-docs',
      {
        id: 'openapi',
        docsPluginId: 'api',
        config: {
          ccipApi: {
            specPath: 'https://api.ccip.chain.link/api-docs.json',
            outputDir: 'docs-api',
            downloadUrl: 'https://api.ccip.chain.link/api-docs.json',
            showSchemas: true,
            sidebarOptions: {
              groupPathsBy: 'tag',
            },
            version: 'v2',
            label: 'v2',
            baseUrl: '/api',
          } satisfies OpenApiPlugin.Options,
          ccipApiV1: {
            specPath: 'https://api.ccip.chain.link/v1/api-docs.json',
            outputDir: 'docs-api/v1',
            downloadUrl: 'https://api.ccip.chain.link/v1/api-docs.json',
            showSchemas: true,
            sidebarOptions: {
              groupPathsBy: 'tag',
            },
            version: 'v1',
            label: 'v1 (Deprecated)',
            baseUrl: '/api/v1',
          } satisfies OpenApiPlugin.Options,
        },
      },
    ],
  ],

  themes: [
    '@docusaurus/theme-mermaid',
    'docusaurus-theme-openapi-docs',
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        language: ['en'],
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
        docsRouteBasePath: ['api', 'sdk', 'cli', 'docs'],
        docsDir: ['docs-api', 'docs-sdk', 'docs-cli', 'docs'],
        indexBlog: false,
        searchBarShortcutHint: true,
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        // Minimal docs preset required for search plugin compatibility
        docs: {
          path: 'docs',
          routeBasePath: 'docs',
          sidebarPath: './sidebars.ts',
        },
        blog: false,
        // Disable debug plugin to prevent build errors
        debug: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // SEO Metadata - Open Graph, Twitter Cards, and general meta tags
    metadata: [
      // Open Graph
      { property: 'og:site_name', content: 'CCIP Tools' },
      {
        property: 'og:image',
        content: 'https://docs.chain.link/ccip/tools/img/og-ccip-tools.png',
      },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:type', content: 'image/png' },
      {
        property: 'og:image:alt',
        content: 'CCIP Tools - SDK and CLI for Chainlink Cross-Chain Interoperability Protocol',
      },
      // Twitter Cards
      { name: 'twitter:site', content: '@chainlink' },
      { name: 'twitter:creator', content: '@chainlink' },
      {
        name: 'twitter:image',
        content: 'https://docs.chain.link/ccip/tools/img/og-ccip-tools.png',
      },
      {
        name: 'twitter:image:alt',
        content: 'CCIP Tools - SDK and CLI for Chainlink Cross-Chain Interoperability Protocol',
      },
      // General SEO
      { name: 'author', content: 'Chainlink' },
      {
        name: 'robots',
        content: 'index, follow, max-snippet:-1, max-image-preview:large',
      },
    ],
    // Table of contents configuration
    tableOfContents: {
      minHeadingLevel: 2,
      maxHeadingLevel: 4,
    },
    navbar: {
      title: '',
      logo: {
        alt: 'Chainlink',
        src: 'assets/icons/chainlink-logo.svg',
        href: 'https://docs.chain.link/ccip',
        target: '_blank',
      },
      items: [
        // Site title - links to local home (separate from logo which links to parent docs)
        {
          type: 'html',
          position: 'left',
          value: '<a href="/ccip/tools/" class="navbar__brand navbar__title">CCIP Tools</a>',
        },
        // Left side - Documentation sections (API → SDK → CLI order)
        {
          type: 'dropdown',
          label: 'API',
          position: 'left',
          items: [
            {
              to: '/api/',
              label: 'v2 (Current)',
              activeBaseRegex: '^/api/(?!v1/)',
            },
            {
              to: '/api/v1/',
              label: 'v1 (Deprecated)',
              activeBaseRegex: '^/api/v1/',
            },
          ],
        },
        {
          to: '/sdk/',
          label: 'SDK',
          position: 'left',
          activeBaseRegex: '/sdk/',
        },
        {
          to: '/cli/',
          label: 'CLI',
          position: 'left',
          activeBaseRegex: '/cli/',
        },
        {
          to: '/chains',
          label: 'Chains',
          position: 'left',
          activeBaseRegex: '/chains',
        },
        {
          href: 'https://github.com/smartcontractkit/ccip-tools-ts/releases',
          label: 'Changelog',
          position: 'left',
        },
        // Right side - Social links with icons
        {
          href: 'https://discord.gg/chainlink',
          position: 'right',
          className: 'header-discord-link',
          'aria-label': 'Discord community',
        },
        {
          href: 'https://github.com/smartcontractkit/ccip-tools-ts',
          position: 'right',
          className: 'header-github-link',
          'aria-label': 'GitHub repository',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            {
              label: 'CCIP API',
              to: '/api/',
            },
            {
              label: 'SDK Reference',
              to: '/sdk/',
            },
            {
              label: 'CLI Reference',
              to: '/cli/',
            },
            {
              label: 'Supported Chains',
              to: '/chains',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'Discord',
              href: 'https://discord.gg/chainlink',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/smartcontractkit/ccip-tools-ts',
            },
            {
              label: 'X',
              href: 'https://x.com/chainlink',
            },
          ],
        },
        {
          title: 'Resources',
          items: [
            {
              label: 'Chainlink CCIP Docs',
              href: 'https://docs.chain.link/ccip',
            },
            {
              label: 'Release Notes',
              href: 'https://github.com/smartcontractkit/ccip-tools-ts/releases',
            },
            {
              label: 'Chainlink',
              href: 'https://chain.link',
            },
            {
              label: 'LLM Context (llms.txt)',
              href: 'pathname:///llms.txt',
            },
          ],
        },
      ],
      copyright: `Previous versions: see <a href="https://github.com/smartcontractkit/ccip-tools-ts/releases">GitHub releases</a><br/>Copyright © ${new Date().getFullYear()} Chainlink.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['typescript', 'bash', 'json'],
    },
    // OpenAPI code sample language tabs - order determines display priority
    languageTabs: [
      {
        highlight: 'bash',
        language: 'curl',
        logoClass: 'curl',
      },
      {
        highlight: 'javascript',
        language: 'nodejs',
        logoClass: 'nodejs',
      },
      {
        highlight: 'python',
        language: 'python',
        logoClass: 'python',
      },
      {
        highlight: 'go',
        language: 'go',
        logoClass: 'go',
      },
      {
        highlight: 'java',
        language: 'java',
        logoClass: 'java',
      },
      {
        highlight: 'rust',
        language: 'rust',
        logoClass: 'rust',
      },
      {
        highlight: 'ruby',
        language: 'ruby',
        logoClass: 'ruby',
      },
      {
        highlight: 'csharp',
        language: 'csharp',
        logoClass: 'csharp',
      },
      {
        highlight: 'php',
        language: 'php',
        logoClass: 'php',
      },
    ],
  } satisfies Preset.ThemeConfig,
}

export default config
