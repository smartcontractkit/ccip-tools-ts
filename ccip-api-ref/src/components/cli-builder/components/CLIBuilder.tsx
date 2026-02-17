/**
 * CLIBuilder - Main interactive CLI command builder component
 *
 * A schema-driven form component that generates CLI commands
 * based on user input. Supports all option types and provides
 * real-time command preview with copy functionality.
 */

import { type ReactNode, useMemo } from 'react'

import styles from './CLIBuilder.module.css'
import { CommandPreview } from './CommandPreview.tsx'
import { GROUP_LABELS, OptionGroup } from './OptionGroup.tsx'
import { useCommandBuilder } from '../hooks/index.ts'
import { getSchema } from '../schemas/index.ts'
import type {
  ArgumentDefinition,
  BuilderOptions,
  CommandSchema,
  OptionDefinition,
  OptionValue,
  StringOption,
} from '../types/index.ts'
import { ArrayInput, BooleanInput, ChainSelect, SelectInput, StringInput } from './inputs/index.ts'

export interface CLIBuilderProps {
  /** Command name to build (e.g., 'send', 'show') */
  command: string
  /** Initial values for the form */
  initialValues?: Record<string, OptionValue>
  /** Callback when values change */
  onChange?: (values: Record<string, OptionValue>) => void
  /** Whether to show the command preview */
  showPreview?: boolean
  /** Whether to show example commands */
  showExamples?: boolean
  /** Additional CSS class */
  className?: string
}

/**
 * Main CLI Builder component
 *
 * @example
 * ```tsx
 * // In MDX:
 * import { CLIBuilder } from '@site/src/components/cli-builder';
 *
 * <CLIBuilder command="send" showExamples />
 * ```
 */
export function CLIBuilder({
  command,
  initialValues,
  onChange,
  showPreview = true,
  showExamples = false,
  className,
}: CLIBuilderProps) {
  // Get schema for command
  const schema = useMemo(() => getSchema(command), [command])

  if (!schema) {
    return (
      <div className={`${styles.cliBuilder} ${styles.error} ${className ?? ''}`}>
        <p>
          Unknown command: <code>{command}</code>
        </p>
        <p>Available commands: send, show, manual-exec</p>
      </div>
    )
  }

  return (
    <CLIBuilderForm
      schema={schema}
      initialValues={initialValues}
      onChange={onChange}
      showPreview={showPreview}
      showExamples={showExamples}
      className={className}
    />
  )
}

/**
 * Internal form component (separated for hooks)
 */
interface CLIBuilderFormProps {
  schema: CommandSchema
  initialValues?: Record<string, OptionValue>
  onChange?: (values: Record<string, OptionValue>) => void
  showPreview: boolean
  showExamples: boolean
  className?: string
}

