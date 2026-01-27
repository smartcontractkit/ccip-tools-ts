/**
 * StringInput - Text input component for CLI Builder
 *
 * Handles text, address, hex, and other string-based inputs with
 * validation feedback and accessibility support.
 */

import { type ChangeEvent, useCallback, useId } from 'react'

import styles from './inputs.module.css'
import type { ArgumentDefinition, StringOption } from '../../types/index.ts'

export interface StringInputProps {
  /** Option or argument definition */
  definition: StringOption | ArgumentDefinition
  /** Current value */
  value: string
  /** Change handler */
  onChange: (value: string) => void
  /** Validation error message */
  error?: string
  /** Whether the field is disabled */
  disabled?: boolean
}

/**
 * Text input component with validation and accessibility
 *
 * @example
 * ```tsx
 * <StringInput
 *   definition={{ name: 'receiver', label: 'Receiver Address', placeholder: '0x...' }}
 *   value={values.receiver}
 *   onChange={(v) => handleChange('receiver', v)}
 *   error={errors.receiver}
 * />
 * ```
 */
export function StringInput({
  definition,
  value,
  onChange,
  error,
  disabled = false,
}: StringInputProps) {
  const inputId = useId()
  const errorId = `${inputId}-error`
  const descriptionId = `${inputId}-description`

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value)
    },
    [onChange],
  )

  // Get placeholder from definition
  const placeholder = 'placeholder' in definition ? definition.placeholder : undefined

  // Determine input type based on pattern or name
  const inputType = getInputType(definition)

  const hasError = Boolean(error)
  const isRequired = definition.required ?? false

  return (
    <div className={styles.inputWrapper}>
      <label htmlFor={inputId} className={styles.label}>
        {definition.label}
        {isRequired && <span className={styles.required}>*</span>}
      </label>

      <input
        id={inputId}
        type={inputType}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        className={`${styles.input} ${hasError ? styles.inputError : ''}`}
        aria-invalid={hasError}
        aria-describedby={
          [error ? errorId : null, definition.description ? descriptionId : null]
            .filter(Boolean)
            .join(' ') || undefined
        }
        aria-required={isRequired}
      />

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

/**
 * Determine HTML input type based on option definition
 */
function getInputType(definition: StringOption | ArgumentDefinition): 'text' | 'number' | 'url' {
  const name = definition.name.toLowerCase()

  // Number-like fields
  if (name.includes('limit') || name.includes('amount') || name.includes('count')) {
    return 'text' // Use text for numbers to allow empty values
  }

  // URL fields
  if (name.includes('url') || name.includes('rpc')) {
    return 'url'
  }

  return 'text'
}
