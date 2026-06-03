import { registerRootComponent } from 'expo';
import App from './App';
import { initSentry, Sentry } from './src/sentry';

// Initialise crash reporting before anything renders. No-op when no DSN is set
// (default), so dev/builds without a DSN are unaffected.
initSentry();

// When Sentry is disabled, `Sentry.wrap` is a transparent pass-through, so the
// component tree and behaviour are unchanged.
registerRootComponent(Sentry.wrap(App));