function CLIBuilderForm({
  schema,
  initialValues,
  onChange,
  showPreview,
  showExamples,
  className,
}: CLIBuilderFormProps) {
  const options: BuilderOptions = useMemo(
    () => ({
      initialValues,
      onChange,
    }),
    [initialValues, onChange],
  )

  const { values, errors, command, isValid, handleChange, reset } = useCommandBuilder(
    schema,
    options,
  )

  // Group options by their group property
  const groupedOptions = useMemo(() => {
    const groups: Record<string, OptionDefinition[]> = {}

    for (const opt of schema.options) {
      const group = opt.group ?? 'other'
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- groups is built dynamically
      if (!groups[group]) {
        groups[group] = []
      }
      groups[group].push(opt)
    }

    return groups
  }, [schema.options])

  // Get ordered group names
  const groupOrder = ['message', 'gas', 'solana', 'wallet', 'output', 'rpc', 'other']

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- groupedOptions[g] may be undefined for groups with no options
  const orderedGroups = groupOrder.filter((g) => groupedOptions[g]?.length > 0)

  return (
    <div className={`${styles.cliBuilder} ${className ?? ''}`}>
      <div className={styles.header}>
        <h3 className={styles.title}>
          <code>ccip-cli {schema.name}</code> Builder
        </h3>
        <p className={styles.synopsis}>{schema.description}</p>
      </div>

      <form
        className={styles.form}
        onSubmit={(e) => e.preventDefault()}
        aria-label={`CLI Builder for ${schema.name} command`}
      >
        {/* Arguments section */}
        {schema.arguments.length > 0 && (
          <OptionGroup
            label={GROUP_LABELS.arguments.label}
            description={GROUP_LABELS.arguments.description}
          >
            {schema.arguments.map((arg) => renderArgumentInput(arg, values, errors, handleChange))}
          </OptionGroup>
        )}

        {/* Options grouped by category */}
        {orderedGroups.map((groupKey) => {
          const groupInfo = GROUP_LABELS[groupKey] ?? { label: groupKey }
          const opts = groupedOptions[groupKey]

          return (
            <OptionGroup key={groupKey} label={groupInfo.label} description={groupInfo.description}>
              {opts.map((opt) => renderOptionInput(opt, values, errors, handleChange))}
            </OptionGroup>
          )
        })}

        {/* Action buttons */}
        <div className={styles.actions}>
          <button type="button" onClick={reset} className={styles.resetButton}>
            Reset to Defaults
          </button>
          {!isValid && (
            <span className={styles.validationHint}>
              Fill in required fields to generate command
            </span>
          )}
        </div>
      </form>

      {/* Command preview */}
      {showPreview && <CommandPreview command={command} formatForDisplay />}

      {/* Examples */}
      {showExamples && schema.examples && schema.examples.length > 0 && (
        <div className={styles.examples}>
          <h4 className={styles.examplesTitle}>Examples</h4>
          {schema.examples.map((example, idx) => (
            <div key={idx} className={styles.example}>
              <p className={styles.exampleDescription}>{example.title}</p>
              <pre className={styles.exampleCode}>
                <code>{example.command}</code>
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Render appropriate input for an argument
 *
 * Note: eslint disable for no-unnecessary-condition because OptionValue includes undefined,
 * but type assertions narrow it before the nullish coalescing check.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */
function renderArgumentInput(
  arg: ArgumentDefinition,
  values: Record<string, OptionValue>,
  errors: Record<string, string | undefined>,
  handleChange: (name: string, value: OptionValue) => void,
): ReactNode {
  const value = values[arg.name]
  const error = errors[arg.name]

  // Chain arguments use ChainSelect
  if (arg.type === 'chain') {
    return (
      <ChainSelect
        key={arg.name}
        definition={arg}
        value={(value as string) ?? ''}
        onChange={(v) => handleChange(arg.name, v)}
        error={error}
      />
    )
  }

  // Default to string input
  return (
    <StringInput
      key={arg.name}
      definition={arg}
      value={(value as string) ?? ''}
      onChange={(v) => handleChange(arg.name, v)}
      error={error}
    />
  )
}

/**
 * Render appropriate input for an option
 */
function renderOptionInput(
  opt: OptionDefinition,
  values: Record<string, OptionValue>,
  errors: Record<string, string | undefined>,
  handleChange: (name: string, value: OptionValue) => void,
): ReactNode {
  const value = values[opt.name]
  const error = errors[opt.name]

  // Use switch on type for proper type narrowing
  switch (opt.type) {
    case 'boolean':
      return (
        <BooleanInput
          key={opt.name}
          definition={opt}
          value={(value as boolean) ?? false}
          onChange={(v) => handleChange(opt.name, v)}
        />
      )

    case 'select':
      return (
        <SelectInput
          key={opt.name}
          definition={opt}
          value={(value as string) ?? ''}
          onChange={(v) => handleChange(opt.name, v)}
          error={error}
        />
      )

    case 'array':
      return (
        <ArrayInput
          key={opt.name}
          definition={opt}
          value={(value as string[]) ?? []}
          onChange={(v) => handleChange(opt.name, v)}
          error={error}
        />
      )

    case 'chain':
      return (
        <ChainSelect
          key={opt.name}
          definition={opt}
          value={(value as string) ?? ''}
          onChange={(v) => handleChange(opt.name, v)}
          error={error}
        />
      )

    case 'string':
    case 'number':
    default:
      return (
        <StringInput
          key={opt.name}
          definition={opt as StringOption}
          value={(value as string) ?? ''}
          onChange={(v) => handleChange(opt.name, v)}
          error={error}
        />
      )
  }
}
/* eslint-enable @typescript-eslint/no-unnecessary-condition */
