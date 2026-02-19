/**
 * CLI Builder - Formatting Utilities
 */

import {
  type CommandSchema,
  type OptionDefinition,
  type OptionValue,
  isArrayOption,
  isBooleanOption,
} from '../types/index.ts'

/**
 * Format a value for CLI output
 */
function formatValue(opt: OptionDefinition, value: OptionValue): string {
  if (isBooleanOption(opt)) {
    // Boolean options are flags, no value needed
    return ''
  }

  if (isArrayOption(opt)) {
    const arr = value as string[]
    // Array options are repeated
    return arr
      .filter((v) => v)
      .map((v) => `--${opt.name} ${escapeValue(v)}`)
      .join(' ')
  }

  return escapeValue(String(value))
}

/**
 * Escape value for shell
 */
function escapeValue(value: string): string {
  // If value contains spaces or special chars, quote it
  if (/[\s"'\\$`!]/.test(value)) {
    // Use single quotes and escape single quotes
    return `'${value.replace(/'/g, "'\\''")}'`
  }
  return value
}

/**
 * Generate CLI command string from schema and values
 */
export function generateCommand(
  schema: CommandSchema,
  values: Record<string, OptionValue>,
): string {
  const parts: string[] = ['ccip-cli', schema.name]

  // Add arguments in order
  for (const arg of schema.arguments) {
    const value = values[arg.name]
    if (value && typeof value === 'string') {
      parts.push(escapeValue(value))
    } else if (arg.required) {
      // Placeholder for required args
      parts.push(`<${arg.name}>`)
    }
  }

  // Add options
  for (const opt of schema.options) {
    const value = values[opt.name]

    // Skip empty/undefined values
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive check for null
    if (value === undefined || value === '' || value === null) {
      continue
    }

    // Skip false booleans
    if (isBooleanOption(opt) && value === false) {
      continue
    }

    if (isArrayOption(opt)) {
      // Array options are added directly (formatValue handles repetition)
      const formatted = formatValue(opt, value)
      if (formatted) {
        parts.push(formatted)
      }
    } else if (isBooleanOption(opt)) {
      // Boolean flags
      parts.push(`--${opt.name}`)
    } else {
      // Regular options
      parts.push(`--${opt.name}`, formatValue(opt, value))
    }
  }

  return parts.join(' ')
}

/**
 * Get default values from schema
 */
export function getDefaultValues(schema: CommandSchema): Record<string, OptionValue> {
  const defaults: Record<string, OptionValue> = {}

  for (const opt of schema.options) {
    if (opt.defaultValue !== undefined) {
      defaults[opt.name] = opt.defaultValue as OptionValue
    }
  }

  return defaults
}

/**
 * Format command for display (with line breaks)
 */
export function formatCommandForDisplay(command: string, maxLineLength = 80): string {
  if (command.length <= maxLineLength) {
    return command
  }

  const parts = command.split(' ')
  const lines: string[] = []
  let currentLine = ''

  for (const part of parts) {
    if (currentLine.length + part.length + 1 > maxLineLength && currentLine) {
      lines.push(currentLine + ' \\')
      currentLine = '  ' + part // Indent continuation
    } else {
      currentLine = currentLine ? `${currentLine} ${part}` : part
    }
  }

  if (currentLine) {
    lines.push(currentLine)
  }

  return lines.join('\n')
}
