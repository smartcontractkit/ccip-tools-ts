/**
 * ArrayInput - Multi-value input component for CLI Builder
 *
 * Allows users to add multiple values for array-type options.
 * Each value generates a separate flag in the command (e.g., --account 0x1 --account 0x2).
 */

import { type KeyboardEvent, useCallback, useId, useState } from 'react'

import styles from './inputs.module.css'
import type { ArrayOption } from '../../types/index.ts'

export interface ArrayInputProps {
  /** Array option definition */
  definition: ArrayOption
  /** Current array of values */
  value: string[]
  /** Change handler */
  onChange: (value: string[]) => void
  /** Validation error message */
  error?: string
  /** Whether the field is disabled */
  disabled?: boolean
}

/**
 * Multi-value input with add/remove functionality
 *
 * @example
 * ```tsx
 * <ArrayInput
 *   definition={{
 *     name: 'account',
 *     label: 'Additional Accounts',
 *     itemType: 'string',
 *     placeholder: '0x...'
 *   }}
 *   value={values.account || []}
 *   onChange={(v) => handleChange('account', v)}
 * />
 * ```
 */
export function ArrayInput({
  definition,
  value,
  onChange,
  error,
  disabled = false,
}: ArrayInputProps) {
  const inputId = useId()
  const errorId = `${inputId}-error`
  const descriptionId = `${inputId}-description`

  const [inputValue, setInputValue] = useState('')

  const handleAdd = useCallback(() => {
    const trimmed = inputValue.trim()
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed])
      setInputValue('')
    }
  }, [inputValue, value, onChange])

  const handleRemove = useCallback(
    (index: number) => {
      onChange(value.filter((_, i) => i !== index))
    },
    [value, onChange],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleAdd()
      }
    },
    [handleAdd],
  )

  const hasError = Boolean(error)
  const isRequired = definition.required ?? false

  // Get placeholder from definition
  const placeholder = definition.placeholder ?? `Add ${definition.label.toLowerCase()}...`

  return (
    <div className={styles.inputWrapper}>
      <label htmlFor={inputId} className={styles.label}>
        {definition.label}
        {isRequired && <span className={styles.required}>*</span>}
        {value.length > 0 && <span className={styles.count}>({value.length})</span>}
      </label>

      <div className={styles.arrayInputRow}>
        <input
          id={inputId}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={`${styles.input} ${styles.arrayInput} ${hasError ? styles.inputError : ''}`}
          aria-invalid={hasError}
          aria-describedby={
            [error ? errorId : null, definition.description ? descriptionId : null]
              .filter(Boolean)
              .join(' ') || undefined
          }
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={disabled || !inputValue.trim()}
          className={styles.addButton}
          aria-label={`Add ${definition.label}`}
        >
          Add
        </button>
      </div>

      {value.length > 0 && (
        <ul className={styles.arrayList} aria-label={`${definition.label} values`}>
          {value.map((item, index) => (
            <li key={`${item}-${index}`} className={styles.arrayItem}>
              <code className={styles.arrayValue}>{item}</code>
              <button
                type="button"
                onClick={() => handleRemove(index)}
                disabled={disabled}
                className={styles.removeButton}
                aria-label={`Remove ${item}`}
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}

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
