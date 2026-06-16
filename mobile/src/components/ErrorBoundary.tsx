import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../theme';
import { captureException } from '../sentry';

interface Props {
  children: ReactNode;
  /**
   * When any value here changes between renders, a previously-caught error is
   * cleared automatically. Pass e.g. `[route.key]` so re-entering a screen — or
   * a data dependency changing — retries the render instead of stranding the
   * user on the fallback. Compared with `Object.is`, matching React's own
   * reconciliation semantics.
   */
  resetKeys?: ReadonlyArray<unknown>;
  /** Invoked whenever the boundary clears its error (manual retry or resetKeys). */
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/** True when the two key arrays differ by length or by any `Object.is` slot. */
function resetKeysChanged(a?: ReadonlyArray<unknown>, b?: ReadonlyArray<unknown>): boolean {
  if (a === b) return false;
  if (!a || !b || a.length !== b.length) return true;
  return a.some((value, i) => !Object.is(value, b[i]));
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
    // Forward to Sentry (guarded no-op when no DSN / dev build).
    captureException(error, { componentStack: info.componentStack });
  }

  componentDidUpdate(prevProps: Props) {
    // Auto-recover once the caller signals the underlying cause may be gone
    // (navigated back into the screen, query refetched, …). Without this the
    // user would be stuck on the fallback until they tapped «Попробовать снова».
    if (this.state.hasError && resetKeysChanged(prevProps.resetKeys, this.props.resetKeys)) {
      this.reset();
    }
  }

  private reset() {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  }

  handleReset = () => {
    this.reset();
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Что-то пошло не так</Text>
          <Text style={styles.message}>{this.state.error?.message || 'Произошла непредвиденная ошибка'}</Text>
          <TouchableOpacity style={styles.button} onPress={this.handleReset}>
            <Text style={styles.buttonText}>Попробовать снова</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

/**
 * React Navigation `screenLayout` helper: wraps every screen in a navigator in
 * its own ErrorBoundary, so a render-time crash stays contained to that one
 * screen instead of bubbling to the single root boundary and blanking the whole
 * app. `resetKeys={[route.key]}` auto-clears the error when the user re-enters
 * the screen. Stable module-scope identity — safe to pass directly as the
 * `screenLayout` prop without remounting screens.
 *
 * Usage: `<Stack.Navigator screenLayout={screenErrorBoundaryLayout}>`
 */
export function screenErrorBoundaryLayout({
  route,
  children,
}: {
  route: { key: string };
  children: ReactNode;
}): React.ReactElement {
  return <ErrorBoundary resetKeys={[route.key]}>{children}</ErrorBoundary>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[6],
    backgroundColor: colors.white,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
    marginBottom: spacing[3],
  },
  message: {
    fontSize: fontSize.sm,
    color: colors.gray[500],
    textAlign: 'center',
    marginBottom: spacing[6],
  },
  button: {
    backgroundColor: colors.primary[600],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[6],
    borderRadius: borderRadius.xl,
  },
  buttonText: {
    color: colors.white,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
});
