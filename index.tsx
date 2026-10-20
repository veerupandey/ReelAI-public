// @ts-nocheck
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { ScriptStudioProvider } from './components/ScriptStudio/ScriptStudioContext';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}
interface GlobalErrorBoundaryProps {
  children: React.ReactNode;
}

interface GlobalErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class GlobalErrorBoundary extends React.Component<GlobalErrorBoundaryProps, GlobalErrorBoundaryState> {
  state: GlobalErrorBoundaryState = { hasError: false, error: null };

  constructor(props: GlobalErrorBoundaryProps) {
    super(props);
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', color: 'white', backgroundColor: '#333', height: '100vh' }}>
          <h1>Something went wrong.</h1>
          <pre style={{ color: 'red', marginTop: '10px', whiteSpace: 'pre-wrap' }}>
            {this.state.error?.toString()}
          </pre>
          <p>Check the console for more details.</p>
        </div>
      );
    }

    return this.props.children;
  }
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <GlobalErrorBoundary>
    <AuthProvider>
      <ScriptStudioProvider>
        <App />
      </ScriptStudioProvider>
    </AuthProvider>
  </GlobalErrorBoundary>
);
