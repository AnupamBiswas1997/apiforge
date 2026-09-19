/**
 * client/src/components/ErrorBoundary.jsx
 * Catches render errors and shows a recovery UI.
 * Class component required by React error boundary API.
 */

import React from 'react'

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // In production you'd send this to an error reporting service
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-8">
        <div className="bg-surface border border-red/40 rounded-xl p-8 max-w-lg w-full text-center shadow-lg">
          <div className="text-red text-4xl mb-4" aria-hidden="true">⚠</div>
          <h2 className="text-lg font-semibold text-white mb-2">Something went wrong</h2>
          <p className="text-muted text-sm mb-6 font-mono break-words leading-relaxed">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 bg-surface border border-border rounded-md text-sm text-white hover:border-cyan/50 transition-colors"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.href = '/'}
              className="px-4 py-2 bg-cyan/10 border border-cyan/30 rounded-md text-sm text-cyan hover:bg-cyan/20 transition-colors"
            >
              Go to home
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
