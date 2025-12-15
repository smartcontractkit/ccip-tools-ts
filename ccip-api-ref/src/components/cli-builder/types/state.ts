/**
 * CLI Command Builder - State Types
 *
 * Defines types for builder state management.
 */

import type { ChainType } from '../../../types/index.ts'

/** Value types for different option types */
export type OptionValue = string | boolean | string[] | undefined

/** Builder field values - keyed by option/argument name */
export type BuilderValues = Record<string, OptionValue>

/** Field validation errors - keyed by option/argument name */
export type BuilderErrors = Record<string, string | undefined>

/** Builder state */
export interface BuilderState {
  /** Current field values */
  values: BuilderValues
  /** Validation errors */
  errors: BuilderErrors
  /** Whether form has been touched */
  touched: boolean
}

/** Builder options passed to the hook */
export interface BuilderOptions {
  /** Initial values to populate */
  initialValues?: BuilderValues
  /** Selected chain context (affects conditional options) */
  selectedChain?: ChainType
  /** CLI version for version-gated options */
  cliVersion?: string
  /** Callback when values change */
  onChange?: (values: BuilderValues) => void
}

/** Result returned by useCommandBuilder hook */
export interface UseCommandBuilderResult {
  /** Current field values */
  values: BuilderValues
  /** Validation errors */
  errors: BuilderErrors
  /** Generated command string */
  command: string
  /** Whether form is valid */
  isValid: boolean
  /** Update a field value */
  handleChange: (name: string, value: OptionValue) => void
  /** Reset form to defaults */
  reset: () => void
  /** Set multiple values at once */
  setValues: (values: BuilderValues) => void
}
