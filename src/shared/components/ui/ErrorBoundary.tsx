import {trackEvent} from "@/utils/IrisAPI"
import React from "react"

interface ErrorBoundaryState {
  hasError: boolean
  errorMessage?: string
  stack?: string
}

interface ErrorBoundaryProps {
  children: React.ReactNode
}

export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {hasError: false}
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {hasError: true, errorMessage: error.message, stack: error.stack}
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Caught an error:", error, errorInfo)
    trackEvent("error_boundary", {
      error_message: error.message,
      component_stack: errorInfo.componentStack || "unknown",
    })
  }

  render() {
    if (this.state.hasError) {
      // Render any custom fallback UI with the error message
      return (
        <div className="p-2">
          <div className="max-w-md md:max-w-lg lg:max-w-xl overflow-x-scroll">
            <button
              onClick={() => window.location.reload()}
              className="btn btn-primary mb-4"
            >
              Reload Page
            </button>
            <h1>Something went wrong.</h1>
            <p className="break-all whitespace-pre font-mono text-sm">
              Error: {this.state.errorMessage}
            </p>
            <pre className="text-xs mt-8 break-all whitespace-pre font-mono">
              {this.state.stack}
            </pre>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
