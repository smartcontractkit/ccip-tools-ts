/**
 * ErrorBoundary
 *
 * Error boundary wrapper for graceful error handling in the Copy Page feature.
 * Catches JavaScript errors in child component tree and displays a fallback UI.
 */

import { type ErrorInfo, type ReactNode, Component } from 'react'

import styles from './ErrorBoundary.module.css'

interface ErrorBoundaryProps {
  /** Child components to wrap */
  children: ReactNode
  /** Optional fallback UI to show on error. If not provided, shows default message */
  fallback?: ReactNode
  /** Optional callback when error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  /** Whether to show error details in development */
  showDetails?: boolean
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('[CopyPage ErrorBoundary] Caught error:', error)
      console.error('[CopyPage ErrorBoundary] Component stack:', errorInfo.componentStack)
    }

    // Call optional error handler
    this.props.onError?.(error, errorInfo)
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    const { hasError, error } = this.state
    const { children, fallback, showDetails = process.env.NODE_ENV === 'development' } = this.props

    if (hasError) {
      // Use custom fallback if provided
      if (fallback) {
        return fallback
      }

      // Default minimal fallback UI
      return (
        <div className={styles.errorContainer}>
          <span className={styles.errorIcon}>⚠</span>
          <span className={styles.errorText}>Copy unavailable</span>
          <button
            className={styles.retryButton}
            onClick={this.handleRetry}
            type="button"
            aria-label="Retry"
          >
            ↻
          </button>
          {showDetails && error && <div className={styles.errorDetails}>{error.message}</div>}
        </div>
      )
    }

    return children
  }
}

/**
 * Functional wrapper for ErrorBoundary with sensible defaults
 */
interface CopyPageErrorBoundaryProps {
  children: ReactNode
}

export function CopyPageErrorBoundary({ children }: CopyPageErrorBoundaryProps): ReactNode {
  return (
    <ErrorBoundary
      onError={(error) => {
        // Could integrate with error reporting service here
        console.warn('[CopyPage] Feature error:', error.message)
      }}
    >
      {children}
    </ErrorBoundary>
  )
}
