import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

/**
 * Top-level error boundary. Catches unhandled render errors anywhere in the
 * React tree and shows a recovery UI instead of a white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log to console — in production consider sending to an error reporting service.
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '2rem',
          fontFamily: 'var(--font-family, system-ui, sans-serif)',
          color: 'var(--text-color, #333)',
          textAlign: 'center',
        }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
          <p style={{ marginBottom: '1.5rem', color: 'var(--text-color-secondary, #666)', maxWidth: '400px' }}>
            An unexpected error occurred. This has been logged. Please refresh the page or try again.
          </p>
          <button
            onClick={this.handleReset}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '4px',
              border: '1px solid var(--surface-border, #ccc)',
              background: 'var(--surface-ground, #f5f5f5)',
              color: 'var(--text-color, #333)',
              cursor: 'pointer',
              fontSize: '0.875rem',
              marginRight: '0.5rem',
            }}
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '4px',
              border: 'none',
              background: 'var(--primary-color, #3B82F6)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            Refresh page
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
