import type { NavigationAction, NavigationState } from '@react-navigation/native';

/** A root-stack overlay blurs Main without changing the selected tab. */
export function getMoreTabBlurAction(state: Pick<NavigationState, 'index' | 'routes'>): NavigationAction | null {
  const selected = state.routes[state.index];
  if (!selected || selected.name === 'MoreTab') return null;

  const inner = state.routes.find((route) => route.name === 'MoreTab')?.state;
  if (!inner?.key || !Array.isArray(inner.routes)) return null;
  if (inner.routes[0]?.name !== 'MoreHome') {
    return {
      type: 'RESET',
      payload: { index: 0, routes: [{ name: 'MoreHome' }] },
      target: inner.key,
    };
  }
  return (inner.index ?? inner.routes.length - 1) > 0 ? { type: 'POP_TO_TOP', target: inner.key } : null;
}
