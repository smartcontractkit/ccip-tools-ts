import { CCIPError, CCIPErrorCode } from '../errors/index.ts'

/** Canton token amounts use 10 decimal places (lf-coin micro-units). */
export const CANTON_DECIMALS = 10

const CANTON_DECIMAL_SCALE = BigInt(10) ** BigInt(CANTON_DECIMALS)

/** Parse a Canton decimal amount string (e.g. `1.0`, `0.001`) into fixed-scale units. */
export function parseCantonDecimalAmountUnits(raw: string): bigint {
  const value = raw.trim().replace(/\.$/, '')
  if (!/^\d+(\.\d+)?$/.test(value)) return 0n
  const [wholeRaw, fractionRaw = ''] = value.split('.')
  if (fractionRaw.length > CANTON_DECIMALS) return 0n
  const whole = BigInt(wholeRaw || '0')
  const fraction = BigInt(fractionRaw.padEnd(CANTON_DECIMALS, '0') || '0')
  return whole * CANTON_DECIMAL_SCALE + fraction
}

/** Format fixed-scale Canton units as a decimal string (e.g. `10000000000` → `1.0000000000`). */
export function formatCantonDecimalAmountUnits(amount: bigint): string {
  if (amount < 0n) {
    throw new CCIPError(CCIPErrorCode.METHOD_UNSUPPORTED, 'Canton token amounts cannot be negative')
  }
  const whole = amount / CANTON_DECIMAL_SCALE
  const fraction = (amount % CANTON_DECIMAL_SCALE).toString().padStart(CANTON_DECIMALS, '0')
  return `${whole}.${fraction}`
}
