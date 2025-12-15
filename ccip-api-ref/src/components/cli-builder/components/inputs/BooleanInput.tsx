/**
 * BooleanInput - Checkbox toggle component for CLI Builder
 *
 * Renders a checkbox for boolean flags in CLI commands.
 * When checked, the flag will be included in the generated command.
 */

import { type ChangeEvent, useCallback, useId } from 'react'

import styles from './inputs.module.css'
import type { BooleanOption } from '../../types/index.ts'

export interface BooleanInputProps {
  /** Boolean option definition */
  definition: BooleanOption
  /** Whether the checkbox is checked */
  value: boolean
  /** Change handler */
  onChange: (value: boolean) => void
  /** Whether the field is disabled */
  disabled?: boolean
}

/**
 * Checkbox component for boolean CLI flags
 *
 * @example
 * ```tsx
 * <BooleanInput
 *   definition={{
 *     name: 'allow-out-of-order-exec',
 *     label: 'Allow Out-of-Order Execution',
 *     description: 'Allow messages to be executed out of order'
 *   }}
 *   value={values['allow-out-of-order-exec']}
 *   onChange={(v) => handleChange('allow-out-of-order-exec', v)}
 * />
 * ```
 */
export function BooleanInput({ definition, value, onChange, disabled = false }: BooleanInputProps) {
  const inputId = useId()
  const descriptionId = `${inputId}-description`

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.checked)
    },
    [onChange],
  )

  return (
    <div className={styles.checkboxWrapper}>
      <div className={styles.checkboxRow}>
        <input
          id={inputId}
          type="checkbox"
          checked={value}
          onChange={handleChange}
          disabled={disabled}
          className={styles.checkbox}
          aria-describedby={definition.description ? descriptionId : undefined}
        />
        <label htmlFor={inputId} className={styles.checkboxLabel}>
          {definition.label}
        </label>
      </div>

      {definition.description && (
        <p id={descriptionId} className={styles.description}>
          {definition.description}
        </p>
      )}
    </div>
  )
}
