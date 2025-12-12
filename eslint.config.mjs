// @ts-check
import eslint from '@eslint/js'
import { defineConfig } from 'eslint/config'
import importPlugin from 'eslint-plugin-import'
import jsdoc from 'eslint-plugin-jsdoc'
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'
import tsdoc from 'eslint-plugin-tsdoc'
import { configs as tseslintConfigs } from 'typescript-eslint'

export default defineConfig(
  eslint.configs.recommended,
  eslintPluginPrettierRecommended,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  ...tseslintConfigs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js', '*.mjs', '.cjs'],
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
    },
  },
  {
    // Ban generic Error constructor - enforce typed error classes
    files: ['ccip-sdk/src/**/*.ts', 'ccip-cli/src/**/*.ts'],
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
      'import/parsers': {
        '@typescript-eslint/parser': ['.ts'],
      },
      'import/resolver': {
        typescript: {
          project: ['tsconfig.json'],
          alwaysTryTypes: true,
        },
        node: {
          project: ['tsconfig.json'],
        },
      },
      'import/extensions': ['.ts', '.js', '.mjs', '.cjs'],
    },
    rules: {
      'import/order': [
        'warn',
        {
          groups: ['builtin', ['external', 'internal'], ['parent', 'sibling', 'index']],
          'newlines-between': 'always',
          named: { enabled: true, import: true, export: true, types: 'types-first' },
          alphabetize: { order: 'asc' },
        },
      ],
      'import/no-duplicates': ['warn', { 'prefer-inline': true }],
      'import/extensions': ['warn', 'always', { ignorePackages: true, checkTypeImports: true }],
    },
  },
  // TSDoc syntax validation (applies to all TS files)
  {
    plugins: { tsdoc },
    rules: {
      'tsdoc/syntax': 'error', // Enforced - all syntax issues have been fixed
    },
  },
  // JSDoc completeness enforcement (both packages, exclude tests)
  {
    files: ['ccip-sdk/src/**/*.ts', 'ccip-cli/src/**/*.ts'],
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
