import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Animated,
  AccessibilityInfo,
} from 'react-native';
import CachedImage from '../components/CachedImage';
import { Button } from '../components/Button';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { getPalette } from '../theme/palette';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { formatPhone } from '../../../shared/validation/phone';

export default function LoginScreen() {
  const { login } = useAuth();
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

  // Entrance animations — the LOGO is intentionally static at full
  // opacity/scale so the SplashOverlay → LoginScreen handoff is seamless:
  // the splash's centered logo cross-fades out onto an already-present
  // identical logo, with no second "logo pop" underneath. Only the form
  // (fields + demo block) does a quick staggered fade/slide-up.
  const logoFade = useRef(new Animated.Value(1)).current;
  const logoScale = useRef(new Animated.Value(1)).current;
  const formSlide = useRef(new Animated.Value(20)).current;
  const formFade = useRef(new Animated.Value(0)).current;
  const demoFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (cancelled) return;
        if (reduce) {
          // Reduce Motion: no slide-up, present the form at rest with a
          // short opacity reveal only.
          formSlide.setValue(0);
          Animated.parallel([
            Animated.timing(formFade, { toValue: 1, duration: 160, useNativeDriver: true }),
            Animated.timing(demoFade, { toValue: 1, duration: 160, useNativeDriver: true }),
          ]).start();
          return;
        }
        Animated.parallel([
          Animated.timing(formFade, { toValue: 1, duration: 250, useNativeDriver: true }),
          Animated.timing(formSlide, { toValue: 0, duration: 250, useNativeDriver: true }),
          Animated.timing(demoFade, { toValue: 1, duration: 350, useNativeDriver: true }),
        ]).start();
      })
      .catch(() => {
        // If the a11y query fails, fall back to the standard entrance.
        Animated.parallel([
          Animated.timing(formFade, { toValue: 1, duration: 250, useNativeDriver: true }),
          Animated.timing(formSlide, { toValue: 0, duration: 250, useNativeDriver: true }),
          Animated.timing(demoFade, { toValue: 1, duration: 350, useNativeDriver: true }),
        ]).start();
      });
    return () => {
      cancelled = true;
    };
  }, [demoFade, formFade, formSlide]);

  const handlePhoneChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    setPhone(formatPhone(digits));
    setPhoneError('');
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
      await login(phone, password);
    } catch (error: any) {
      if (error.code === 'ERR_NETWORK' || !error.response) {
        Alert.alert('Сервер недоступен', error.message || 'Проверьте подключение.');
      } else if (error.response?.status === 401) {
        Alert.alert('Ошибка', error.response?.data?.message || 'Неверный телефон или пароль');
      } else {
        Alert.alert('Ошибка', `Ошибка сервера: ${error.response?.status}. Попробуйте позже.`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDemoLogin = async (demoPhone: string) => {
    setSubmitting(true);
    try {
      await login(demoPhone, 'demo123');
    } catch (err: any) {
      if (err.code === 'ERR_NETWORK' || !err.response) {
        Alert.alert('Сервер недоступен', err.message || 'Проверьте подключение.');
      } else {
        Alert.alert('Ошибка', `Ошибка демо-входа: ${err.response?.data?.message || err.response?.status}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.container}>
            {/* Logo */}
            <Animated.View style={[styles.logoWrap, { opacity: logoFade, transform: [{ scale: logoScale }] }]}>
              <CachedImage source={require('../../assets/logo.png')} style={styles.logoImage} resizeMode="contain" />
            </Animated.View>
            <Animated.Text style={[styles.subtitle, { opacity: logoFade, color: palette.text.tertiary }]}>
              Система управления автосервисом
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

            {/* Demo access */}
            <Animated.View style={[styles.demoSection, { opacity: demoFade }]}>
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>ДЕМО-ДОСТУП</Text>
                <View style={styles.dividerLine} />
              </View>
              <View style={styles.demoButtons}>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Владелец"
                    variant="secondary"
                    onPress={() => handleDemoLogin('+7 (000) 000-00-01')}
                    disabled={submitting}
                    size="md"
                    hapticIntent="select"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Мастер"
                    variant="secondary"
                    onPress={() => handleDemoLogin('+7 (000) 000-00-02')}
                    disabled={submitting}
                    size="md"
                    hapticIntent="select"
                  />
                </View>
              </View>
            </Animated.View>
          </View>

          {/* Footer */}
          <Text style={styles.footer}>Autexa v2.1 © 2026</Text>
        </ScrollView>
      </KeyboardAvoidingView>
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
  demoSection: {
    marginTop: spacing[8],
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing[4],
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.gray[200],
  },
  dividerText: {
    paddingHorizontal: spacing[3],
    fontSize: fontSize.xs,
    color: colors.gray[400],
    letterSpacing: 1.5,
  },
  demoButtons: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  demoBtn: {
    flex: 1,
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    borderWidth: 1,
  },
  demoBtnOwner: {
    backgroundColor: colors.emerald[50],
    borderColor: colors.emerald[200],
  },
  demoBtnOwnerText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.emerald[700],
  },
  demoBtnMaster: {
    backgroundColor: colors.blue[50],
    borderColor: colors.blue[200],
  },
  demoBtnMasterText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.blue[700],
  },
  footer: {
    textAlign: 'center',
    fontSize: fontSize.xs,
    color: colors.gray[300],
    marginTop: spacing[8],
  },
});
