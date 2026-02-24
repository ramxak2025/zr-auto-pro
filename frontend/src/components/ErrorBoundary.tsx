import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Optional fallback UI to show instead of default error screen */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isChunkError: boolean;
}

/**
 * Detects if an error is a chunk/module load failure
 * (happens after deployment when old cached HTML references non-existent JS chunks)
 */
function isChunkLoadError(error: Error): boolean {
  const msg = error.message || '';
  const name = error.name || '';
  return (
    name === 'ChunkLoadError' ||
    msg.includes('Loading chunk') ||
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading dynamically imported module')
  );
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, isChunkError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      isChunkError: isChunkLoadError(error),
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // For chunk load errors, try a single hard reload to get fresh assets
    if (isChunkLoadError(error)) {
      const reloadKey = 'eb_chunk_reload';
      const lastReload = sessionStorage.getItem(reloadKey);
      // Only auto-reload once per session to avoid infinite reload loops
      if (!lastReload) {
        sessionStorage.setItem(reloadKey, Date.now().toString());
        window.location.reload();
      }
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, isChunkError: false });
  };

  handleHardReload = () => {
    // Clear the reload guard so the next error can also trigger reload
    sessionStorage.removeItem('eb_chunk_reload');
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] py-12 text-center px-4">
          <div className="mb-4 p-3 bg-red-100 rounded-full">
            <AlertTriangle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            {this.state.isChunkError ? 'Приложение обновилось' : 'Произошла ошибка'}
          </h2>
          <p className="text-sm text-gray-500 max-w-md mb-6">
            {this.state.isChunkError
              ? 'Доступна новая версия. Перезагрузите страницу.'
              : this.state.error?.message || 'Непредвиденная ошибка.'}
          </p>
          <div className="flex gap-3">
            {this.state.isChunkError ? (
              <button onClick={this.handleHardReload} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 transition-colors">
                <RefreshCw className="w-4 h-4" />
                Перезагрузить
              </button>
            ) : (
              <>
                <button onClick={this.handleRetry} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 transition-colors">
                  Попробовать снова
                </button>
                <button onClick={this.handleHardReload} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                  <RefreshCw className="w-4 h-4" />
                  Перезагрузить
                </button>
              </>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
