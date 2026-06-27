/**
 * BarcodeScanner — reusable full-screen barcode scanner (expo-camera).
 *
 * Used by the Склад screen («Сканировать» → найти товар по штрих-коду) and the
 * Инвентаризация screen (scan-to-increment a product's counted quantity).
 *
 * ── Graceful degradation (pre-rebuild) ───────────────────────────────────
 * expo-camera's native module («ExpoCamera») is linked into the binary only
 * after `expo prebuild` + a native rebuild. If the JS bundle runs on an OLDER
 * binary that predates the camera link, `expo-camera`'s eager
 * `requireNativeModule('ExpoCamera')` (inside ExpoCameraManager) THROWS at
 * import time. We therefore `require()` the module behind a try/catch instead
 * of a static `import`, so a missing native module degrades to a friendly
 * «Доступно после обновления приложения» card instead of crashing the screen.
 *
 * `isBarcodeScannerAvailable` lets callers decide whether to even surface the
 * scan affordance; the component itself also renders the fallback when opened
 * on a binary without the native module.
 *
 * ── Platform ──────────────────────────────────────────────────────────────
 * expo-camera works on both iOS and Android — no platform fork needed. Camera
 * permission strings live in `app.json` (NSCameraUsageDescription /
 * expo-camera plugin cameraPermission).
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, Modal as RNModal, Linking, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
// Type-only import — erased at compile time, so it NEVER emits a runtime
// `require('expo-camera')` and is safe even when the native module is absent.
import type { BarcodeType, BarcodeScanningResult } from 'expo-camera';
import { Text } from '../platform/Typography';
import { colors, fontWeight, borderRadius, spacing } from '../theme';
import { haptic } from '../platform/haptics';

// Guarded lazy require — see file header. A static `import` would crash the
// whole bundle eval on a binary without the native module; require() lets us
// catch that and fall back.
type ExpoCameraModule = typeof import('expo-camera');
let ExpoCamera: ExpoCameraModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  ExpoCamera = require('expo-camera') as ExpoCameraModule;
} catch {
  ExpoCamera = null;
}

/** True only when expo-camera's native module is linked AND its API is present. */
export const isBarcodeScannerAvailable = !!(ExpoCamera && ExpoCamera.CameraView && ExpoCamera.useCameraPermissions);

// Barcode symbologies relevant to retail / warehouse goods (EAN/UPC) plus
// Code-128/39 (logistics labels) and QR for custom internal codes.
const BARCODE_TYPES: BarcodeType[] = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'];

export interface BarcodeScannerProps {
  visible: boolean;
  /** Dismiss (cancel / system back). */
  onClose: () => void;
  /** Fired once per scan session with the decoded payload string. */
  onScanned: (code: string) => void;
  /** Hint line under the reticle. */
  hint?: string;
}

/**
 * Inner scanner — only mounted when `isBarcodeScannerAvailable` is true, so the
 * camera hooks below are always called against a present native module (no
 * conditional-hook violation: this component is mounted/unmounted as a whole).
 */
function ScannerInner({
  onClose,
  onScanned,
  hint,
}: {
  onClose: () => void;
  onScanned: (code: string) => void;
  hint: string;
}) {
  const Camera = ExpoCamera as ExpoCameraModule;
  const { CameraView, useCameraPermissions } = Camera;
  const [permission, requestPermission] = useCameraPermissions();
  // CameraView fires onBarcodeScanned continuously while a code is in frame —
  // latch so the parent's onScanned runs exactly once per open.
  const handledRef = useRef(false);

  // Auto-request permission once when still undetermined, so the user lands on
  // the system prompt immediately instead of a "no access" wall.
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (handledRef.current || !result?.data) return;
      handledRef.current = true;
      haptic('success');
      onScanned(result.data);
    },
    [onScanned],
  );

  // Permission still loading.
  if (!permission) {
    return (
      <View style={styles.center}>
        <Ionicons name="camera-outline" size={40} color={colors.gray[400]} />
      </View>
    );
  }

  // Denied — branch on whether we can still ask (in-app prompt) vs. must send
  // the user to Settings.
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Ionicons name="camera-outline" size={48} color={colors.gray[300]} />
        <Text variant="title3" color={colors.white} style={styles.deniedTitle}>
          Нет доступа к камере
        </Text>
        <Text variant="footnote" color={colors.gray[300]} style={styles.deniedText}>
          Разрешите доступ к камере, чтобы сканировать штрих-коды товаров.
        </Text>
        <View style={styles.deniedBtnRow}>
          <TouchableOpacity
            style={styles.deniedPrimaryBtn}
            onPress={permission.canAskAgain ? () => requestPermission() : () => Linking.openSettings()}
          >
            <Text variant="callout" color={colors.white} style={{ fontWeight: fontWeight.semibold }}>
              {permission.canAskAgain ? 'Разрешить' : 'Открыть настройки'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deniedSecondaryBtn} onPress={onClose}>
            <Text variant="callout" color={colors.gray[300]}>
              Закрыть
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
        onBarcodeScanned={handleBarcodeScanned}
      />
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.reticle} />
        <Text variant="footnote" color={colors.white} style={styles.hint}>
          {hint}
        </Text>
      </View>
      <TouchableOpacity style={styles.cancelBtn} onPress={onClose} accessibilityLabel="Отмена">
        <Ionicons name="close" size={22} color={colors.white} />
        <Text variant="callout" color={colors.white} style={styles.cancelText}>
          Отмена
        </Text>
      </TouchableOpacity>
    </>
  );
}

/** Fallback card shown when the native camera module isn't linked yet. */
function Unavailable({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.center}>
      <Ionicons name="barcode-outline" size={48} color={colors.gray[400]} />
      <Text variant="title3" color={colors.white} style={styles.deniedTitle}>
        Сканер пока недоступен
      </Text>
      <Text variant="footnote" color={colors.gray[300]} style={styles.deniedText}>
        Сканирование штрих-кодов станет доступно после обновления приложения.
      </Text>
      <TouchableOpacity style={styles.deniedPrimaryBtn} onPress={onClose}>
        <Text variant="callout" color={colors.white} style={{ fontWeight: fontWeight.semibold }}>
          Понятно
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default function BarcodeScanner({
  visible,
  onClose,
  onScanned,
  hint = 'Наведите камеру на штрих-код товара',
}: BarcodeScannerProps) {
  return (
    <RNModal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Gate on `visible` so ScannerInner mounts fresh each open (resetting
            its one-shot latch) and the camera is released on close. */}
        {visible ? (
          isBarcodeScannerAvailable ? (
            <ScannerInner onClose={onClose} onScanned={onScanned} hint={hint} />
          ) : (
            <Unavailable onClose={onClose} />
          )
        ) : null}
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing[8], gap: spacing[3] },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  reticle: {
    width: 240,
    height: 160,
    borderWidth: 2,
    borderColor: colors.primary[400],
    borderRadius: borderRadius.xl,
    backgroundColor: 'transparent',
  },
  hint: { marginTop: spacing[4], textAlign: 'center', opacity: 0.9, paddingHorizontal: spacing[8] },
  cancelBtn: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  cancelText: { fontWeight: fontWeight.semibold },
  deniedTitle: { textAlign: 'center', fontWeight: fontWeight.bold },
  deniedText: { textAlign: 'center', maxWidth: 300 },
  deniedBtnRow: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[2], alignItems: 'center' },
  deniedPrimaryBtn: {
    marginTop: spacing[2],
    backgroundColor: colors.primary[600],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.full,
  },
  deniedSecondaryBtn: {
    marginTop: spacing[2],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
  },
});
