const mockStates: unknown[] = [];
const mockRefs: { current: unknown }[] = [];
const mockDeps: unknown[][] = [];
const mockEffects: (() => void)[] = [];
let mockIndex = 0;
let mockEpoch = 0;
let mockAuth = {
  user: { id: 'owner-A', currentPointId: 'point-A', tenant: { name: 'QA' } },
  token: 'token-A',
  hasPermission: () => true,
};
const mockPicker = jest.fn();
const mockConvert = jest.fn();
const mockUpload = jest.fn();
const mockToast = jest.fn();
const mockGoBack = jest.fn();
const mockMutate = jest.fn();
const mockQueryClient = { setQueryData: jest.fn() };
const mockSettings = {
  logoUrl: null,
  backgroundImageUrl: null,
  displayName: 'QA',
  address: 'QA',
  contacts: 'QA',
  services: [],
  resourceIds: [],
  openingHours: {},
};

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockStates))
      mockStates[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [
      mockStates[index],
      (next: unknown) => {
        mockStates[index] =
          typeof next === 'function' ? (next as (mockPrevious: unknown) => unknown)(mockStates[index]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = mockIndex++;
    return mockRefs[index] ?? (mockRefs[index] = { current: initial });
  },
  useMemo: (factory: () => unknown) => {
    mockIndex++;
    return factory();
  },
  useEffect: (effect: () => void, deps: unknown[]) => {
    const index = mockIndex++;
    if (!mockDeps[index] || deps.some((value, offset) => value !== mockDeps[index][offset])) {
      mockDeps[index] = deps;
      mockEffects.push(effect);
    }
  },
}));
jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Share: { share: jest.fn() },
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  Switch: 'Switch',
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => mockQueryClient,
  useQuery: (options: { queryKey: string[] }) => ({
    data: options.queryKey[1] === 'public-settings' ? mockSettings : [],
    isLoading: false,
    isError: false,
  }),
  useMutation: () => ({ isPending: false, mutate: mockMutate }),
}));
jest.mock('expo-image-picker', () => ({
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
  launchImageLibraryAsync: (...args: unknown[]) => mockPicker(...args),
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  manipulateAsync: (...args: unknown[]) => mockConvert(...args),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: mockGoBack }) }));
jest.mock('../../components/IosScreenHeader', () => ({ __esModule: true, default: 'IosScreenHeader' }));
jest.mock('../../components/QueryErrorState', () => ({ __esModule: true, default: 'QueryErrorState' }));
jest.mock('../../components/TabBarScrollable', () => ({ TabBarScrollView: 'ScrollView' }));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../../api/axios', () => ({
  createSessionBoundClient: (token: string) => ({ token }),
  getImageUrl: (url: string) => url,
  captureAuthSession: () => {
    const captured = mockEpoch;
    return { isCurrent: () => captured === mockEpoch };
  },
}));
jest.mock('../../../../shared/api/createServices', () => ({
  createBookingsApi: (client: { token: string }) => ({
    uploadPublicBranding: (form: unknown) => mockUpload(form, client.token),
  }),
}));
jest.mock('../../contexts/ThemeContext', () => ({
  useColors: () => ({
    bg: { canvas: '#fff', card: '#fff' },
    text: { primary: '#111', secondary: '#555', tertiary: '#777' },
    border: { subtle: '#ddd' },
  }),
}));
jest.mock('../../theme', () => ({
  colors: {
    primary: { 50: '#eee', 600: '#2563eb', 700: '#1d4ed8' },
    red: { 600: '#dc2626' },
    gray: { 200: '#ddd', 600: '#555' },
    green: { 600: '#169b62' },
    white: '#fff',
  },
  spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 10: 40 },
  borderRadius: { md: 8 },
}));
jest.mock('../../components/Toast', () => ({ showMutationErrorToast: (...args: unknown[]) => mockToast(...args) }));

import React from 'react';
import PublicBookingSettingsScreen from '../PublicBookingSettingsScreen';

type Element = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;
class NativeFormData {
  parts: { name: string; value: unknown }[] = [];
  append(name: string, value: unknown) {
    this.parts.push({ name, value });
  }
}
const originalFormData = globalThis.FormData;
const nodes = (node: React.ReactNode): Element[] =>
  React.isValidElement(node)
    ? [node as Element, ...React.Children.toArray((node as Element).props.children).flatMap(nodes)]
    : [];
const words = (node: React.ReactNode): string =>
  typeof node === 'string'
    ? node
    : React.isValidElement(node)
      ? React.Children.toArray((node as Element).props.children)
          .map(words)
          .join(' ')
      : '';
