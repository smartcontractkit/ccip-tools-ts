/**
 * SelectInput - Dropdown select component for CLI Builder
 *
 * Renders a dropdown for options with predefined choices.
 * Supports both required and optional selections.
 */

import { type ChangeEvent, useCallback, useId } from 'react'

import styles from './inputs.module.css'
import type { SelectOption } from '../../types/index.ts'

export interface SelectInputProps {
  /** Option definition with choices */
  definition: SelectOption
  /** Currently selected value */
  value: string
  /** Change handler */
  onChange: (value: string) => void
  /** Validation error message */
  error?: string
  /** Whether the field is disabled */
  disabled?: boolean
}

/**
 * Dropdown select component with accessibility support
 *
 * @example
 * ```tsx
 * <SelectInput
 *   definition={{
 *     name: 'fee-token',
 *     label: 'Fee Token',
 *     options: [
 *       { value: '', label: 'Native (ETH/SOL)' },
 *       { value: 'LINK', label: 'LINK' },
 *     ]
 *   }}
 *   value={values['fee-token']}
 *   onChange={(v) => handleChange('fee-token', v)}
 * />
 * ```
 */
export function SelectInput({
  definition,
  value,
  onChange,
  error,
  disabled = false,
}: SelectInputProps) {
  const selectId = useId()
  const errorId = `${selectId}-error`
  const descriptionId = `${selectId}-description`

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      onChange(e.target.value)
    },
    [onChange],
  )

  const hasError = Boolean(error)
  const isRequired = definition.required ?? false

  return (
    <div className={styles.inputWrapper}>
      <label htmlFor={selectId} className={styles.label}>
        {definition.label}
        {isRequired && <span className={styles.required}>*</span>}
      </label>

      <select
        id={selectId}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        className={`${styles.select} ${hasError ? styles.inputError : ''}`}
        aria-invalid={hasError}
        aria-describedby={
          [error ? errorId : null, definition.description ? descriptionId : null]
            .filter(Boolean)
            .join(' ') || undefined
        }
        aria-required={isRequired}
      >
        {!isRequired && <option value="">-- Select --</option>}
        {definition.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {definition.description && (
        <p id={descriptionId} className={styles.description}>
          {definition.description}
        </p>
      )}

      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
