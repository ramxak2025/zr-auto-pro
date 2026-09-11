import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
  Animated,
  AccessibilityInfo,
} from 'react-native';
import Constants from 'expo-constants';
import CachedImage from '../components/CachedImage';
import { Button } from '../components/Button';
import { KeyboardAwareView } from '../components/KeyboardAware';
import RegistrationRequestSheet from './RegistrationRequestSheet';
import LoginPointSelect from './LoginPointSelect';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import type { LoginStepResult } from '../contexts/AuthContext';
import { getPalette } from '../theme/palette';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { formatPhone } from '../../../shared/validation/phone';
import { diagnoseConnectivity } from '../utils/networkDiagnosis';
import { isSelectTokenExpired, resolveSelectPointFailure, SELECT_TOKEN_EXPIRED } from './loginPointSelection';

/** Ожидающий выбор филиала — второй шаг входа (163). */
type PendingPointSelection = Extract<LoginStepResult, { status: 'point-required' }>;

/**
 * Бюджет на ступень диагноза после сетевого отказа входа. Мёртвый DNS отвечает
 * почти мгновенно, так что обычно тратится доля секунды; 3 с — только потолок
 * на случай молчащей сети.
 */
const LOGIN_DIAGNOSIS_TIMEOUT_MS = 3_000;

