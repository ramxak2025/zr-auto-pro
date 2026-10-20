// Execute both real wrappers: screen mocks alone cannot verify that native
// dismissal callbacks are wired through to React Native's Modal.
import React from 'react';

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => [initial, jest.fn()],
  useRef: (initial: unknown) => ({ current: initial }),
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
  useEffect: jest.fn(),
}));
jest.mock('react-native', () => ({
  Modal: 'RNModal',
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  TextInput: 'TextInput',
  ScrollView: 'ScrollView',
  RefreshControl: 'RefreshControl',
  Pressable: 'Pressable',
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  Dimensions: { get: () => ({ height: 844, width: 390 }) },
  Platform: { OS: 'ios' },
  Animated: { Value: class {}, View: 'AnimatedView' },
  PanResponder: { create: () => ({ panHandlers: {} }) },
}));
jest.mock('react-native-keyboard-controller', () => ({
  KeyboardProvider: 'KeyboardProvider',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  KeyboardAwareScrollView: 'KeyboardAwareScrollView',
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 34 }) }));
jest.mock('@react-navigation/bottom-tabs', () => ({ BottomTabBarHeightContext: { Provider: 'TabProvider' } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-camera', () => ({ CameraView: 'CameraView', useCameraPermissions: () => [null, jest.fn()] }));
jest.mock('@shopify/flash-list', () => ({ FlashList: 'FlashList' }));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
  useQuery: () => ({ data: [], isLoading: false, isError: false, refetch: jest.fn() }),
}));
jest.mock('../../api/services', () => ({ productsApi: {} }));
jest.mock('../../api/axios', () => ({ getImageUrl: (value: string) => value }));
jest.mock('../../contexts/ThemeContext', () => ({
  useColors: () => ({
    bg: { elevated: '#fff', muted: '#eee' },
    border: { subtle: '#ddd', strong: '#ccc' },
    text: { primary: '#111', secondary: '#555', tertiary: '#777' },
    accent: { primary: '#2563eb' },
  }),
}));
jest.mock('../../platform/iosSurface', () => ({ buildShadow: () => ({}) }));
jest.mock('../../platform/haptics', () => ({ haptic: jest.fn() }));
jest.mock('../CachedImage', () => ({ __esModule: true, default: 'CachedImage' }));
jest.mock('../ModalBlurBackdrop', () => ({ __esModule: true, default: 'ModalBlurBackdrop' }));
jest.mock('../Skeleton', () => ({ ListSkeleton: 'ListSkeleton' }));
jest.mock('../QueryErrorState', () => ({ __esModule: true, default: 'QueryErrorState' }));

import Modal from '../Modal';
import ProductPickerModal from '../ProductPickerModal';

type NativeModal = React.ReactElement<{ onDismiss?: () => void; onRequestClose: () => void }>;
it.each(['editor', 'picker'] as const)('%s forwards native dismissal separately from close requests', (kind) => {
  const onClose = jest.fn();
  const onDismiss = jest.fn();
  const tree = (
    kind === 'editor'
      ? Modal({ visible: false, title: 'Акция', children: null, onClose, onDismiss })
      : ProductPickerModal({ visible: false, onSelectProduct: jest.fn(), onClose, onDismiss })
  ) as NativeModal;
  expect(tree.type).toBe('RNModal');
  tree.props.onRequestClose();
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onDismiss).not.toHaveBeenCalled();
  tree.props.onDismiss!();
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it.each(['editor', 'picker'] as const)('%s keeps dismissal optional for existing callers', (kind) => {
  const tree = (
    kind === 'editor'
      ? Modal({ visible: false, title: 'Акция', children: null, onClose: jest.fn() })
      : ProductPickerModal({ visible: false, onSelectProduct: jest.fn(), onClose: jest.fn() })
  ) as NativeModal;
  expect(tree.props.onDismiss).toBeUndefined();
});
