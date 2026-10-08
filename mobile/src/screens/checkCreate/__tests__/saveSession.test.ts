import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { QueryClient, MutationObserver } from '@tanstack/react-query';
import type { InternalAxiosRequestConfig } from 'axios';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiUrl: 'https://test.invalid/api', apiFallbackUrls: [] } } },
}));
const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockDisk.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mockDisk.set(key, value);
    },
    removeItem: async (key: string) => {
      mockDisk.delete(key);
    },
    getAllKeys: async () => [...mockDisk.keys()],
  },
}));

/** Execute the actual screen callback and loop without replacing them with a
 * test copy, while keeping native rendering out of this behavioral harness. */
function screenFunction<T>(
  variable: string,
  property: string | null,
  scope: Record<string, unknown>,
  filename = 'CheckCreateScreen.tsx',
): T {
  const file = path.join(__dirname, '../..', filename);
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === variable && node.initializer) {
      if (!property) expression = node.initializer;
      else if (ts.isCallExpression(node.initializer)) {
        const options = node.initializer.arguments[0];
        if (options && ts.isObjectLiteralExpression(options))
          for (const p of options.properties)
            if (ts.isPropertyAssignment(p) && p.name.getText(source) === property) expression = p.initializer;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!expression) throw new Error(`Missing actual callback ${variable}.${property}`);
  const js = ts.transpileModule(`const callback = ${expression.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return Function(...Object.keys(scope), `${js}; return callback;`)(...Object.values(scope)) as T;
}
const owner = (id: string) => ({ tenantId: 'tenant-' + id, userId: id, pointId: 'point-' + id });
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

it.each([false, true])(
  'actual saved-check callback never sends the next photo/convert after A→B%s',
  async (backToA) => {
    jest.resetModules();
    mockDisk.clear();
    const transport = jest.requireActual('../../../api/axios') as typeof import('../../../api/axios');
    const data = jest.requireActual('../../../contexts/dataSession') as typeof import('../../../contexts/dataSession');
    const factories = jest.requireActual(
      '../../../../../shared/api/createServices',
    ) as typeof import('../../../../../shared/api/createServices');
    const boundary = jest.requireActual(
      '../../../contexts/sessionQueryBoundary',
    ) as typeof import('../../../contexts/sessionQueryBoundary');
    data.setDataSession(owner('A'));
    transport.setAuthToken('same-A', true);
    const first = gate<void>();
    let entered = false;
    const sent: InternalAxiosRequestConfig[] = [];
    transport.default.defaults.adapter = async (config) => {
      sent.push(config);
      if (sent.length === 1) {
        entered = true;
        await first.promise;
      }
      return { config, data: { id: 'photo-id' }, status: 200, statusText: 'OK', headers: {} };
    };
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const detach = boundary.attachSessionMutationBoundary(qc);
    const markFormSaved = jest.fn(),
      navigate = jest.fn(),
      alert = jest.fn(),
      offline = jest.fn();
    const scope: Record<string, unknown> = {
      queryClient: qc,
      submittingRef: { current: true },
      confirmedSavedCheckRef: { current: null },
      markFormSaved,
      haptic: jest.fn(),
      pendingPhotos: ['file:first.jpg', 'file:second.jpg'],
      editId: undefined,
      orderMode: false,
      clientId: undefined,
      selectedClient: undefined,
      firstBoardColumnKey: undefined,
      isFromBooking: true,
      bookingId: 'booking-A',
      isStackScreen: true,
      isEditingClosed: false,
      navigation: { navigate, goBack: navigate },
      resetForm: jest.fn(),
      Alert: { alert },
      setUploadingUris: jest.fn(),
      buildPhotoFormData: (uri: string) => uri,
      checkPhotosApi: factories.createCheckPhotosApi(transport.default),
      bookingsApi: factories.createBookingsApi(transport.default),
      checksApi: factories.createChecksApi(transport.default),
      loyaltyApi: factories.createLoyaltyApi(transport.default),
      captureDataSession: data.captureDataSession,
      console: { warn: jest.fn() },
    };
    // Optional production helper is added by the fix; the baseline executes
    // the unchanged onSuccess/loop and fails the same no-second-dispatch check.
    const helperPath = path.join(__dirname, '../saveSession.ts');
    if (fs.existsSync(helperPath)) {
      Object.assign(scope, jest.requireActual('../saveSession'));
      Object.assign(scope, jest.requireActual('../../../utils/pendingCheckPhotos'));
    }
    scope.uploadPendingForCheck = screenFunction('uploadPendingForCheck', null, scope);
    const success = screenFunction<(res: { data: { id: string } }) => Promise<void>>(
      'createMutation',
      'onSuccess',
      scope,
    );
    const result = { data: { id: 'saved-A' } };
    const observer = new MutationObserver(qc, { mutationFn: async () => result, onSuccess: success, onError: offline });
    const unsubscribe = observer.subscribe(() => {});
    const work = observer.mutate(undefined);
    for (let i = 0; i < 1000 && !entered; i++) await Promise.resolve();
    expect(entered).toBe(true);
    data.setDataSession(owner('B'));
    transport.setAuthToken('B', true);
    if (backToA) {
      data.setDataSession(owner('A'));
      transport.setAuthToken('same-A', true);
    }
    first.resolve();
    await expect(work).resolves.toBe(result);
    expect(markFormSaved).toHaveBeenCalledTimes(1);
    expect(sent.map((r) => [r.url, r.headers.Authorization])).toEqual([['/check-photos/saved-A', 'Bearer same-A']]);
    const retained = [...mockDisk.entries()];
    expect(retained).toHaveLength(1);
    expect(JSON.parse(retained[0][1])).toMatchObject({
      checkId: 'saved-A',
      owner: owner('A'),
      photos: [
        { uri: 'file:first.jpg', state: 'uncertain' },
        { uri: 'file:second.jpg', state: 'pending' },
      ],
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
    expect(offline).not.toHaveBeenCalled();
    unsubscribe();
    detach();
    qc.clear();
  },
);

it.each([
  ['PurchaseOrderCreateScreen.tsx', 'saveMutation', 'onSuccess', { data: { id: 'A' } }],
  ['AcceptPaymentScreen.tsx', 'payMutation', 'onSuccess', undefined],
  ['BookingCreateScreen.tsx', 'createMutation', 'onSuccess', { data: {} }],
  ['BookingDetailScreen.tsx', 'cancelMutation', 'onSuccess', undefined],
  ['CheckDetailScreen.tsx', 'acceptPaymentMutation', 'onSuccess', undefined],
  ['ProfileScreen.tsx', 'saveMutation', 'onSuccess', { data: { status: 'applied' } }],
  ['WorkBoardScreen.tsx', 'moveMutation', 'onMutate', { id: 'a', target: 'done' }],
  ['CompanySettingsScreen.tsx', 'mutation', 'onMutate', { enabled: true }],
] as const)(
  'actual %s %s.%s stops cache/navigation continuation after an awaited boundary',
  async (file, variable, property, input) => {
    jest.resetModules();
    const data = jest.requireActual('../../../contexts/dataSession') as typeof import('../../../contexts/dataSession');
    data.setDataSession(owner('A'));
    const waiting = gate<void>();
    let entered = false;
    const awaitBoundary = jest.fn(() => {
      entered = true;
      return waiting.promise;
    });
    const setData = jest.fn(),
      getData = jest.fn(),
      navigate = jest.fn(),
      alert = jest.fn();
    const scope = {
      captureDataSession: data.captureDataSession,
      queryClient: {
        invalidateQueries: awaitBoundary,
        refetchQueries: awaitBoundary,
        cancelQueries: awaitBoundary,
        setQueryData: setData,
        getQueryData: getData,
      },
      id: 'A',
      bookingId: 'A',
      boardKey: ['board'],
      VIN_SETTINGS_KEY: ['vin'],
      POS_SETTINGS_KEY: ['pos'],
      haptic: jest.fn(),
      navigation: { replace: navigate, goBack: navigate },
      Alert: { alert },
      setConflictNote: jest.fn(),
      setSavedConflict: jest.fn(),
      setStagedAvatar: jest.fn(),
      refreshUser: awaitBoundary,
      invalidateEmployeeAvatarQueries: jest.fn(),
      user: { id: 'A' },
      isEdit: false,
    };
    const callback = screenFunction<(arg: unknown) => Promise<unknown>>(variable, property, scope, file);
    const done = callback(input).catch((e: { code: string }) => e.code);
    expect(entered).toBe(true);
    data.setDataSession(owner('B'));
    data.setDataSession(owner('A'));
    waiting.resolve();
    await done;
    expect(setData).not.toHaveBeenCalled();
    expect(getData).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
    expect(awaitBoundary).toHaveBeenCalledTimes(1);
  },
);

it('manual recovery reads only A and uploads only the explicitly selected photo to the existing check', async () => {
  jest.resetModules();
  mockDisk.clear();
  const transport = jest.requireActual('../../../api/axios') as typeof import('../../../api/axios');
  const data = jest.requireActual('../../../contexts/dataSession') as typeof import('../../../contexts/dataSession');
  const recovery = jest.requireActual(
    '../../../utils/pendingCheckPhotos',
  ) as typeof import('../../../utils/pendingCheckPhotos');
  const { captureCheckSaveSession } = jest.requireActual('../saveSession') as typeof import('../saveSession');
  data.setDataSession(owner('A'));
  transport.setAuthToken('A', true);
  const old = data.captureDataSession();
  await recovery.updatePendingCheckPhotos('saved-A', old, () => [
    { uri: 'file:uncertain.jpg', state: 'uncertain' },
    { uri: 'file:unsent.jpg', state: 'pending' },
  ]);
  data.setDataSession(owner('B'));
  transport.setAuthToken('B', true);
  expect(await recovery.readPendingCheckPhotos('saved-A', data.captureDataSession())).toBeNull();
  await expect(recovery.readPendingCheckPhotos('saved-A', old)).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  data.setDataSession(owner('A'));
  transport.setAuthToken('A', true);
  const operation = captureCheckSaveSession();
  const sent: InternalAxiosRequestConfig[] = [];
  transport.default.defaults.adapter = async (config) => {
    sent.push(config);
    return { config, data: { id: 'photo' }, status: 200, statusText: 'OK', headers: {} };
  };
  class NativeFormData {
    append() {}
  }
  const callback = screenFunction<(arg: { uri: string; discard: boolean }) => Promise<void>>(
    'recoverPhotoMutation',
    'mutationFn',
    { photoSession: operation, id: 'saved-A', ...recovery, FormData: NativeFormData },
    'CheckDetailScreen.tsx',
  );
  await callback({ uri: 'file:unsent.jpg', discard: false });
  expect(sent.map((r) => [r.url, r.headers.Authorization])).toEqual([['/check-photos/saved-A', 'Bearer A']]);
  expect((await recovery.readPendingCheckPhotos('saved-A', operation.data))?.photos).toEqual([
    { uri: 'file:uncertain.jpg', state: 'uncertain' },
  ]);
  await callback({ uri: 'file:uncertain.jpg', discard: true });
  expect(await recovery.readPendingCheckPhotos('saved-A', operation.data)).toBeNull();
  expect(sent).toHaveLength(1);
});

it('Save after an already confirmed check/photo failure opens that check, never submits a second financial document', () => {
  const navigate = jest.fn(),
    mutate = jest.fn();
  const submit = screenFunction<() => void>('handleSubmit', null, {
    submittingRef: { current: false },
    createMutation: { isPending: false, mutate },
    editId: undefined,
    confirmedSavedCheckRef: { current: 'saved-A' },
    navigation: { navigate },
  });
  submit();
  expect(navigate).toHaveBeenCalledWith('CheckDetail', { id: 'saved-A' });
  expect(mutate).not.toHaveBeenCalled();
});
