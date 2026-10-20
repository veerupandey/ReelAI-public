// @ts-nocheck
import React, { ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null
        };
    }

    public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
        return { hasError: true, error, errorInfo: null };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        console.error("Uncaught error:", error, errorInfo);
        this.setState({ errorInfo });
    }

    public render(): ReactNode {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="p-6 bg-red-900/20 border border-red-500/50 rounded-xl text-white max-w-2xl mx-auto mt-10">
                    <h2 className="text-xl font-bold mb-4 text-red-400">Something went wrong</h2>
                    <p className="mb-4 text-white/80">The application encountered an error and could not render this section.</p>

                    {this.state.error && (
                        <div className="bg-black/50 p-4 rounded-lg overflow-auto mb-4">
                            <p className="font-mono text-sm text-red-300 whitespace-pre-wrap">{this.state.error.toString()}</p>
                        </div>
                    )}

                    {this.state.errorInfo && (
                        <details className="mb-4">
                            <summary className="cursor-pointer text-white/60 hover:text-white mb-2">Component Stack</summary>
                            <div className="bg-black/50 p-4 rounded-lg overflow-auto max-h-60">
                                <pre className="font-mono text-xs text-white/50 whitespace-pre-wrap">
                                    {this.state.errorInfo.componentStack}
                                </pre>
                            </div>
                        </details>
                    )}

                    <button
                        onClick={() => window.location.reload()}
                        className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg font-semibold transition"
                    >
                        Reload Application
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
