import React from 'react';
const mockRequests = jest.fn(async (_status?: string, _page?: number) => ({ data: [] }));
const mockState = { page: 1 };
let mockOptions: { queryFn: () => Promise<unknown>; queryKey: unknown[] };
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: () => [
    mockState.page,
    (next: number | ((n: number) => number)) => {
      mockState.page = typeof next === 'function' ? next(mockState.page) : next;
    },
  ],
  useEffect: jest.fn(),
  useMemo: (fn: () => unknown) => fn(),
  useRef: (current: unknown) => ({ current }),
}));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5 },
}));
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: { pendingOnly: true } }),
  useNavigation: () => ({ goBack: jest.fn() }),
}));
jest.mock('@tanstack/react-query', () => ({
  useQuery: (options: typeof mockOptions) => {
    mockOptions = options;
    return {
      data: Array.from({ length: mockState.page === 1 ? 200 : 5 }, (_, i) => ({
        id: String(i),
        status: 'pending',
        name: 'Synthetic',
        phone: '',
        services: [],
        startsAt: '2026-10-26T10:00:00Z',
      })),
      isLoading: false,
      isError: false,
      isFetching: false,
    };
  },
  useMutation: () => ({}),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'self', currentPointId: 'point' }, token: 'synthetic', hasPermission: () => true }),
}));
jest.mock('../../../contexts/ThemeContext', () => ({
  useColors: () => ({
    bg: { canvas: '#fff', card: '#fff' },
    text: { primary: '#111', secondary: '#444' },
    border: { subtle: '#ccc' },
  }),
}));
jest.mock('../../../api/axios', () => ({ createSessionBoundClient: () => ({}) }));
jest.mock('../../../../../shared/api/createServices', () => ({
  createBookingsApi: () => ({ requests: mockRequests }),
  createClientsApi: () => ({}),
}));
jest.mock('../../../components/IosScreenHeader', () => 'Header');
jest.mock('../../../components/QueryErrorState', () => 'Error');
jest.mock('../../../components/TabBarScrollable', () => ({ TabBarScrollView: 'ScrollView' }));
jest.mock('../../../components/Toast', () => ({ showMutationErrorToast: jest.fn() }));
jest.mock('expo-crypto', () => ({}));
import PublicBookingRequestsScreen from '../../PublicBookingRequestsScreen';
function nodes(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(nodes)];
}
test('native inbox next/back controls send actual page2 request; bounded second page disables next', async () => {
  mockState.page = 1;
  let tree = PublicBookingRequestsScreen({});
  await mockOptions.queryFn();
  expect(mockRequests).toHaveBeenLastCalledWith('pending', 1);
  let next = nodes(tree).find((n) => n.props.label === 'Далее');
  expect(next?.props.disabled).toBe(false);
  (next?.props.onPress as () => void)();
  tree = PublicBookingRequestsScreen({});
  await mockOptions.queryFn();
  expect(mockRequests).toHaveBeenLastCalledWith('pending', 2);
  expect(mockOptions.queryKey).toContain(2);
  next = nodes(tree).find((n) => n.props.label === 'Далее');
  expect(next?.props.disabled).toBe(true);
  (nodes(tree).find((n) => n.props.label === 'Назад')?.props.onPress as () => void)();
  PublicBookingRequestsScreen({});
  await mockOptions.queryFn();
  expect(mockRequests).toHaveBeenLastCalledWith('pending', 1);
});
