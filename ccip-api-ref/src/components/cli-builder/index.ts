/**
 * CLI Command Builder
 *
 * A schema-driven, interactive CLI command builder for Docusaurus documentation.
 * Build CLI commands through a user-friendly form interface with real-time preview.
 *
 * @example
 * ```tsx
 * import { CLIBuilder } from '@site/src/components/cli-builder';
 *
 * // In MDX:
 * <CLIBuilder command="send" showExamples />
 * ```
 *
 * @packageDocumentation
 */

// Main component
export { type CLIBuilderProps, CLIBuilder } from './components/index.ts'

// Supporting components (for advanced usage)
export { type CommandPreviewProps, CommandPreview } from './components/index.ts'
export { type OptionGroupProps, OptionGroup } from './components/index.ts'

// Hooks (for building custom integrations)
export { useCommandBuilder } from './hooks/index.ts'
export { useClipboard } from './hooks/index.ts'

// Schemas (for extending with new commands)
export { SCHEMA_REGISTRY, getSchema, hasSchema } from './schemas/index.ts'
export { sendSchema } from './schemas/send.schema.ts'
export { showSchema } from './schemas/show.schema.ts'

// Types (for type-safe schema definitions)
export type {
  ArgumentDefinition,
  ArrayOption,
  BooleanOption,
  BuilderOptions,
  BuilderValues,
  ChainOption,
  CommandExample,
  // Schema types
  CommandSchema,
  OptionDefinition,
  // State types
  OptionValue,
  SelectOption,
  StringOption,
  UseCommandBuilderResult,
} from './types/index.ts'

// Type guards
export {
  isArrayOption,
  isBooleanOption,
  isChainOption,
  isSelectOption,
  isStringOption,
} from './types/index.ts'
