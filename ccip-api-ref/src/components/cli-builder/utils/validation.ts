/**
 * CLI Builder - Validation Utilities
 */

import { type ArgumentDefinition, type OptionDefinition, isStringOption } from '../types/index.ts'

/**
 * Check if definition is an OptionDefinition (has option-specific properties)
 */
function isOptionDefinition(def: OptionDefinition | ArgumentDefinition): def is OptionDefinition {
  // Options have 'type' as one of the OptionType values
  // Arguments have 'type' as 'string' | 'chain' but also have 'required' as a non-optional boolean
  // We check for alias which is only on options
  return 'alias' in def || def.type === 'boolean' || def.type === 'select' || def.type === 'array'
}

/**
 * Validate a field value against its definition
 * @returns Error message or null if valid
 */
export function validateField(
  definition: OptionDefinition | ArgumentDefinition,
  value: unknown,
): string | null {
  // Check required
  if (definition.required && (value === undefined || value === '' || value === null)) {
    return `${definition.label} is required`
  }

  // Skip further validation if empty and not required
  if (value === undefined || value === '' || value === null) {
    return null
  }

  // Type-specific validation
  if (isOptionDefinition(definition)) {
    // Option validation
    if (isStringOption(definition) && typeof value === 'string') {
      // Pattern validation
      if (definition.pattern && !definition.pattern.test(value)) {
        return `Invalid format for ${definition.label}`
      }
      // Custom validation
      if (definition.validate) {
        return definition.validate(value)
      }
    }
  } else {
    // Argument validation
    if (definition.pattern && typeof value === 'string') {
      if (!definition.pattern.test(value)) {
        return `Invalid format for ${definition.label}`
      }
    }
  }

  return null
}

/**
 * Validate all fields
 * @returns Object mapping field names to error messages
 */
export function validateAll(
  args: ArgumentDefinition[],
  options: OptionDefinition[],
  values: Record<string, unknown>,
): Record<string, string | undefined> {
  const errors: Record<string, string | undefined> = {}

  // Validate arguments
  for (const arg of args) {
    const error = validateField(arg, values[arg.name])
    if (error) {
      errors[arg.name] = error
    }
  }

  // Validate options
  for (const opt of options) {
    const error = validateField(opt, values[opt.name])
    if (error) {
      errors[opt.name] = error
    }
  }

  return errors
}

/**
 * Check if form is valid (no errors)
 */
export function isFormValid(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).every((e) => !e)
}
