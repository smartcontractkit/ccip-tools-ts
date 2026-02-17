/**
 * CLI Command Builder - Schema Types
 *
 * Defines the type system for declarative command schemas.
 * Commands are defined as schemas that drive the builder UI.
 */

import type { ChainType } from '../../../types/index.ts'

// ============================================================================
// Option Types
// ============================================================================

/** Available option input types */
export type OptionType = 'string' | 'number' | 'boolean' | 'select' | 'array' | 'chain'

/** Base option properties shared by all option types */
export interface BaseOption<T extends OptionType = OptionType> {
  /** Option type determines the input component */
  type: T
  /** CLI flag name (e.g., 'receiver' for --receiver) */
  name: string
  /** Short alias (e.g., 'R' for -R) */
  alias?: string
  /** Display label in the UI */
  label: string
  /** Help text shown below input */
  description?: string
  /** Whether the option is required */
  required?: boolean
  /** Default value */
  defaultValue?: unknown
  /** Group name for visual organization */
  group?: string
  /** Only show for specific chains */
  chains?: ChainType[]
  /** Minimum CLI version that supports this option */
  minVersion?: string
}

/** String input option */
export interface StringOption extends BaseOption<'string'> {
  type: 'string'
  /** Placeholder text */
  placeholder?: string
  /** Validation regex pattern */
  pattern?: RegExp
  /** Custom validation function */
  validate?: (value: string) => string | null
}

/** Number input option */
export interface NumberOption extends BaseOption<'number'> {
  type: 'number'
  /** Placeholder text */
  placeholder?: string
  /** Default value */
  defaultValue?: number
  /** Minimum value */
  min?: number
  /** Maximum value */
  max?: number
}

/** Boolean toggle option */
export interface BooleanOption extends BaseOption<'boolean'> {
  type: 'boolean'
  /** Default checked state */
  defaultValue?: boolean
}

/** Select dropdown option */
export interface SelectOption extends BaseOption<'select'> {
  type: 'select'
  /** Available options */
  options: ReadonlyArray<{ value: string; label: string }>
  /** Default selected value */
  defaultValue?: string
}

/** Array input option (multiple values) */
export interface ArrayOption extends BaseOption<'array'> {
  type: 'array'
  /** Type of items in the array */
  itemType: 'string' | 'token-transfer'
  /** CLI separator for multiple values */
  separator?: string
  /** Placeholder for items */
  placeholder?: string
}

/** Chain selector option */
export interface ChainOption extends BaseOption<'chain'> {
  type: 'chain'
  /** Allowed chain types */
  allowedChains?: ChainType[]
  /** Placeholder text */
  placeholder?: string
}

/** Union of all option types */
export type OptionDefinition =
  | StringOption
  | NumberOption
  | BooleanOption
  | SelectOption
  | ArrayOption
  | ChainOption

// ============================================================================
// Argument Types
// ============================================================================

/** Positional argument definition */
export interface ArgumentDefinition {
  /** Argument name (for display and value tracking) */
  name: string
  /** Display label */
  label: string
  /** Argument type */
  type: 'string' | 'chain'
  /** Whether required */
  required: boolean
  /** Placeholder text */
  placeholder?: string
  /** Validation pattern */
  pattern?: RegExp
  /** Help description */
  description?: string
}

// ============================================================================
// Command Schema
// ============================================================================

/** Example command usage */
export interface CommandExample {
  /** Example description */
  title: string
  /** Full command string */
  command: string
}

/** Full command schema definition */
export interface CommandSchema<T extends string = string> {
  /** Command name (e.g., 'send', 'show') */
  name: T
  /** Command description */
  description: string
  /** Usage synopsis (e.g., 'ccip-cli send <source> <router> <dest>') */
  synopsis: string
  /** Positional arguments */
  arguments: ArgumentDefinition[]
  /** Command options */
  options: OptionDefinition[]
  /** Usage examples */
  examples?: CommandExample[]
}

// ============================================================================
// Option Groups
// ============================================================================

/** Predefined option groups */
export const OPTION_GROUPS = {
  message: { label: 'Message Options', order: 1 },
  gas: { label: 'Gas Options', order: 2 },
  wallet: { label: 'Wallet Options', order: 3 },
  solana: { label: 'Solana-Specific', order: 4 },
  output: { label: 'Output Options', order: 5 },
} as const

/** Keys for predefined option groups */
export type OptionGroupKey = keyof typeof OPTION_GROUPS

// ============================================================================
// Type Guards
// ============================================================================

/** Type guard to check if an option is a StringOption */
export function isStringOption(opt: OptionDefinition): opt is StringOption {
  return opt.type === 'string'
}

/** Type guard to check if an option is a NumberOption */
export function isNumberOption(opt: OptionDefinition): opt is NumberOption {
  return opt.type === 'number'
}

/** Type guard to check if an option is a BooleanOption */
export function isBooleanOption(opt: OptionDefinition): opt is BooleanOption {
  return opt.type === 'boolean'
}

/** Type guard to check if an option is a SelectOption */
export function isSelectOption(opt: OptionDefinition): opt is SelectOption {
  return opt.type === 'select'
}

/** Type guard to check if an option is an ArrayOption */
export function isArrayOption(opt: OptionDefinition): opt is ArrayOption {
  return opt.type === 'array'
}

/** Type guard to check if an option is a ChainOption */
export function isChainOption(opt: OptionDefinition): opt is ChainOption {
  return opt.type === 'chain'
}