export default function LoginScreen() {
  const { login, loginWithPoint, sessionEndedNotice, clearSessionEndedNotice } = useAuth();
  // Login screen is intentionally LOCKED to the light palette regardless
  // of the user's preferred theme mode. The owner wants the brand entry
  // screen — logo on near-white — to always read as "Autexa", not flip
  // to a dark slate. Theme toggle lives on Dashboard hero anyway.
  const palette = getPalette('light');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [registerOpen, setRegisterOpen] = useState(false);
  // ── Второй шаг входа: выбор филиала (163) ────────────────────────────────
  // Пока здесь не null, экран показывает НЕ форму, а выбор филиала. Сессии в
  // этот момент ещё нет: на руках только промежуточный токен на пять минут.
  const [pendingPoints, setPendingPoints] = useState<PendingPointSelection | null>(null);
  const [submittingPointId, setSubmittingPointId] = useState<string | null>(null);

  // Entrance animations — the LOGO is intentionally static at full
  // opacity/scale so the SplashOverlay → LoginScreen handoff is seamless:
  // the splash's centered logo cross-fades out onto an already-present
  // identical logo, with no second "logo pop" underneath. Only the form
  // (fields + submit) does a quick staggered fade/slide-up.
  const logoFade = useRef(new Animated.Value(1)).current;
  const logoScale = useRef(new Animated.Value(1)).current;
  const formSlide = useRef(new Animated.Value(20)).current;
  const formFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (cancelled) return;
        if (reduce) {
          // Reduce Motion: no slide-up, present the form at rest with a
          // short opacity reveal only.
          formSlide.setValue(0);
          Animated.timing(formFade, { toValue: 1, duration: 160, useNativeDriver: true }).start();
          return;
        }
        Animated.parallel([
          Animated.timing(formFade, { toValue: 1, duration: 250, useNativeDriver: true }),
          Animated.timing(formSlide, { toValue: 0, duration: 250, useNativeDriver: true }),
        ]).start();
      })
      .catch(() => {
        // If the a11y query fails, fall back to the standard entrance.
        Animated.parallel([
          Animated.timing(formFade, { toValue: 1, duration: 250, useNativeDriver: true }),
          Animated.timing(formSlide, { toValue: 0, duration: 250, useNativeDriver: true }),
        ]).start();
      });
    return () => {
      cancelled = true;
    };
  }, [formFade, formSlide]);

  const handlePhoneChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    setPhone(formatPhone(digits));
    setPhoneError('');
  };

  /**
   * Разбор сетевых/серверных отказов ШАГА 1 — общий для «Войти» и для
   * повторного запроса списка филиалов (когда доступ сняли между шагами).
   */
  const showLoginError = async (error: any) => {
    if (error.code === 'ERR_NETWORK' || !error.response) {
      // Не обвиняем сервер, пока не выяснили, кто виноват: при мёртвом DNS
      // разом умирают ВСЕ хосты кольца, и «сервер недоступен» — ложь, из-за
      // которой владелец месяцами искал поломку не там.
      const verdict = await diagnoseConnectivity(LOGIN_DIAGNOSIS_TIMEOUT_MS);
      if (verdict === 'dns-blocked') {
        Alert.alert(
          'Мешает VPN или DNS',
          'Сеть работает, но адрес сервера не удаётся разрешить. Выключите VPN (или смените DNS в настройках сети) и войдите снова.',
        );
      } else if (verdict === 'no-internet') {
        Alert.alert('Нет интернета', 'Проверьте подключение и попробуйте снова.');
      } else {
        Alert.alert('Сервер недоступен', error.message || 'Проверьте подключение.');
      }
    } else if (error.response?.status === 401) {
      Alert.alert('Ошибка', error.response?.data?.message || 'Неверный телефон или пароль');
    } else {
      Alert.alert('Ошибка', `Ошибка сервера: ${error.response?.status}. Попробуйте позже.`);
    }
  };

  const handleSubmit = async () => {
    setPhoneError('');
    setPasswordError('');

    if (!phone.trim()) {
      setPhoneError('Введите номер телефона');
      return;
    }
    if (!password.trim()) {
      setPasswordError('Введите пароль');
      return;
    }

    setSubmitting(true);
    try {
      const result = await login(phone, password);
      // Доступен ровно один филиал (или филиалов нет вовсе) — сессия уже
      // создана, экран сейчас исчезнет. Иначе показываем второй шаг.
      if (result.status === 'point-required') setPendingPoints(result);
    } catch (error: any) {
      await showLoginError(error);
    } finally {
      setSubmitting(false);
    }
  };

  /** Вернуться с выбора филиала к телефону и паролю: промежуточный токен бросаем. */
  const backToCredentials = () => {
    setPendingPoints(null);
    setSubmittingPointId(null);
  };

  /**
   * ШАГ 2: обменять выбранный филиал на сессию.
   *
   * Промежуточный токен ОДНОРАЗОВЫЙ, поэтому здесь ровно три исхода, и каждый
   * обязан вести человека дальше, а не оставлять его на экране с ошибкой:
   * начать вход заново, перевыбрать из обновлённого списка или повторить тот
   * же выбор. Правило — в screens/loginPointSelection.ts (покрыто тестами).
   */
  const handleSelectPoint = async (pointId: string) => {
    const pending = pendingPoints;
    if (!pending || submittingPointId) return;

    // Токен уже мёртв по времени — не платим ожиданием за заведомо отказной
    // запрос, особенно на плохой связи.
    if (isSelectTokenExpired(pending.expiresAt)) {
      backToCredentials();
      Alert.alert(SELECT_TOKEN_EXPIRED.title, SELECT_TOKEN_EXPIRED.message);
      return;
    }

    setSubmittingPointId(pointId);
    try {
      await loginWithPoint(pending.selectToken, pointId);
      // Успех: сессия создана, навигатор уносит нас с экрана входа.
    } catch (error: any) {
      const failure = resolveSelectPointFailure(error);
      if (failure.action === 'restart') {
        backToCredentials();
        Alert.alert(failure.title, failure.message);
        return;
      }
      if (failure.action === 'refresh') {
        // Доступ к филиалу сняли между шагами. Промежуточный токен сервер при
        // этом НЕ гасит, но список филиалов устарел — перезапрашиваем его
        // шагом 1 (пароль ещё в поле), чтобы человек выбрал из оставшихся.
        try {
          const again = await login(phone, password);
          if (again.status === 'point-required') {
            setPendingPoints(again);
            Alert.alert(failure.title, failure.message);
          }
          // Остался ровно один доступный филиал — сервер сразу выдал сессию,
          // и говорить больше нечего: человек уже внутри.
        } catch (retryError: any) {
          backToCredentials();
          await showLoginError(retryError);
        }
        return;
      }
      // 'stay' — сеть или 5xx: токен цел, повтор тем же выбором законен.
      Alert.alert(failure.title, failure.message);
    } finally {
      setSubmittingPointId(null);
    }
  };

  // Сессию погасили не по истечению токена, а потому что филиал закрыли или
  // сняли доступ (163). Человек обязан узнать ПРИЧИНУ: иначе «меня выкинуло»
  // выглядит как поломка приложения, и он звонит владельцу вместо того, чтобы
  // войти в доступный филиал. Показываем один раз и гасим.
  useEffect(() => {
    if (!sessionEndedNotice) return;
    Alert.alert('Вход нужно повторить', sessionEndedNotice);
    clearSessionEndedNotice();
  }, [sessionEndedNotice, clearSessionEndedNotice]);

  if (pendingPoints) {
    return (
      <LoginPointSelect
        points={pendingPoints.points}
        defaultPointId={pendingPoints.defaultPointId}
        submittingPointId={submittingPointId}
        onSelect={handleSelectPoint}
        onBack={backToCredentials}
      />
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      {/* Клавиатура (Round 11 #1, миграция). Раньше — RN-core KeyboardAvoidingView
          behavior='padding' БЕЗ keyboardVerticalOffset: на iOS поднимал весь
          центрированный блок без учёта safe area, из-за чего форма «улетала»
          выше, чем нужно; на Android — no-op. KeyboardAwareView даёт offset
          из insets и одинаково работает на обеих платформах. */}
      <KeyboardAwareView style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.container}>
            {/* Logo */}
            <Animated.View style={[styles.logoWrap, { opacity: logoFade, transform: [{ scale: logoScale }] }]}>
              <CachedImage source={require('../../assets/logo.png')} style={styles.logoImage} resizeMode="contain" />
            </Animated.View>
            <Animated.Text style={[styles.subtitle, { opacity: logoFade, color: palette.text.tertiary }]}>
              Система управления автосервисом для организаций
            </Animated.Text>

            {/* Phone */}
            <Animated.View style={[styles.fieldWrap, { opacity: formFade, transform: [{ translateY: formSlide }] }]}>
              <Text style={[styles.label, { color: palette.text.secondary }]}>ТЕЛЕФОН</Text>
              <TextInput
                value={phone}
                onChangeText={handlePhoneChange}
                placeholder="+7 (___) ___-__-__"
                placeholderTextColor={palette.text.tertiary}
                keyboardType="phone-pad"
                autoComplete="tel"
                style={[
                  styles.input,
                  {
                    backgroundColor: palette.bg.muted,
                    borderColor: palette.border.subtle,
                    color: palette.text.primary,
                  },
                  phoneError ? styles.inputError : null,
                ]}
              />
              {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}
            </Animated.View>

            {/* Password */}
            <Animated.View style={[styles.fieldWrap, { opacity: formFade, transform: [{ translateY: formSlide }] }]}>
              <Text style={[styles.label, { color: palette.text.secondary }]}>ПАРОЛЬ</Text>
              <View style={styles.passwordWrap}>
                <TextInput
                  value={password}
                  onChangeText={(t) => {
                    setPassword(t);
                    setPasswordError('');
                  }}
                  placeholder="Введите пароль"
                  placeholderTextColor={palette.text.tertiary}
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                  style={[
                    styles.input,
                    styles.passwordInput,
                    {
                      backgroundColor: palette.bg.muted,
                      borderColor: palette.border.subtle,
                      color: palette.text.primary,
                    },
                    passwordError ? styles.inputError : null,
                  ]}
                />
                <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(!showPassword)}>
                  <Ionicons name={showPassword ? 'eye' : 'eye-off'} size={20} color={colors.gray[400]} />
                </TouchableOpacity>
              </View>
              {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}
            </Animated.View>

            {/* Submit */}
            <Animated.View style={{ opacity: formFade, transform: [{ translateY: formSlide }] }}>
              <Button title="Войти" onPress={handleSubmit} loading={submitting} size="lg" />
            </Animated.View>

            {/* Self-service registration — secondary action under the login form.
                HIDDEN on iOS (App Store Guideline 3.1.1): in-app account creation
                that unlocks a subscription paid outside Apple is not allowed. On
                iOS the app is login-only for existing accounts; new autoservices
                register on the web (autexa.pw). Android keeps self-service signup. */}
            {Platform.OS !== 'ios' && (
              <Animated.View
                style={[styles.registerWrap, { opacity: formFade, transform: [{ translateY: formSlide }] }]}
              >
                <Button
                  title="Регистрация"
                  variant="secondary"
                  onPress={() => setRegisterOpen(true)}
                  disabled={submitting}
                  size="md"
                  hapticIntent="tap"
                />
              </Animated.View>
            )}
          </View>

          {/* Footer — версия из app.json (не хардкодить, чтобы не устаревала). */}
          <Text style={styles.footer}>Autexa v{Constants.expoConfig?.version ?? ''} © 2026</Text>
        </ScrollView>
      </KeyboardAwareView>

      {Platform.OS !== 'ios' && (
        <RegistrationRequestSheet visible={registerOpen} onClose={() => setRegisterOpen(false)} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.white,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[12],
  },
  container: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: spacing[4],
  },
  logoImage: {
    width: 240,
    height: 58,
  },
  subtitle: {
    textAlign: 'center',
    fontSize: fontSize.sm,
    color: colors.gray[400],
    marginBottom: spacing[8],
    letterSpacing: 1,
  },
  fieldWrap: {
    marginBottom: spacing[5],
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.gray[500],
    letterSpacing: 1.5,
    marginBottom: spacing[2],
  },
  input: {
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
    fontSize: 15,
    color: colors.gray[900],
  },
  inputError: {
    borderColor: colors.red[400],
    backgroundColor: '#fef2f2',
  },
  passwordWrap: {
    position: 'relative',
  },
  passwordInput: {
    paddingRight: spacing[12],
  },
  eyeBtn: {
    position: 'absolute',
    right: spacing[4],
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  eyeText: {
    fontSize: fontSize.lg,
    color: colors.gray[400],
  },
  errorText: {
    marginTop: spacing[1.5],
    fontSize: fontSize.xs,
    color: colors.red[500],
  },
  submitBtn: {
    backgroundColor: colors.primary[600],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing[2],
    shadowColor: colors.primary[600],
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: fontWeight.semibold,
  },
  registerWrap: {
    marginTop: spacing[3],
  },
  footer: {
    textAlign: 'center',
    fontSize: fontSize.xs,
    color: colors.gray[300],
    marginTop: spacing[8],
  },
});
