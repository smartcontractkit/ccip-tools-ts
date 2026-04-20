// @ts-check
import eslint from '@eslint/js'
import { defineConfig } from 'eslint/config'
import { createNodeResolver, flatConfigs as importXFlatConfigs } from 'eslint-plugin-import-x'
import { default as jsdoc } from 'eslint-plugin-jsdoc'
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'
import tsdoc from 'eslint-plugin-tsdoc'
import { configs as tseslintConfigs } from 'typescript-eslint'

export default defineConfig(
  {
    ignores: [
      'ccip-api-ref/.docusaurus/**',
      'ccip-api-ref/build/**',
      'ccip-api-ref/docs/api/**',
      'ccip-api-ref/scripts/**',
    ],
  },
  eslint.configs.recommended,
  eslintPluginPrettierRecommended,
  importXFlatConfigs.recommended,
  // Inline the useful parts of flatConfigs.typescript without its broken
  // eslint-import-resolver-typescript dependency. Our source files already
  // use explicit .ts extensions, so createNodeResolver handles everything.
  {
    settings: {
      'import-x/extensions': ['.ts', '.tsx', '.cts', '.mts', '.js', '.jsx', '.cjs', '.mjs'],
      'import-x/external-module-folders': ['node_modules', 'node_modules/@types'],
      'import-x/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx', '.cts', '.mts'] },
    },
    rules: {
      // TypeScript compiler already validates named imports
      'import-x/named': 'off',
    },
  },
  ...tseslintConfigs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            '*.js',
            '*.mjs',
            '.cjs',
            'ccip-api-ref/plugins/docusaurus-plugin-jsonld/index.js',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': ['warn', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/consistent-type-exports': [
        'warn',
        { fixMixedExportsWithInlineTypeSpecifier: true },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'warn',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
    },
  },
  {
    // Ban generic Error constructor - enforce typed error classes
    files: ['ccip-sdk/src/**/*.ts'],
    ignores: ['**/*.test.ts', '**/__tests__/**', '**/__mocks__/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Error']",
          message:
            'Use CCIPError or specialized error classes instead of generic Error. See src/errors/specialized.ts for available error types.',
        },
        {
          selector: "CallExpression[callee.name='Error']",
          message:
            'Use CCIPError or specialized error classes instead of generic Error. Use "new" with error classes.',
        },
        // Required for NextJS Turbopack compatibility
        {
          selector:
            "BinaryExpression[operator='**'][left.type='Literal'][left.bigint], BinaryExpression[operator='**'][right.type='Literal'][right.bigint]",
          message:
            'Do not use the ** operator with bigint literals. Use BigInt() for operands instead, e.g. BigInt(2) ** BigInt(64).',
        },
      ],
    },
  },
  {
    // Cross-platform portability - ban Node.js built-in modules in SDK production code
    // SDK must work in both Node.js and browsers. See CONTRIBUTING.md "Cross-Platform Portability"
    files: ['ccip-sdk/src/**/*.ts'],
    ignores: ['**/*.test.ts', '**/__tests__/**', '**/__mocks__/**'],
    rules: {
      'import-x/no-nodejs-modules': [
        'error',
        {
          allow: ['buffer'], // Allowed because we explicitly import { Buffer } from 'buffer'
        },
      ],
    },
  },
  {
    // Enforce stdout/stderr separation: use ctx.output for data, ctx.logger for diagnostics.
    // Direct console.* calls bypass the architecture. Only index.ts is exempt (top-level handlers).
    files: ['ccip-cli/src/**/*.ts'],
    ignores: ['**/*.test.ts', 'ccip-cli/src/index.ts'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    // Ban cli imports from @chainlink/ccip-sdk modules other than /src/index.ts
    files: ['ccip-cli/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!@chainlink/ccip-sdk/src/index\\.ts$).*\\/ccip-sdk\\b',
              message: 'Import from @chainlink/ccip-sdk/src/index.ts instead of other modules.',
            },
          ],
        },
      ],
    },
  },
  {
    // Apply these settings to test files
    files: ['**/*.test.ts', '**/__tests__/**/*.ts', '**/__mocks__/**/*.ts'],
    rules: {
      // Disable specific rules for test files
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    settings: {
      'import-x/resolver-next': [
        createNodeResolver({
          extensions: ['.ts', '.tsx', '.cts', '.mts', '.js', '.jsx', '.cjs', '.mjs'],
        }),
      ],
    },
    rules: {
      'import-x/order': [
        'warn',
        {
          groups: ['builtin', ['external', 'internal'], ['parent', 'sibling', 'index']],
          'newlines-between': 'always',
          named: { enabled: true, import: true, export: true, types: 'types-first' },
          alphabetize: { order: 'asc' },
        },
      ],
      'import-x/no-duplicates': ['warn', { 'prefer-inline': true }],
      'import-x/extensions': ['warn', 'always', { ignorePackages: true, checkTypeImports: true }],
    },
  },
  // Docusaurus - ignore virtual module imports and generated files
  {
    files: ['ccip-api-ref/src/**/*.tsx', 'ccip-api-ref/src/**/*.ts'],
    rules: {
      'import-x/no-unresolved': [
        'error',
        { ignore: ['^@docusaurus/', '^@theme/', '^@theme-original/', '^@site/'] },
      ],
    },
  },
  // Docusaurus plugin CommonJS wrapper - allow Node.js globals and require
  {
    files: ['ccip-api-ref/plugins/**/index.js'],
    languageOptions: {
      globals: {
        module: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['ccip-api-ref/sidebars*.ts'],
    rules: {
      'import-x/no-unresolved': ['error', { ignore: ['typedoc-sidebar\\.cjs$', '/sidebar$'] }],
      'import-x/extensions': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  // TSDoc syntax validation (applies to all TS files)
  {
    plugins: { tsdoc },
    rules: {
      'tsdoc/syntax': 'error', // Enforced - all syntax issues have been fixed
    },
  },
  // JSDoc completeness enforcement (all packages, exclude tests)
  {
    files: ['ccip-sdk/src/**/*.ts', 'ccip-cli/src/**/*.ts', 'ccip-api-ref/src/**/*.ts'],
    ignores: ['**/*.test.ts', '**/__tests__/**', '**/__mocks__/**', '**/idl/**'],
    plugins: { jsdoc },
    rules: {
      // DISABLE type-related rules (TypeScript handles types)
      'jsdoc/require-param-type': 'off',
      'jsdoc/require-returns-type': 'off',
      'jsdoc/no-types': 'error', // Forbid @param {string} - prevents drift
      'jsdoc/check-tag-names': 'off', // Defer to tsdoc/syntax

      // COMPLETENESS rules (start as warnings)
      'jsdoc/require-jsdoc': [
        'error',
        {
          require: {
            FunctionDeclaration: false, // Use contexts for exports only
            MethodDefinition: true,
            ClassDeclaration: true,
            ArrowFunctionExpression: false,
            FunctionExpression: false,
          },
          contexts: [
            'ExportNamedDeclaration > FunctionDeclaration',
            'ExportNamedDeclaration > TSInterfaceDeclaration',
            'ExportNamedDeclaration > TSTypeAliasDeclaration',
            'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression',
          ],
        },
      ],
      'jsdoc/require-description': 'error',

      // Validation rules - ensure existing @param tags are correct
      // checkDestructured: false - TypeScript types document structure, JSDoc provides meaning
      'jsdoc/check-param-names': ['error', { checkDestructured: false }],
      'jsdoc/require-param-name': 'error',
      'jsdoc/no-blank-blocks': 'error', // Prevent empty /** */ stubs

      // Note: require-param/returns are OFF because TSDoc's {@inheritDoc} inline tag
      // is not recognized by eslint-plugin-jsdoc's exemptedBy mechanism.
      // TypeDoc will still inherit full documentation from base classes.
      // Use tsdoc/syntax to validate documentation syntax.
      'jsdoc/require-param': 'off',
      'jsdoc/require-param-description': 'off',
      'jsdoc/require-returns': 'off',
      'jsdoc/require-returns-description': 'off',

      // Formatting handled by Prettier - no JSDoc formatting rules needed
    },
  },
)
