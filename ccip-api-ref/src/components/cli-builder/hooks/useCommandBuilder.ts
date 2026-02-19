/**
 * useCommandBuilder - Core builder logic hook
 *
 * Manages form state, validation, and command generation.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  BuilderOptions,
  BuilderValues,
  CommandSchema,
  OptionValue,
  UseCommandBuilderResult,
} from '../types/index.ts'
import { generateCommand, getDefaultValues } from '../utils/formatting.ts'
import { isFormValid, validateAll } from '../utils/validation.ts'

/**
 * Hook for building CLI commands from a schema
 *
 * @example
 * ```tsx
 * const { values, command, handleChange, isValid } = useCommandBuilder(sendSchema);
 *
 * return (
 *   <div>
 *     <input
 *       value={values.receiver || ''}
 *       onChange={(e) => handleChange('receiver', e.target.value)}
 *     />
 *     <pre>{command}</pre>
 *   </div>
 * );
 * ```
 */
export function useCommandBuilder<T extends string>(
  schema: CommandSchema<T>,
  options?: BuilderOptions,
): UseCommandBuilderResult {
  // Initialize with defaults
  const [values, setValuesState] = useState<BuilderValues>(() => ({
    ...getDefaultValues(schema),
    ...options?.initialValues,
  }))

  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  // Generate command string - memoized
  const command = useMemo(() => generateCommand(schema, values), [schema, values])

  // Validate all fields - memoized
  const validationErrors = useMemo(
    () => validateAll(schema.arguments, schema.options, values),
    [schema, values],
  )

  // Update errors when validation changes
  useEffect(() => {
    setErrors(validationErrors)
  }, [validationErrors])

  // Check if form is valid
  const isValid = useMemo(() => isFormValid(validationErrors), [validationErrors])

  // Handle field change
  const handleChange = useCallback(
    (name: string, value: OptionValue) => {
      setValuesState((prev) => {
        const next = { ...prev, [name]: value }
        options?.onChange?.(next)
        return next
      })
    },
    [options],
  )

  // Reset to defaults
  const reset = useCallback(() => {
    const defaults = {
      ...getDefaultValues(schema),
      ...options?.initialValues,
    }
    setValuesState(defaults)
    options?.onChange?.(defaults)
  }, [schema, options])

  // Set multiple values at once
  const setValues = useCallback(
    (newValues: BuilderValues) => {
      setValuesState((prev) => {
        const next = { ...prev, ...newValues }
        options?.onChange?.(next)
        return next
      })
    },
    [options],
  )

  return {
    values,
    errors,
    command,
    isValid,
    handleChange,
    reset,
    setValues,
  }
}