const render = () => {
  mockIndex = 0;
  const tree = PublicBookingSettingsScreen({});
  while (mockEffects.length) mockEffects.shift()!();
  return tree;
};
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const pressUpload = (tree = render(), fieldIndex = 0) => {
  const button = nodes(tree).filter(
    (el) => el.type === 'TouchableOpacity' && ['Загрузить', 'Заменить'].includes(words(el)),
  )[fieldIndex];
  expect(button).toBeDefined();
  (button.props.onPress as () => void)();
};
const images = (tree = render()) =>
  nodes(tree)
    .filter((el) => el.type === 'Image')
    .map((el) => (el.props.source as { uri: string }).uri);
const descriptor = () => (mockUpload.mock.calls[0][0] as NativeFormData).parts[0];
const select = (mimeType = 'image/heic', fileSize = 100, fileName: string | null = 'QA.HEIC') => ({
  canceled: false,
  assets: [{ uri: 'file:///qa-original', mimeType, fileSize, fileName }],
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const change = (kind: 'account' | 'point' | 'token') => {
  mockEpoch++;
  mockAuth = {
    ...mockAuth,
    user: {
      ...mockAuth.user,
      ...(kind === 'account' ? { id: 'owner-B' } : kind === 'point' ? { currentPointId: 'point-B' } : {}),
    },
    ...(kind === 'account' || kind === 'token' ? { token: 'token-B' } : {}),
  };
  render();
  render();
};

beforeAll(() =>
  Object.defineProperty(globalThis, 'FormData', { value: NativeFormData, configurable: true, writable: true }),
);
afterAll(() =>
  Object.defineProperty(globalThis, 'FormData', { value: originalFormData, configurable: true, writable: true }),
);
beforeEach(() => {
  mockStates.length = 0;
  mockRefs.length = 0;
  mockDeps.length = 0;
  mockEffects.length = 0;
  mockIndex = 0;
  mockEpoch = 0;
  mockAuth = {
    user: { id: 'owner-A', currentPointId: 'point-A', tenant: { name: 'QA' } },
    token: 'token-A',
    hasPermission: () => true,
  };
  [mockPicker, mockConvert, mockUpload, mockToast, mockGoBack, mockMutate].forEach((fn) => fn.mockReset());
  mockPicker.mockResolvedValue(select());
  mockConvert.mockResolvedValue({ uri: 'file:///qa-compatible.jpg', width: 20, height: 20 });
  mockUpload.mockResolvedValue({ data: { url: '/api/uploads/qa.webp' } });
  render();
});

it.each(['image/jpeg', 'image/png', 'image/webp'])(
  'keeps %s original descriptor, explicitly requests Compatible, and updates only draft',
  async (mime) => {
    const fileName = `qa.${mime.split('/')[1]}`;
    mockPicker.mockResolvedValue(select(mime, 100, fileName));
    pressUpload();
    await flush();
    expect(mockPicker).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      quality: 1,
      preferredAssetRepresentationMode: 'compatible',
    });
    expect(mockConvert).not.toHaveBeenCalled();
    expect(descriptor()).toEqual({ name: 'file', value: { uri: 'file:///qa-original', name: fileName, type: mime } });
    expect(mockUpload.mock.calls[0][1]).toBe('token-A');
    expect(images()).toEqual(['/api/uploads/qa.webp']);
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
  },
);
it.each(['image/heic', 'image/heif', 'image/tiff'])('converts %s to local JPEG before FormData', async (mime) => {
  mockPicker.mockResolvedValue(select(mime));
  pressUpload(render(), 1);
  await flush();
  expect(mockConvert).toHaveBeenCalledWith('file:///qa-original', [], { format: 'jpeg', compress: 0.9 });
  expect(descriptor()).toEqual({
    name: 'file',
    value: { uri: 'file:///qa-compatible.jpg', name: 'branding.jpg', type: 'image/jpeg' },
  });
  expect(images()).toEqual(['/api/uploads/qa.webp']);
  expect(mockToast).not.toHaveBeenCalled();
});
it('conversion failure is recoverable and never posts or updates draft', async () => {
  const error = new Error('JPEG conversion failed');
  mockConvert.mockRejectedValue(error);
  pressUpload();
  await flush();
  expect(mockUpload).not.toHaveBeenCalled();
  expect(images()).toEqual([]);
  expect(mockToast).toHaveBeenCalledWith(error);
  expect(
    nodes(render())
      .filter((el) => el.type === 'TouchableOpacity' && words(el) === 'Загрузить')
      .every((el) => el.props.disabled === false),
  ).toBe(true);
});
it.each(['account', 'point', 'token'] as const)(
  '%s change during conversion drops obsolete operation, including A→B→A',
  async (kind) => {
    const pending = deferred<{ uri: string }>();
    mockConvert.mockReturnValue(pending.promise);
    pressUpload();
    await flush();
    expect(mockConvert).toHaveBeenCalledTimes(1);
    expect(mockUpload).not.toHaveBeenCalled();
    const original = mockAuth;
    change(kind);
    mockAuth = original;
    mockEpoch++;
    render();
    render();
    pending.resolve({ uri: 'file:///late.jpg' });
    await flush();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(images()).toEqual([]);
    expect(mockToast).not.toHaveBeenCalled();
  },
);
it('obsolete conversion rejection is silent after branch change', async () => {
  const pending = deferred<{ uri: string }>();
  mockConvert.mockReturnValue(pending.promise);
  pressUpload();
  await flush();
  change('point');
  pending.reject(new Error('old conversion failed'));
  await flush();
  expect(mockUpload).not.toHaveBeenCalled();
  expect(mockToast).not.toHaveBeenCalled();
  expect(images()).toEqual([]);
});
it('picker cancel / native Back produces no conversion, POST, draft or toast', async () => {
  const pending = deferred<unknown>();
  mockPicker.mockReturnValue(pending.promise);
  const tree = render();
  pressUpload(tree);
  (nodes(tree).find((el) => el.type === 'IosScreenHeader')!.props.onBack as () => void)();
  pending.resolve({ canceled: true, assets: null });
  await flush();
  expect(mockGoBack).toHaveBeenCalledTimes(1);
  expect(mockConvert).not.toHaveBeenCalled();
  expect(mockUpload).not.toHaveBeenCalled();
  expect(images()).toEqual([]);
  expect(mockToast).not.toHaveBeenCalled();
});
it('current picker failure is reported and lease change before selection prevents conversion and POST', async () => {
  const error = new Error('picker denied');
  mockPicker.mockRejectedValue(error);
  pressUpload();
  await flush();
  expect(mockToast).toHaveBeenCalledWith(error);
  expect(mockUpload).not.toHaveBeenCalled();
  mockToast.mockClear();
  const pending = deferred<unknown>();
  mockPicker.mockReturnValue(pending.promise);
  pressUpload(render());
  change('account');
  pending.resolve(select());
  await flush();
  expect(mockConvert).not.toHaveBeenCalled();
  expect(mockUpload).not.toHaveBeenCalled();
  expect(mockToast).not.toHaveBeenCalled();
});
it('supported asset over 5 MiB stops before POST; HEIC converts and relies on actual-byte server limit', async () => {
  mockPicker.mockResolvedValue(select('image/png', 5 * 1024 * 1024 + 1));
  pressUpload();
  await flush();
  expect(mockUpload).not.toHaveBeenCalled();
  expect(mockConvert).not.toHaveBeenCalled();
  expect(mockToast.mock.calls[0][0].message).toContain('5 МБ');
  mockToast.mockClear();
  const error = new Error('actual uploaded JPEG exceeds server byte limit');
  mockPicker.mockResolvedValue(select('image/heic', 6 * 1024 * 1024));
  mockUpload.mockRejectedValue(error);
  pressUpload(render());
  await flush();
  expect(mockConvert).toHaveBeenCalledTimes(1);
  expect(descriptor().value).toEqual({ uri: 'file:///qa-compatible.jpg', name: 'branding.jpg', type: 'image/jpeg' });
  expect(mockToast).toHaveBeenCalledWith(error);
  expect(images()).toEqual([]);
});
it.each(['resolve', 'reject'])(
  'late server %s after account change cannot mutate new draft or toast',
  async (outcome) => {
    const pending = deferred<{ data: { url: string } }>();
    mockUpload.mockReturnValue(pending.promise);
    pressUpload();
    await flush();
    expect(mockUpload).toHaveBeenCalledTimes(1);
    change('account');
    if (outcome === 'resolve') pending.resolve({ data: { url: '/api/uploads/old.webp' } });
    else pending.reject(new Error('old server rejection'));
    await flush();
    expect(images()).toEqual([]);
    expect(mockToast).not.toHaveBeenCalled();
  },
);

it('unknown MIME is converted instead of labelling possibly HEIC bytes as JPEG', async () => {
  mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///qa-original', fileName: 'QA.HEIC' }] });
  pressUpload();
  await flush();
  expect(mockConvert).toHaveBeenCalledWith('file:///qa-original', [], { format: 'jpeg', compress: 0.9 });
  expect(descriptor()).toEqual({
    name: 'file',
    value: { uri: 'file:///qa-compatible.jpg', name: 'branding.jpg', type: 'image/jpeg' },
  });
  expect(mockToast).not.toHaveBeenCalled();
});
