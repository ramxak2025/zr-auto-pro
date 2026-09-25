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
          <div className="mb-4 rounded-full bg-bad-soft p-3">
            <AlertTriangle className="h-8 w-8 text-bad" aria-hidden="true" />
          </div>
          <h2 className="mb-2 text-lg font-semibold text-ink">
            {this.state.isChunkError ? 'Приложение обновилось' : 'Произошла ошибка'}
          </h2>
          <p className="mb-6 max-w-md text-sm text-ink-3">
            {this.state.isChunkError
              ? 'Доступна новая версия. Перезагрузите страницу.'
              : this.state.error?.message || 'Непредвиденная ошибка.'}
          </p>
          <div className="flex gap-3">
            {this.state.isChunkError ? (
              <button type="button" onClick={this.handleHardReload} className="btn-primary">
                <RefreshCw className="w-4 h-4" />
                Перезагрузить
              </button>
            ) : (
              <>
                <button type="button" onClick={this.handleRetry} className="btn-primary">
                  Попробовать снова
                </button>
                <button type="button" onClick={this.handleHardReload} className="btn-secondary">
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
