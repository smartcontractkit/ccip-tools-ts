/**
 * Combines CSS class names, filtering out falsy values
 * Alternative to clsx for simple cases
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}
