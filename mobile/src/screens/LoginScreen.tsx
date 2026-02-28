import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';

function formatPhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.length > 0 && digits[0] === '8') {
    digits = '7' + digits.slice(1);
  }
  if (digits.length === 0) return '';
  if (digits.length <= 1) return `+${digits}`;
  if (digits.length <= 4) return `+${digits.slice(0, 1)} (${digits.slice(1)}`;
  if (digits.length <= 7)
    return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4)}`;
  if (digits.length <= 9)
    return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
}

export default function LoginScreen() {
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [passwordError, setPasswordError] = useState('');

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
        Alert.alert('Ошибка', 'Сервер недоступен! Проверьте подключение.');
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
        Alert.alert('Ошибка', 'Сервер недоступен!');
      } else {
        Alert.alert('Ошибка', `Ошибка демо-входа: ${err.response?.data?.message || err.response?.status}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.container}>
            {/* Logo */}
            <View style={styles.logoWrap}>
              <Image source={require('../../assets/logo.png')} style={styles.logoImage} resizeMode="contain" />
            </View>
            <Text style={styles.subtitle}>Система управления сервисом</Text>

            {/* Phone */}
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>ТЕЛЕФОН</Text>
              <TextInput
                value={phone}
                onChangeText={handlePhoneChange}
                placeholder="+7 (___) ___-__-__"
                placeholderTextColor={colors.gray[400]}
                keyboardType="phone-pad"
                autoComplete="tel"
                style={[styles.input, phoneError ? styles.inputError : null]}
              />
              {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}
            </View>

            {/* Password */}
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>ПАРОЛЬ</Text>
              <View style={styles.passwordWrap}>
                <TextInput
                  value={password}
                  onChangeText={(t) => {
                    setPassword(t);
                    setPasswordError('');
                  }}
                  placeholder="Введите пароль"
                  placeholderTextColor={colors.gray[400]}
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                  style={[styles.input, styles.passwordInput, passwordError ? styles.inputError : null]}
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  <Text style={styles.eyeText}>{showPassword ? '◉' : '◎'}</Text>
                </TouchableOpacity>
              </View>
              {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}
            </View>

            {/* Submit */}
            <TouchableOpacity
              style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
              activeOpacity={0.8}
            >
              {submitting ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Text style={styles.submitText}>Войти</Text>
              )}
            </TouchableOpacity>

            {/* Demo access */}
            <View style={styles.demoSection}>
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>ДЕМО-ДОСТУП</Text>
                <View style={styles.dividerLine} />
              </View>
              <View style={styles.demoButtons}>
                <TouchableOpacity
                  style={[styles.demoBtn, styles.demoBtnOwner]}
                  onPress={() => handleDemoLogin('+7 (000) 000-00-01')}
                  disabled={submitting}
                >
                  <Text style={styles.demoBtnOwnerText}>Владелец</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.demoBtn, styles.demoBtnMaster]}
                  onPress={() => handleDemoLogin('+7 (000) 000-00-02')}
                  disabled={submitting}
                >
                  <Text style={styles.demoBtnMasterText}>Мастер</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Footer */}
          <Text style={styles.footer}>Autexa v1.8 © 2026</Text>
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
    marginBottom: spacing[3],
  },
  logoImage: {
    width: 180,
    height: 64,
  },
  subtitle: {
    textAlign: 'center',
    fontSize: fontSize.sm,
    color: colors.gray[400],
    marginBottom: spacing[10],
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
